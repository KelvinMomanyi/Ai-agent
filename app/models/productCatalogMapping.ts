import type { Prisma } from "@prisma/client";

export type ShopifyProductInput = {
  id: string;
  title: string;
  handle: string;
  vendor?: string | null;
  productType?: string | null;
  tags?: string[];
  price?: string | number;
  compareAtPrice?: string | number | null;
  imageUrl?: string | null;
  collectionIds?: string[];
  metafields?: Prisma.InputJsonValue;
};

type AdminVariant = {
  id?: unknown;
  price?: unknown;
  compareAtPrice?: unknown;
  inventoryPolicy?: unknown;
  sellableOnlineQuantity?: unknown;
};

export function mapAdminCatalogProductNode(
  node: any,
): ShopifyProductInput | null {
  if (!node?.id || !node?.handle) return null;

  const variants = (node.variants?.edges || node.variants?.nodes || [])
    .map((entry: any) => entry?.node || entry)
    .filter((variant: AdminVariant) => Boolean(variant?.id));
  if (variants.length === 0) return null;

  const sellableVariants = variants.filter(isAdminVariantSellable);
  const selectedVariants = sellableVariants.length > 0 ? sellableVariants : variants;
  const isAvailableForSale = sellableVariants.length > 0;

  const pricedVariant = selectedVariants
    .slice()
    .sort(
      (left: AdminVariant, right: AdminVariant) =>
        Number(left.price || 0) - Number(right.price || 0),
    )[0];
  const metafields = Object.fromEntries(
    (node.metafields?.edges || node.metafields?.nodes || []).map(
      (entry: any) => {
        const metafield = entry?.node || entry;
        return [
          `${metafield.namespace}.${metafield.key}`,
          { value: metafield.value, type: metafield.type },
        ];
      },
    ),
  );
  const hasOnlyDefaultVariant = node.hasOnlyDefaultVariant === true;

  metafields["aovboost.availableForSale"] = booleanMetafield(isAvailableForSale);
  metafields["aovboost.hasOnlyDefaultVariant"] = booleanMetafield(
    hasOnlyDefaultVariant,
  );
  metafields["aovboost.sellableOnlineQuantity"] = numberMetafield(
    variants.reduce(
      (total: number, variant: AdminVariant) =>
        total + Math.max(0, Number(variant.sellableOnlineQuantity || 0)),
      0,
    ),
  );
  if (hasOnlyDefaultVariant && pricedVariant?.id) {
    metafields["aovboost.defaultVariantId"] = textMetafield(
      String(pricedVariant.id),
    );
  }

  return {
    id: String(node.id),
    title: String(node.title || ""),
    handle: String(node.handle),
    vendor: node.vendor || null,
    productType: node.productType || null,
    tags: Array.isArray(node.tags) ? node.tags : [],
    price: String(pricedVariant?.price || "0"),
    compareAtPrice: pricedVariant?.compareAtPrice || null,
    imageUrl: node.featuredMedia?.preview?.image?.url || node.images?.edges?.[0]?.node?.url || null,
    collectionIds: (node.collections?.edges || node.collections?.nodes || [])
      .map((entry: any) => entry?.node?.id || entry?.id)
      .filter(Boolean),
    metafields,
  };
}

export function mapProductWebhook(
  payload: unknown,
): ShopifyProductInput | null {
  const product = asRecord(payload);
  const productId = toProductGid(
    product.admin_graphql_api_id || product.adminGraphqlApiId || product.id,
  );
  const handle = String(product.handle || "");
  const status = String(product.status || "").toLowerCase();
  const publishedAt = Object.prototype.hasOwnProperty.call(
    product,
    "published_at",
  )
    ? product.published_at
    : product.publishedAt;

  if (!productId || !handle || (status && status !== "active")) return null;
  if (publishedAt === null || publishedAt === "") return null;

  const variants = Array.isArray(product.variants)
    ? product.variants.map(asRecord)
    : [];
  const sellableVariants = variants.filter(isWebhookVariantSellable);
  if (sellableVariants.length === 0) return null;

  const pricedVariant = sellableVariants
    .slice()
    .sort(
      (left, right) => Number(left.price || 0) - Number(right.price || 0),
    )[0];
  const hasOnlyDefaultVariant = variants.length === 1;
  const metafields: Record<string, Prisma.InputJsonValue> = {
    "aovboost.availableForSale": booleanMetafield(true),
    "aovboost.hasOnlyDefaultVariant": booleanMetafield(hasOnlyDefaultVariant),
    "aovboost.sellableOnlineQuantity": numberMetafield(
      sellableVariants.reduce(
        (total, variant) =>
          total +
          Math.max(
            0,
            Number(
              variant.inventory_quantity ?? variant.inventoryQuantity ?? 0,
            ),
          ),
        0,
      ),
    ),
  };

  if (hasOnlyDefaultVariant) {
    const variantId = toVariantGid(
      pricedVariant.admin_graphql_api_id ||
        pricedVariant.adminGraphqlApiId ||
        pricedVariant.id,
    );
    if (variantId) {
      metafields["aovboost.defaultVariantId"] = textMetafield(variantId);
    }
  }

  return {
    id: productId,
    title: String(product.title || ""),
    handle,
    vendor: typeof product.vendor === "string" ? product.vendor : null,
    productType:
      String(product.product_type || product.productType || "") || null,
    tags:
      typeof product.tags === "string"
        ? product.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : Array.isArray(product.tags)
          ? product.tags.map(String)
          : [],
    price: String(pricedVariant.price || "0"),
    compareAtPrice:
      pricedVariant.compare_at_price || pricedVariant.compareAtPrice || null,
    imageUrl:
      String(
        asRecord(product.image).src || asRecord(product.image).url || "",
      ) || null,
    collectionIds: [],
    metafields,
  };
}

export function getSafeDefaultVariantId(metafields: unknown) {
  const record = asRecord(metafields);
  if (readBooleanMetafield(record["aovboost.availableForSale"]) === false) {
    return "";
  }
  if (
    readBooleanMetafield(record["aovboost.hasOnlyDefaultVariant"]) === false
  ) {
    return "";
  }

  const candidates = [
    record.defaultVariantId,
    record.variantId,
    record["aovboost.defaultVariantId"],
    record["aovboost.variantId"],
    asRecord(record.defaultVariantId).value,
    asRecord(record.variantId).value,
    asRecord(record["aovboost.defaultVariantId"]).value,
    asRecord(record["aovboost.variantId"]).value,
  ];

  return String(
    candidates.find((value) => typeof value === "string" && value) || "",
  );
}

export function isCatalogProductAvailable(metafields: unknown) {
  return (
    readBooleanMetafield(asRecord(metafields)["aovboost.availableForSale"]) !==
    false
  );
}

function isAdminVariantSellable(variant: AdminVariant) {
  if (String(variant.inventoryPolicy || "").toUpperCase() === "CONTINUE") {
    return true;
  }
  return Number(variant.sellableOnlineQuantity || 0) > 0;
}

function isWebhookVariantSellable(variant: Record<string, unknown>) {
  const policy = String(
    variant.inventory_policy || variant.inventoryPolicy || "",
  ).toLowerCase();
  if (policy === "continue") return true;

  const inventoryManagement =
    variant.inventory_management ?? variant.inventoryManagement;
  if (inventoryManagement === null || inventoryManagement === "") return true;

  const quantity = Number(
    variant.inventory_quantity ?? variant.inventoryQuantity ?? 0,
  );
  return Number.isFinite(quantity) && quantity > 0;
}

function readBooleanMetafield(value: unknown): boolean | undefined {
  const raw = asRecord(value).value ?? value;
  if (raw === true || raw === "true" || raw === 1 || raw === "1") return true;
  if (raw === false || raw === "false" || raw === 0 || raw === "0")
    return false;
  return undefined;
}

function booleanMetafield(value: boolean) {
  return { value: String(value), type: "boolean" };
}

function textMetafield(value: string) {
  return { value, type: "single_line_text_field" };
}

function numberMetafield(value: number) {
  return { value: String(value), type: "number_integer" };
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

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}
