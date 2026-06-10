import type { ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { queues } from "../redis.server";
import { authenticate } from "../shopify.server";
import {
  deleteProduct,
  incrementOrderAffinities,
  upsertProduct,
} from "../models/product.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, session } = await authenticate.webhook(request);

  try {
    if (topic === "APP_UNINSTALLED") {
      await deleteShopData(shop, Boolean(session));
      return new Response("OK");
    }

    if (topic === "PRODUCTS_CREATE" || topic === "PRODUCTS_UPDATE") {
      const product = mapProductWebhook(payload);
      if (product.id) {
        const existing =
          topic === "PRODUCTS_UPDATE"
            ? await prisma.product.findFirst({
                where: { shop, id: product.id },
                select: { price: true },
              })
            : null;
        await upsertProduct(shop, product);
        await recordProductSystemEvents({
          shop,
          product,
          previousPrice: existing?.price?.toString(),
          payload,
        });
        await queues.recomputeAffinityQueue.add("recompute-affinity", {
          shop,
          productId: product.id,
        });
      }
      return new Response("OK");
    }

    if (topic === "PRODUCTS_DELETE") {
      const productId = toProductGid((payload as any).admin_graphql_api_id || (payload as any).id);
      if (productId) await deleteProduct(shop, productId);
      return new Response("OK");
    }

    if (topic === "ORDERS_CREATE") {
      const productIds = ((payload as any).line_items || [])
        .map((item: any) =>
          toProductGid(item.product_id || item.admin_graphql_api_id || item.product?.id),
        )
        .filter(Boolean);
      await incrementOrderAffinities(shop, productIds);

      const orderId = String((payload as any).admin_graphql_api_id || (payload as any).id || "");
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
            line_items: productIds.map((productId: string) => ({ product_id: productId })),
            total_price: (payload as any).total_price,
          },
        },
        create: {
          event: "conversion",
          orderId,
          storeId: shop,
          timestamp: new Date((payload as any).created_at || Date.now()),
          data: {
            line_items: productIds.map((productId: string) => ({ product_id: productId })),
            total_price: (payload as any).total_price,
          },
        },
      });

      return new Response("OK");
    }

    return new Response("Ignored");
  } catch (error) {
    console.error("AOVBoost webhook failed:", getErrorMessage(error));
    return new Response("Webhook error", { status: 500 });
  }
};

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
    prisma.shopConfig.deleteMany({ where: { shopDomain: shop } }),
    prisma.shop.deleteMany({ where: { shopDomain: shop } }),
    prisma.event.deleteMany({ where: { storeId: shop } }),
    prisma.visitorSession.deleteMany({ where: { storeId: shop } }),
    ...(deleteSessions ? [prisma.session.deleteMany({ where: { shop } })] : []),
  ]);
}

function mapProductWebhook(payload: unknown) {
  const product = payload as any;
  const variant = product.variants?.[0] || {};

  return {
    id: toProductGid(product.admin_graphql_api_id || product.id),
    title: String(product.title || ""),
    handle: String(product.handle || ""),
    vendor: product.vendor || null,
    productType: product.product_type || product.productType || null,
    tags:
      typeof product.tags === "string"
        ? product.tags.split(",").map((tag: string) => tag.trim()).filter(Boolean)
        : product.tags || [],
    price: variant.price || "0",
    compareAtPrice: variant.compare_at_price || null,
    imageUrl: product.image?.src || product.image?.url || null,
    collectionIds: [],
    metafields: {
      "aovboost.defaultVariantId": {
        value: toVariantGid(variant.admin_graphql_api_id || variant.id),
        type: "single_line_text_field",
      },
    },
  };
}

async function recordProductSystemEvents(input: {
  shop: string;
  product: ReturnType<typeof mapProductWebhook>;
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

function toVariantGid(value: unknown) {
  const text = String(value || "");
  if (!text) return "";
  return text.startsWith("gid://shopify/ProductVariant/")
    ? text
    : `gid://shopify/ProductVariant/${text}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
