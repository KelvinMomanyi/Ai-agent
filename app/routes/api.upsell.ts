import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  buildRevenueOffer,
  type BehaviorContext,
  type ProductCandidate,
  type RevenueOffer,
  type EngineConfig,
} from "../models/revenue-engine.server";
import { ensureRevenueEngineConfigSchema } from "../models/shop-config.server";
import { getSessionForVisitor } from "../models/behavior-engine.server";
import { evaluateDiscount } from "../models/discount-intelligence.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type UpsellRequestBody = {
  cartItems?: unknown;
  cartTotal?: number;
  currency?: string;
  itemCount?: number;
  behaviorContext?: BehaviorContext;
  visitorId?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return json(
    { message: "Use POST to generate an AI Revenue Engine offer." },
    { headers: corsHeaders },
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = (await request.json()) as UpsellRequestBody;
    const { session, admin } = await authenticate.public.appProxy(request);
    if (!session || !admin) {
      return json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }
    await ensureRevenueEngineConfigSchema(prisma);

    const cartItems = Array.isArray(body.cartItems) ? body.cartItems : [];
    const behaviorContext: BehaviorContext = {
      ...(body.behaviorContext || {}),
      cartTotal: body.behaviorContext?.cartTotal ?? body.cartTotal,
      itemCount: body.behaviorContext?.itemCount ?? body.itemCount,
    };
    
    let visitorSession = null;
    let intentProfile = "browsing";
    if (body.visitorId) {
       try {
         visitorSession = await getSessionForVisitor(session.shop, body.visitorId);
         intentProfile = visitorSession.intentProfile;
         behaviorContext.intentProfile = intentProfile;
       } catch (e) {
         console.error("Failed to get visitor session:", e);
       }
    }

    const [productResponse, conversionEvents, shopConfig] = await Promise.all([
      admin.graphql(`#graphql
        query RevenueEngineProducts {
          products(first: 100) {
            edges {
              node {
                id
                title
                handle
                productType
                tags
                featuredImage {
                  originalSrc
                  altText
                }
                variants(first: 1) {
                  edges {
                    node {
                      id
                      price
                    }
                  }
                }
              }
            }
          }
        }
      `),
      prisma.event.findMany({
        where: { storeId: session.shop, event: "conversion" },
        take: 30,
        orderBy: { timestamp: "desc" },
      }),
      prisma.shopConfig.findUnique({
        where: { shopDomain: session.shop },
      }),
    ]);

    const productResult = (await productResponse.json()) as any;

    if (productResult.errors) {
      throw new Error(`GraphQL error: ${JSON.stringify(productResult.errors)}`);
    }

    const mappedConfig: Partial<EngineConfig> | undefined = shopConfig
      ? {
          discountPercentage: shopConfig.discountPercentage,
          offerStrategy: shopConfig.offerStrategy,
          brandVoice: shopConfig.brandVoice ?? undefined,
          minProductPrice: shopConfig.minProductPrice,
          revenueMode: shopConfig.revenueMode as any,
          enableAutopilot: shopConfig.enableAutopilot,
          enableDynamicBundles: shopConfig.enableDynamicBundles,
          enableExperimentation: shopConfig.enableExperimentation,
          enableBehavioralTargeting: shopConfig.enableBehavioralTargeting,
          primaryPlacement: shopConfig.primaryPlacement,
          maxBundleItems: shopConfig.maxBundleItems,
          urgencyLevel: shopConfig.urgencyLevel,
        }
      : undefined;

    const products = toProductCandidates(productResult);
    const historyContext = conversionEvents
      .map((event) => {
        const data = event.data as { line_items?: Array<{ title?: string }> };
        return (data.line_items || [])
          .map((item) => item.title)
          .filter(Boolean)
          .join(" + ");
      })
      .filter(Boolean)
      .slice(0, 8);

    const baseOffer = await buildRevenueOffer({
      cartItems,
      products,
      historyContext,
      shopConfig: mappedConfig,
      behaviorContext,
      shopDomain: session.shop
    });

    if (!baseOffer) {
      return json(
        { error: "No eligible products available for revenue offer" },
        { status: 404, headers: corsHeaders },
      );
    }
    
    // Apply Discount Intelligence
    if (visitorSession && mappedConfig) {
       const discountDecision = evaluateDiscount({
          intentProfile,
          cartTotal: behaviorContext.cartTotal || 0,
          cartItems,
          visitorSession,
          shopConfig: mappedConfig as any
       });
       
       if (discountDecision.shouldDiscount) {
          const discountVal = discountDecision.percentage;
          baseOffer.discount = {
             percentage: discountVal,
             code: `SMART-AI-REWARD-${discountVal}`,
             text: `${discountVal}% off this revenue-engine offer`,
          };
          if (baseOffer.bundle) {
             baseOffer.bundle.discountPercentage = discountVal;
             const subtotal = parseFloat(baseOffer.bundle.subtotal);
             baseOffer.bundle.discountedTotal = (subtotal * (1 - discountVal/100)).toFixed(2);
          }
       } else {
          baseOffer.discount = undefined;
          if (baseOffer.bundle) {
             baseOffer.bundle.discountPercentage = null;
             baseOffer.bundle.discountedTotal = baseOffer.bundle.subtotal;
          }
       }
       baseOffer.insight = discountDecision.reason + " " + baseOffer.insight;
    }

    const aiEnhancement = await generateAiEnhancement(baseOffer, mappedConfig?.brandVoice, body.currency);
    const suggestion = mergeAiEnhancement(baseOffer, aiEnhancement);

    // Skip generating GraphQL discount code for post-purchase since the UI extension
    // natively handles discounts in the changeset.
    if (suggestion.discount?.percentage && behaviorContext.pageType !== "post_purchase") {
      await createDiscountCode(
        admin,
        suggestion.discount.code,
        suggestion.discount.percentage,
      );
    }

    await prisma.event.create({
      data: {
        event: "offer_generated",
        timestamp: new Date(),
        storeId: session.shop,
        data: {
          id: suggestion.id,
          title: suggestion.title,
          offerType: suggestion.offerType,
          mode: suggestion.mode,
          modeLabel: suggestion.modeLabel,
          placement: suggestion.placement,
          segment: suggestion.segment,
          bundleId: suggestion.bundle?.id,
          bundleTitle: suggestion.bundle?.title,
          experimentId: suggestion.experiment?.id,
          experimentVariant: suggestion.experiment?.variant,
          behavior: behaviorContext,
        },
      },
    });

    return json(
      {
        suggestion,
        engine: {
          mode: suggestion.mode,
          modeLabel: suggestion.modeLabel,
          placement: suggestion.placement,
          experiment: suggestion.experiment,
          autopilotAction: suggestion.autopilotAction,
        },
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    console.error("Revenue offer generation error:", {
      message: getErrorMessage(error),
      timestamp: new Date().toISOString(),
    });

    return json(
      {
        error: "Revenue engine temporarily unavailable",
        suggestion: null,
      },
      { status: 500, headers: corsHeaders },
    );
  }
};

function toProductCandidates(productResult: any): ProductCandidate[] {
  return productResult.data.products.edges
    .map(({ node }: any) => {
      const variant = node.variants.edges[0]?.node;

      return {
        id: variant?.id,
        title: node.title,
        handle: node.handle,
        price: variant?.price || "0.00",
        type: node.productType,
        tags: node.tags || [],
        image: {
          src: node.featuredImage?.originalSrc || "https://via.placeholder.com/320",
          alt: node.featuredImage?.altText || node.title,
        },
      };
    })
    .filter((product: ProductCandidate) => product.id);
}

async function generateAiEnhancement(
  offer: RevenueOffer,
  brandVoice?: string,
  currency?: string,
): Promise<Partial<RevenueOffer> | null> {
  const brandInstruction = brandVoice 
    ? `\nBrand Voice / Tone:\n${brandVoice}\nWrite the copy strictly matching this brand voice.` 
    : "";

  const prompt = `You are improving an already selected Shopify revenue offer.

Do not change product ids, prices, discount, mode, placement, experiment, or bundle items.
Improve only customer-facing strategy copy.
${brandInstruction}

Current offer:
${JSON.stringify(
  {
    title: offer.title,
    message: offer.message,
    insight: offer.insight,
    mode: offer.modeLabel,
    segment: offer.segment,
    offerType: offer.offerType,
    bundleTitle: offer.bundle?.title,
    items: offer.bundle?.items.map((item) => item.title) || [offer.title],
    currency,
  },
  null,
  2,
)}

Return JSON only:
{
  "title": "short offer title",
  "message": "contextual, specific, revenue-outcome oriented customer copy",
  "insight": "one merchant-facing reason this offer was selected",
  "reasoning": "one sentence internal strategy explanation",
  "bundleTitle": "short bundle title when this is a bundle"
}`;

  const services = [
    process.env.GOOGLE_API_KEY
      ? {
          name: "gemini",
          url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GOOGLE_API_KEY}`,
          headers: { "Content-Type": "application/json" },
          body: {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 450, temperature: 0.35 },
          },
        }
      : null,
    process.env.GROQ_API_KEY
      ? {
          name: "groq",
          url: "https://api.groq.com/openai/v1/chat/completions",
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: {
            model: "llama-3.3-70b-versatile",
            messages: [
              {
                role: "system",
                content: "Return valid JSON only. Do not change product data.",
              },
              { role: "user", content: prompt },
            ],
            max_tokens: 450,
            temperature: 0.35,
          },
        }
      : null,
  ].filter(Boolean) as Array<{
    name: string;
    url: string;
    headers: Record<string, string>;
    body: unknown;
  }>;

  for (const service of services) {
    try {
      const response = await fetch(service.url, {
        method: "POST",
        headers: service.headers,
        body: JSON.stringify(service.body),
        signal: AbortSignal.timeout(4500),
      });

      if (!response.ok) continue;

      const data = await response.json();
      const content =
        service.name === "gemini"
          ? data.candidates?.[0]?.content?.parts?.[0]?.text
          : data.choices?.[0]?.message?.content;
      const parsed = parseJsonObject(content);

      if (parsed) return parsed;
    } catch (error) {
      console.log(`${service.name} enhancement skipped:`, getErrorMessage(error));
    }
  }

  return null;
}

function mergeAiEnhancement(
  offer: RevenueOffer,
  enhancement: Partial<RevenueOffer> | null,
): RevenueOffer {
  if (!enhancement) return offer;

  const nextOffer: RevenueOffer = {
    ...offer,
    title: safeString(enhancement.title) || offer.title,
    message: safeString(enhancement.message) || offer.message,
    insight: safeString(enhancement.insight) || offer.insight,
    reasoning: safeString(enhancement.reasoning) || offer.reasoning,
  };

  const bundleTitle = safeString((enhancement as { bundleTitle?: unknown }).bundleTitle);
  if (nextOffer.bundle && bundleTitle) {
    nextOffer.bundle = {
      ...nextOffer.bundle,
      title: bundleTitle,
    };
    nextOffer.title = bundleTitle;
  }

  return nextOffer;
}

async function createDiscountCode(
  admin: any,
  code: string,
  percentage: number,
) {
  try {
    const response = await admin.graphql(
      `#graphql
      mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode {
            id
            codeDiscount {
              ... on DiscountCodeBasic {
                title
                codes(first: 1) {
                  nodes {
                    code
                  }
                }
              }
            }
          }
          userErrors {
            field
            code
            message
          }
        }
      }
    `,
      {
        variables: {
          basicCodeDiscount: {
            title: `AI Revenue Engine: ${code}`,
            code,
            startsAt: new Date().toISOString(),
            endsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            usageLimit: 1,
            customerSelection: {
              all: true,
            },
            customerGets: {
              value: {
                percentage: percentage / 100,
              },
              items: {
                all: true,
              },
            },
          },
        },
      },
    );

    const result = await response.json();
    const errors = result.data?.discountCodeBasicCreate?.userErrors || [];

    if (errors.some((error: { code?: string }) => error.code === "TAKEN")) {
      return;
    }

    if (errors.length > 0) {
      console.log("Discount creation errors:", errors);
    }
  } catch (error) {
    console.error("Failed to create discount code:", getErrorMessage(error));
  }
}

function parseJsonObject(value: unknown) {
  if (typeof value !== "string") return null;

  try {
    return JSON.parse(value);
  } catch {
    const jsonMatch = value.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }
}

function safeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
