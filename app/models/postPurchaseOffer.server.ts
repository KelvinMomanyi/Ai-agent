import type { Prisma } from "@prisma/client";
import crypto from "node:crypto";
// jsonwebtoken is CommonJS; Node exposes its module.exports object as default.
// eslint-disable-next-line import/default
import jsonwebtoken from "jsonwebtoken";
import prisma from "../db.server";
import { catalogProductToWidgetProduct } from "./catalogGuard.server";
import { getAppSettings } from "./settings.server";
import { markOfferConversion } from "./offer.server";

// eslint-disable-next-line import/no-named-as-default-member
const { sign: signJwt } = jsonwebtoken;

type AddVariantChange = {
  type: "add_variant";
  variantId: number;
  quantity: number;
  discount?: {
    value: number;
    valueType: "percentage";
    title: string;
  };
};

export async function createPostPurchaseOffer(input: {
  shop: string;
  referenceId: string;
  purchasedVariantIds: string[];
}) {
  const settings = await getAppSettings(input.shop);
  if (!settings.postPurchaseEnabled) return null;

  const session = await prisma.shopperSession.upsert({
    where: {
      shop_anonymousId: {
        shop: input.shop,
        anonymousId: `postpurchase:${input.referenceId}`,
      },
    },
    update: {},
    create: {
      shop: input.shop,
      anonymousId: `postpurchase:${input.referenceId}`,
      journeyStage: "buying",
      context: { checkoutReferenceId: input.referenceId },
    },
  });

  const existing = await prisma.offer.findFirst({
    where: { shop: input.shop, sessionId: session.id, widgetType: "post_purchase" },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return toPublicOffer(existing.id, existing.payload);

  const products = await prisma.product.findMany({
    where: { shop: input.shop, id: { notIn: settings.blockedProductIds } },
    orderBy: [{ orderStats: { orderCount: "desc" } }, { updatedAt: "desc" }],
    take: 50,
  });
  const purchased = new Set(input.purchasedVariantIds.map(numericId));
  const candidate = products
    .map(catalogProductToWidgetProduct)
    .find((product) => product.variantId && !purchased.has(numericId(product.variantId)));
  if (!candidate) return null;

  const shopConfig = await prisma.shopConfig.upsert({
    where: { shopDomain: input.shop },
    update: {},
    create: { shopDomain: input.shop },
  });
  const discountPercentage = clamp(shopConfig.discountPercentage, 0, 100);
  const originalPrice = Number(candidate.price || 0);
  const discountedPrice = roundCurrency(
    originalPrice * (1 - discountPercentage / 100),
  );
  const variantId = Number(numericId(candidate.variantId));
  if (!Number.isSafeInteger(variantId) || variantId <= 0) return null;

  const change: AddVariantChange = {
    type: "add_variant",
    variantId,
    quantity: 1,
    ...(discountPercentage > 0
      ? {
          discount: {
            value: discountPercentage,
            valueType: "percentage" as const,
            title: "AOVBoost post-purchase offer",
          },
        }
      : {}),
  };
  const payload = {
    product: candidate,
    originalPrice,
    discountedPrice,
    discountPercentage,
    changes: [change],
  };

  const offer = await prisma.offer.create({
    data: {
      shop: input.shop,
      sessionId: session.id,
      widgetType: "post_purchase",
      payload: payload as Prisma.InputJsonValue,
      triggerContext: {
        trigger: "post_purchase",
        checkoutReferenceId: input.referenceId,
      },
      aiProvider: "heuristic",
      shown: true,
    },
  });
  return toPublicOffer(offer.id, payload);
}

export async function signPostPurchaseChangeset(input: {
  shop: string;
  referenceId: string;
  offerId: string;
}) {
  const offer = await getValidatedOffer(input);
  if (!offer) return null;
  const payload = asRecord(offer.payload);
  const changes = Array.isArray(payload.changes) ? payload.changes : [];
  if (changes.length === 0) return null;

  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const secret = process.env.SHOPIFY_API_SECRET || "";
  if (!apiKey || !secret) throw new Error("Missing Shopify app credentials");

  await prisma.offer.update({ where: { id: offer.id }, data: { clicked: true } });
  return signJwt(
    {
      iss: apiKey,
      jti: crypto.randomUUID(),
      iat: Date.now(),
      sub: input.referenceId,
      changes,
    },
    secret,
  );
}

export async function convertPostPurchaseOffer(input: {
  shop: string;
  referenceId: string;
  offerId: string;
}) {
  const offer = await getValidatedOffer(input);
  if (!offer) return false;
  const payload = asRecord(offer.payload);
  await markOfferConversion(input.shop, offer.id, Number(payload.discountedPrice || 0));
  return true;
}

async function getValidatedOffer(input: {
  shop: string;
  referenceId: string;
  offerId: string;
}) {
  const offer = await prisma.offer.findFirst({
    where: { id: input.offerId, shop: input.shop, widgetType: "post_purchase" },
  });
  if (!offer) return null;
  const context = asRecord(offer.triggerContext);
  return String(context.checkoutReferenceId || "") === input.referenceId
    ? offer
    : null;
}

function toPublicOffer(id: string, value: unknown) {
  const payload = asRecord(value);
  return {
    id,
    product: asRecord(payload.product),
    originalPrice: Number(payload.originalPrice || 0),
    discountedPrice: Number(payload.discountedPrice || 0),
    discountPercentage: Number(payload.discountPercentage || 0),
    changes: Array.isArray(payload.changes) ? payload.changes : [],
  };
}

function numericId(value: unknown) {
  return String(value || "").split("/").pop() || "";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}
