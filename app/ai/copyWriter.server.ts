import type { AppSettings } from "@prisma/client";
import { callAi, parseAiJson } from "./client.server";
import { COPY_WRITER_SYSTEM } from "./prompts";
import type { WidgetCopy } from "./types";

type CopySettings = Pick<
  AppSettings,
  "aiTone" | "chatGreeting" | "shop" | "brandVoice"
>;

export async function generateWidgetCopy(
  widgetType: string,
  productContext: Record<string, unknown>,
  offerDetails: Record<string, unknown>,
  settings: CopySettings,
): Promise<WidgetCopy> {
  const fallback = buildFallbackCopy(widgetType, productContext, offerDetails, settings);
  const brandVoiceSection = settings.brandVoice
    ? `Brand Voice:\n${settings.brandVoice}`
    : "";
  const systemPrompt = COPY_WRITER_SYSTEM.replace("{widgetType}", widgetType)
    .replace("{tone}", settings.aiTone || "friendly")
    .replace("{storeName}", settings.shop)
    .replace("{productContext}", JSON.stringify(productContext))
    .replace("{offerDetails}", JSON.stringify(offerDetails))
    .replace("{brandVoiceSection}", brandVoiceSection);

  const raw = await callAi(
    systemPrompt,
    JSON.stringify({
      widgetType,
      productContext,
      offerDetails,
      expectedSchema: getSchemaHint(widgetType),
    }),
  );
  const parsed = parseAiJson<Record<string, unknown>>(raw);

  return normalizeCopy(widgetType, parsed, fallback);
}

function getSchemaHint(widgetType: string) {
  switch (widgetType) {
    case "chat":
      return { greeting: "string", assistantIntro: "string", ctaAccept: "string", ctaDecline: "string" };
    case "bundle":
      return { headline: "string", itemList: ["string"], totalSavings: "string", ctaText: "string" };
    case "discount_nudge":
      return { progressLabel: "string", rewardDescription: "string", ctaText: "string" };
    case "exit_intent":
      return { headline: "string", offerLine: "string", ctaText: "string", dismissText: "string" };
    case "post_purchase":
      return { headline: "string", productName: "string", oneLineReason: "string", ctaText: "string" };
    default:
      return { headline: "string", productName: "string", whyThisGoes: "string", ctaText: "string", dismissText: "string" };
  }
}

function normalizeCopy(
  widgetType: string,
  parsed: Record<string, unknown> | null,
  fallback: WidgetCopy,
): WidgetCopy {
  if (!parsed) return fallback;

  if (widgetType === "chat") {
    return {
      greeting: stringOr(parsed.greeting ?? parsed.headline, (fallback as any).greeting),
      assistantIntro: stringOr(
        parsed.assistantIntro ?? parsed.subheadline,
        (fallback as any).assistantIntro,
      ),
      ctaAccept: stringOr(parsed.ctaAccept ?? parsed.ctaText, (fallback as any).ctaAccept),
      ctaDecline: stringOr(parsed.ctaDecline ?? parsed.dismissText, (fallback as any).ctaDecline),
    };
  }

  if (widgetType === "bundle") {
    return {
      headline: stringOr(parsed.headline, (fallback as any).headline),
      itemList: Array.isArray(parsed.itemList)
        ? parsed.itemList.map(String).filter(Boolean)
        : (fallback as any).itemList,
      totalSavings: stringOr(parsed.totalSavings ?? parsed.subheadline, (fallback as any).totalSavings),
      ctaText: stringOr(parsed.ctaText, (fallback as any).ctaText),
    };
  }

  if (widgetType === "discount_nudge") {
    return {
      progressLabel: stringOr(parsed.progressLabel ?? parsed.headline, (fallback as any).progressLabel),
      rewardDescription: stringOr(
        parsed.rewardDescription ?? parsed.subheadline,
        (fallback as any).rewardDescription,
      ),
      ctaText: stringOr(parsed.ctaText, (fallback as any).ctaText),
    };
  }

  if (widgetType === "exit_intent") {
    return {
      headline: stringOr(parsed.headline, (fallback as any).headline),
      offerLine: stringOr(parsed.offerLine ?? parsed.subheadline, (fallback as any).offerLine),
      ctaText: stringOr(parsed.ctaText, (fallback as any).ctaText),
      dismissText: stringOr(parsed.dismissText, (fallback as any).dismissText),
    };
  }

  if (widgetType === "post_purchase") {
    return {
      headline: stringOr(parsed.headline, (fallback as any).headline),
      productName: stringOr(parsed.productName, (fallback as any).productName),
      oneLineReason: stringOr(
        parsed.oneLineReason ?? parsed.subheadline,
        (fallback as any).oneLineReason,
      ),
      ctaText: stringOr(parsed.ctaText, (fallback as any).ctaText),
    };
  }

  return {
    headline: stringOr(parsed.headline, (fallback as any).headline),
    productName: stringOr(parsed.productName, (fallback as any).productName),
    whyThisGoes: stringOr(
      parsed.whyThisGoes ?? parsed.subheadline,
      (fallback as any).whyThisGoes,
    ),
    ctaText: stringOr(parsed.ctaText, (fallback as any).ctaText),
    dismissText: stringOr(parsed.dismissText, (fallback as any).dismissText),
  };
}

function buildFallbackCopy(
  widgetType: string,
  productContext: Record<string, unknown>,
  offerDetails: Record<string, unknown>,
  settings: CopySettings,
): WidgetCopy {
  const productName = stringOr(
    offerDetails.productName,
    stringOr(productContext.title, "this product"),
  );

  switch (widgetType) {
    case "chat":
      return {
        greeting: settings.chatGreeting,
        assistantIntro: "I can help compare products and find useful add-ons.",
        ctaAccept: "Chat with AI",
        ctaDecline: "Browse myself",
      };
    case "bundle":
      return {
        headline: "Complete the set",
        itemList: Array.isArray(offerDetails.items)
          ? offerDetails.items.map((item) => String((item as any).title || item)).filter(Boolean)
          : [productName],
        totalSavings: stringOr(offerDetails.totalSavings, "Bundle value"),
        ctaText: "Add bundle",
      };
    case "discount_nudge":
      return {
        progressLabel: "You are close to a reward",
        rewardDescription: "Add one more item to unlock the offer.",
        ctaText: "View picks",
      };
    case "exit_intent":
      return {
        headline: "Wait before you go",
        offerLine: "Your cart has a relevant offer available.",
        ctaText: "Claim offer",
        dismissText: "No thanks",
      };
    case "post_purchase":
      return {
        headline: "Complete your order",
        productName,
        oneLineReason: "A useful add-on for what you just bought.",
        ctaText: "Add to order",
      };
    default:
      return {
        headline: "A useful add-on",
        productName,
        whyThisGoes: "It pairs well with this shopping session.",
        ctaText: "Add to cart",
        dismissText: "No thanks",
      };
  }
}

function stringOr(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
