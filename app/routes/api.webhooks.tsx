import type { ActionFunctionArgs } from "react-router";
import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { authenticate, sessionStorage } from "../shopify.server";
import { extractOrderAttribution } from "../models/attribution.server";
import { markOfferConversion } from "../models/offer.server";
import {
  deleteProduct,
  incrementOrderAffinities,
  upsertProduct,
} from "../models/product.server";
import {
  mapProductWebhook,
  type ShopifyProductInput,
} from "../models/productCatalogMapping";
import { refreshCatalogCache } from "../models/catalogCache.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  try {
    if (topic === "APP_UNINSTALLED") {
      await purgeShopData(shop);
      return new Response("OK");
    }

    if (topic === "PRODUCTS_CREATE" || topic === "PRODUCTS_UPDATE") {
      const productId = toProductGid(
        (payload as any).admin_graphql_api_id || (payload as any).id,
      );
      const product = mapProductWebhook(payload);
      if (!product) {
        if (productId) {
          await deleteProduct(shop, productId);
          await refreshCatalogCacheSafely(shop);
        }
      } else if (product.id) {
        const existing =
          topic === "PRODUCTS_UPDATE"
            ? await prisma.product.findFirst({
                where: { shop, id: product.id },
                select: { price: true, collectionIds: true, metafields: true },
              })
            : null;
        if (existing) {
          product.collectionIds = existing.collectionIds;
          product.metafields = {
            ...asRecord(existing.metafields),
            ...asRecord(product.metafields),
          } as Prisma.InputJsonObject;
        }
        await upsertProduct(shop, product);
        await recordProductSystemEvents({
          shop,
          product,
          previousPrice: existing?.price?.toString(),
          payload,
        });
        await refreshCatalogCacheSafely(shop);
      }
      return new Response("OK");
    }

    if (topic === "PRODUCTS_DELETE") {
      const productId = toProductGid(
        (payload as any).admin_graphql_api_id || (payload as any).id,
      );
      if (productId) {
        await deleteProduct(shop, productId);
        await refreshCatalogCacheSafely(shop);
      }
      return new Response("OK");
    }

    if (topic === "ORDERS_CREATE") {
      const attribution = extractOrderAttribution(payload);
      const orderId = String(
        (payload as any).admin_graphql_api_id || (payload as any).id || "",
      );
      await incrementOrderAffinities(shop, attribution.productIds, orderId);

      const knownOffers = attribution.offerIds.length
        ? await prisma.offer.findMany({
            where: { shop, id: { in: attribution.offerIds } },
            select: { id: true },
          })
        : [];
      const knownOfferIds = new Set(knownOffers.map(({ id }) => id));
      const attributedOffers = attribution.attributedOffers.filter(
        ({ offerId }) => knownOfferIds.has(offerId),
      );
      await Promise.all(
        attributedOffers.map(({ offerId, revenue }) =>
          markOfferConversion(shop, offerId, revenue),
        ),
      );

      await prisma.event.upsert({
        where: {
          event_orderId_storeId: {
            event: "conversion",
            orderId,
            storeId: shop,
          },
        },
        update: {
          timestamp: new Date((payload as any).created_at || Date.now()),
          data: {
            line_items: attribution.lineItems,
            offerIds: attributedOffers.map(({ offerId }) => offerId),
            total_price: (payload as any).total_price,
            currency: (payload as any).currency,
          },
        },
        create: {
          event: "conversion",
          orderId,
          storeId: shop,
          timestamp: new Date((payload as any).created_at || Date.now()),
          data: {
            line_items: attribution.lineItems,
            offerIds: attributedOffers.map(({ offerId }) => offerId),
            total_price: (payload as any).total_price,
            currency: (payload as any).currency,
          },
        },
      });

      return new Response("OK");
    }

    if (topic === "SHOP_REDACT") {
      await purgeShopData(shop);
      return new Response("OK");
    }

    if (topic === "CUSTOMERS_DATA_REQUEST" || topic === "CUSTOMERS_REDACT") {
      // AOVBoost stores anonymous behavioral sessions and no Shopify customer IDs.
      return new Response("OK");
    }

    if (topic === "APP_SCOPES_UPDATE") {
      const scopes = Array.isArray((payload as any).current)
        ? (payload as any).current.join(",")
        : String((payload as any).current || "");
      await Promise.all([
        prisma.session.updateMany({ where: { shop }, data: { scope: scopes } }),
        prisma.shop.updateMany({
          where: { shopDomain: shop },
          data: { scope: scopes },
        }),
      ]);
      return new Response("OK");
    }

    return new Response("Ignored");
  } catch (error) {
    console.error("AOVBoost webhook failed:", getErrorMessage(error));
    return new Response("Webhook error", { status: 500 });
  }
};

async function refreshCatalogCacheSafely(shop: string) {
  try {
    await refreshCatalogCache(shop);
  } catch (error) {
    console.warn("AOVBoost catalog cache refresh after webhook failed:", {
      shop,
      error: getErrorMessage(error),
    });
  }
}

async function deleteShopData(shop: string, deleteSessions: boolean) {
  await prisma.$transaction([
    prisma.offer.deleteMany({ where: { shop } }),
    prisma.shopperEvent.deleteMany({ where: { shop } }),
    prisma.chatMessage.deleteMany({ where: { shop } }),
    prisma.shopperSession.deleteMany({ where: { shop } }),
    prisma.bundleItem.deleteMany({ where: { bundle: { shop } } }),
    prisma.bundle.deleteMany({ where: { shop } }),
    prisma.productAffinity.deleteMany({ where: { shop } }),
    prisma.productOrderStat.deleteMany({ where: { shop } }),
    prisma.product.deleteMany({ where: { shop } }),
    prisma.experiment.deleteMany({ where: { shop } }),
    prisma.appSettings.deleteMany({ where: { shop } }),
    prisma.catalogSyncJob.deleteMany({ where: { shop } }),
    prisma.shopConfig.deleteMany({ where: { shopDomain: shop } }),
    prisma.shop.deleteMany({ where: { shopDomain: shop } }),
    prisma.event.deleteMany({ where: { storeId: shop } }),
    prisma.visitorSession.deleteMany({ where: { storeId: shop } }),
    ...(deleteSessions ? [prisma.session.deleteMany({ where: { shop } })] : []),
  ]);
}

async function purgeShopData(shop: string) {
  const sessions = await sessionStorage.findSessionsByShop(shop);
  if (sessions.length > 0) {
    await sessionStorage.deleteSessions(sessions.map(({ id }) => id));
  }
  await deleteShopData(shop, true);
}

async function recordProductSystemEvents(input: {
  shop: string;
  product: ShopifyProductInput;
  previousPrice?: string;
  payload: unknown;
}) {
  const newPrice = Number(input.product.price || 0);
  const previousPrice = Number(input.previousPrice || 0);
  if (previousPrice > 0 && newPrice > 0 && newPrice < previousPrice) {
    await prisma.event.create({
      data: {
        event: "price_drop_webhook",
        storeId: input.shop,
        timestamp: new Date(),
        data: {
          productId: input.product.id,
          title: input.product.title,
          oldPrice: previousPrice,
          newPrice,
        },
      },
    });
  }

  const inventoryQuantity = getLowestInventoryQuantity(input.payload);
  if (inventoryQuantity !== null && inventoryQuantity <= 5) {
    await prisma.event.create({
      data: {
        event: "low_inventory_alert",
        storeId: input.shop,
        timestamp: new Date(),
        data: {
          productId: input.product.id,
          title: input.product.title,
          inventoryQuantity,
        },
      },
    });
  }
}

function getLowestInventoryQuantity(payload: unknown) {
  const variants = (payload as any)?.variants;
  if (!Array.isArray(variants)) return null;

  const quantities = variants
    .map((variant) => Number(variant.inventory_quantity))
    .filter((quantity) => Number.isFinite(quantity));
  if (quantities.length === 0) return null;
  return Math.min(...quantities);
}

function toProductGid(value: unknown) {
  const text = String(value || "");
  if (!text) return "";
  return text.startsWith("gid://shopify/Product/")
    ? text
    : `gid://shopify/Product/${text}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
