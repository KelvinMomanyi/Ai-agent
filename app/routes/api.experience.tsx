import {
  data as json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import prisma from "../db.server";
import {
  authenticateStorefrontRequest,
  isStorefrontAuthError,
} from "../utils/storefrontAuth.server";
import { optionsResponse, withCors } from "../utils/cors.server";
import { isInstalledShop } from "../models/installedShop.server";
import { getAppSettings } from "../models/settings.server";
import { readStorefrontConfig } from "../models/storefrontConfig";
import {
  factKey,
  resolveStorefrontData,
} from "../models/storefrontData.server";
import { getEntitlements, limitsFor } from "../models/entitlements.server";
import { reserveOfferDisplay } from "../models/usage.server";
import { createOfferRecord } from "../models/offer.server";
import { enrollHoldout } from "../models/holdout.server";
import { getShopperSession } from "../models/session.server";
import { incrementRateLimit } from "../redis.server";
import type { OfferDecision } from "../ai/types";

const empty = () => ({
  agentFacts: { version: 1 },
  campaign: null,
  offers: [],
  automaticPlacements: false,
});
export const loader = ({ request }: LoaderFunctionArgs) =>
  request.method === "OPTIONS"
    ? optionsResponse()
    : json(
        { error: "Method not allowed" },
        { status: 405, headers: withCors() },
      );
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();
  try {
    const raw = await request.text();
    if (raw.length > 16000)
      return json(empty(), { status: 413, headers: withCors() });
    const body = JSON.parse(raw),
      { shop, sessionId } = authenticateStorefrontRequest(request, body);
    if (!(await isInstalledShop(shop)))
      return json(empty(), { status: 401, headers: withCors() });
    if ((await incrementRateLimit(`experience:${shop}:${sessionId}`, 60)) > 10)
      return json(empty(), {
        status: 429,
        headers: withCors({ "Retry-After": "60" }),
      });
    const settings = await getAppSettings(shop),
      config = readStorefrontConfig(settings.storefrontConfig);
    const pageType = String(body.pageType || "");
    if (
      !config.agentCoreEnabled ||
      settings.focusedMode ||
      !["home", "product", "cart", "collection", "search"].includes(pageType)
    )
      return json(empty(), { headers: withCors() });
    const session = await getShopperSession(shop, sessionId);
    if (
      !session ||
      (await enrollHoldout(shop, sessionId, settings))?.arm === "holdout"
    )
      return json(empty(), { headers: withCors() });
    const entitlement = await getEntitlements(shop);
    if (!limitsFor(entitlement).features.advancedPlacements)
      return json(empty(), { headers: withCors() });
    const productId =
      pageType === "product" &&
      /^gid:\/\/shopify\/Product\/\d+$/.test(String(body.productId || ""))
        ? String(body.productId)
        : undefined;
    if (
      productId &&
      !(await prisma.product.findFirst({
        where: { shop, id: productId },
        select: { id: true },
      }))
    )
      return json(empty(), { headers: withCors() });
    const data = await resolveStorefrontData({
      shop,
      config,
      productId,
      pageType,
      currency: typeof body.currency === "string" ? body.currency : undefined,
    });
    const candidates: Array<{
      type: string;
      key: unknown;
      payload: Record<string, unknown>;
    }> = [];
    if (settings.discountNudgeEnabled && data.campaign)
      candidates.push({
        type: "countdown_banner",
        key: data.campaign,
        payload: { endsAt: data.campaign.endsAt },
      });
    if (pageType === "product" && data.agentFacts.alerts?.length)
      candidates.push({
        type: "inline_alert",
        key: data.agentFacts.alerts,
        payload: {},
      });
    else if (
      pageType === "product" &&
      settings.upsellEnabled &&
      data.agentFacts.proof?.length
    )
      candidates.push({
        type: "social_proof",
        key: data.agentFacts.proof,
        payload: {},
      });
    if (
      pageType === "cart" &&
      settings.discountNudgeEnabled &&
      data.agentFacts.reward
    )
      candidates.push({
        type: "discount_nudge",
        key: {
          id: data.agentFacts.reward.id,
          threshold: data.agentFacts.reward.threshold,
          description: data.agentFacts.reward.description,
          code: data.agentFacts.reward.code,
        },
        payload: { threshold: data.agentFacts.reward.threshold },
      });
    const offers: OfferDecision[] = [];
    for (const candidate of candidates) {
      const key = factKey([candidate.type, productId, pageType, candidate.key]);
      const prior = await prisma.offer.findFirst({
        where: {
          shop,
          sessionId: session.id,
          widgetType: candidate.type,
          triggerContext: { path: ["factKey"], equals: key },
          createdAt: { gte: new Date(Date.now() - 12 * 3600_000) },
        },
        select: { id: true },
      });
      const decision: OfferDecision = {
        widgetType: candidate.type,
        payload: candidate.payload,
        reasoning: "merchant_verified_fact",
        confidence: 1,
        aiProvider: "heuristic",
      };
      const record =
        prior ||
        (await createOfferRecord({
          shop,
          sessionId: session.id,
          decision,
          triggerContext: {
            trigger: "verified_fact",
            factKey: key,
            sourceProductId: productId,
          },
        }));
      if (record && (await reserveOfferDisplay(shop, record.id, entitlement)))
        offers.push({
          ...decision,
          payload: { ...decision.payload, offerId: record.id },
        });
    }
    return json(
      { ...data, campaign: data.campaign || null, offers },
      { headers: withCors({ "Cache-Control": "no-store" }) },
    );
  } catch (error) {
    if (isStorefrontAuthError(error))
      return json(empty(), { status: error.status, headers: withCors() });
    return json(empty(), {
      status: 503,
      headers: withCors({ "Cache-Control": "no-store" }),
    });
  }
};
