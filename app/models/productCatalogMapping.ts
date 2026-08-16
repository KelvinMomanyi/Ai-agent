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

// Shopify supports far more variants per product, but embedding every one in
// Product.metafields would make hot catalog snapshots unbounded. Keep the first
// 100 canonical variants and record aovboost.variantsTruncated when more exist.
// This is independent of the sync query's metafields(first: 20) count limit.
export const MAX_SYNCED_PRODUCT_VARIANTS = 100;

export type SyncedProductVariant = {
  id: string;
  title: string;
  sku: string;
  price: string;
  compareAtPrice: string | null;
  quantityAvailable: number | null;
  availableForSale: boolean;
  selectedOptions: Array<{ name: string; value: string }>;
};

type VariantMappingOptions = {
  variantOrderCounts?: ReadonlyMap<string, number>;
};

type AdminVariant = {
  id?: unknown;
  title?: unknown;
  sku?: unknown;
  price?: unknown;
  compareAtPrice?: unknown;
  availableForSale?: unknown;
  inventoryPolicy?: unknown;
  sellableOnlineQuantity?: unknown;
  selectedOptions?: unknown;
};

export function mapAdminCatalogProductNode(
  node: any,
  options: VariantMappingOptions = {},
): ShopifyProductInput | null {
  if (!node?.id || !node?.handle) return null;
  if (
    Object.prototype.hasOwnProperty.call(node, "onlineStoreUrl") &&
    !node.onlineStoreUrl
  ) {
    return null;
  }

  const variants: SyncedProductVariant[] = (
    node.variants?.edges ||
    node.variants?.nodes ||
    []
  )
    .map((entry: any) => entry?.node || entry)
    .filter((variant: AdminVariant) => Boolean(variant?.id))
    .slice(0, MAX_SYNCED_PRODUCT_VARIANTS)
    .map(mapAdminVariant);
  if (variants.length === 0) return null;

  const sellableVariants = variants.filter(
    (variant) => variant.availableForSale,
  );
  const isAvailableForSale = sellableVariants.length > 0;
  const defaultVariant = selectDefaultVariant(
    variants,
    options.variantOrderCounts,
  );
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

  metafields["aovboost.availableForSale"] =
    booleanMetafield(isAvailableForSale);
  metafields["aovboost.hasOnlyDefaultVariant"] = booleanMetafield(
    hasOnlyDefaultVariant,
  );
  metafields["aovboost.sellableOnlineQuantity"] = numberMetafield(
    variants.reduce(
      (total: number, variant: SyncedProductVariant) =>
        total + Math.max(0, Number(variant.quantityAvailable || 0)),
      0,
    ),
  );
  metafields["aovboost.variants"] = variants;
  metafields["aovboost.variantsTruncated"] = booleanMetafield(
    Boolean(node.variants?.pageInfo?.hasNextPage),
  );
  const description = normalizeProductDescription(
    node.description || node.descriptionHtml,
  );
  if (description) {
    metafields["aovboost.description"] = textMetafield(description);
  }
  if (defaultVariant?.id) {
    metafields["aovboost.defaultVariantId"] = textMetafield(defaultVariant.id);
  }

  return {
    id: String(node.id),
    title: String(node.title || ""),
    handle: String(node.handle),
    vendor: node.vendor || null,
    productType: node.productType || null,
    tags: Array.isArray(node.tags) ? node.tags : [],
    price: defaultVariant?.price || "0",
    compareAtPrice: defaultVariant?.compareAtPrice || null,
    imageUrl:
      node.featuredMedia?.preview?.image?.url ||
      node.images?.edges?.[0]?.node?.url ||
      null,
    collectionIds: (node.collections?.edges || node.collections?.nodes || [])
      .map((entry: any) => entry?.node?.id || entry?.id)
      .filter(Boolean),
    metafields,
  };
}

export function mapProductWebhook(
  payload: unknown,
  options: VariantMappingOptions = {},
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

  const sourceVariants = Array.isArray(product.variants)
    ? product.variants.map(asRecord)
    : [];
  const optionNames = getWebhookOptionNames(product.options);
  const variants = sourceVariants
    .slice(0, MAX_SYNCED_PRODUCT_VARIANTS)
    .map((variant) => mapWebhookVariant(variant, optionNames))
    .filter((variant): variant is SyncedProductVariant => Boolean(variant));
  if (variants.length === 0) return null;

  const sellableVariants = variants.filter(
    (variant) => variant.availableForSale,
  );
  const defaultVariant = selectDefaultVariant(
    variants,
    options.variantOrderCounts,
  );
  const hasOnlyDefaultVariant = sourceVariants.length === 1;
  const metafields: Record<string, Prisma.InputJsonValue> = {
    "aovboost.availableForSale": booleanMetafield(sellableVariants.length > 0),
    "aovboost.hasOnlyDefaultVariant": booleanMetafield(hasOnlyDefaultVariant),
    "aovboost.sellableOnlineQuantity": numberMetafield(
      variants.reduce(
        (total, variant) =>
          total + Math.max(0, Number(variant.quantityAvailable || 0)),
        0,
      ),
    ),
    "aovboost.variants": variants as Prisma.InputJsonArray,
    "aovboost.variantsTruncated": booleanMetafield(
      sourceVariants.length > MAX_SYNCED_PRODUCT_VARIANTS,
    ),
  };

  if (defaultVariant?.id) {
    metafields["aovboost.defaultVariantId"] = textMetafield(defaultVariant.id);
  }
  const description = normalizeProductDescription(
    product.body_html || product.bodyHtml || product.description,
  );
  if (description) {
    metafields["aovboost.description"] = textMetafield(description);
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
    price: defaultVariant?.price || "0",
    compareAtPrice: defaultVariant?.compareAtPrice || null,
    imageUrl:
      String(
        asRecord(product.image).src ||
          asRecord(product.image).url ||
          asRecord(Array.isArray(product.images) ? product.images[0] : null)
            .src ||
          asRecord(Array.isArray(product.images) ? product.images[0] : null)
            .url ||
          "",
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

  const requestedId = String(
    candidates.find((value) => typeof value === "string" && value) || "",
  );
  const variants = getSyncedProductVariants(metafields);
  if (variants.length > 0) {
    return (
      variants.find(
        (variant) => variant.id === requestedId && variant.availableForSale,
      )?.id ||
      variants.find((variant) => variant.availableForSale)?.id ||
      ""
    );
  }

  // Backward compatibility for catalogs synced before expanded variant data.
  if (
    readBooleanMetafield(record["aovboost.hasOnlyDefaultVariant"]) === false
  ) {
    return "";
  }
  return requestedId;
}

export function isCatalogProductAvailable(metafields: unknown) {
  const record = asRecord(metafields);
  const explicit = readBooleanMetafield(record["aovboost.availableForSale"]);
  if (explicit !== undefined) return explicit;
  const variants = getSyncedProductVariants(metafields);
  return (
    variants.length === 0 ||
    variants.some((variant) => variant.availableForSale)
  );
}

export function getSyncedProductVariants(
  metafields: unknown,
): SyncedProductVariant[] {
  const record = asRecord(metafields);
  const raw = readJsonValue(record["aovboost.variants"]);
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  return raw
    .map((value) => normalizeSyncedVariant(value))
    .filter((variant): variant is SyncedProductVariant => Boolean(variant))
    .filter((variant) => {
      if (seen.has(variant.id)) return false;
      seen.add(variant.id);
      return true;
    })
    .slice(0, MAX_SYNCED_PRODUCT_VARIANTS);
}

export function selectDefaultVariant(
  variants: SyncedProductVariant[],
  orderCounts?: ReadonlyMap<string, number>,
) {
  if (variants.length === 0) return null;
  const available = variants.filter((variant) => variant.availableForSale);
  const candidates = available.length > 0 ? available : variants;
  let popular: SyncedProductVariant | null = null;
  let popularOrders = 0;

  for (const variant of candidates) {
    const orders = Math.max(0, Number(orderCounts?.get(variant.id) || 0));
    if (orders > popularOrders) {
      popular = variant;
      popularOrders = orders;
    }
  }

  return popular || candidates[0];
}

function mapAdminVariant(variant: AdminVariant): SyncedProductVariant {
  const quantityAvailable = toNullableNumber(variant.sellableOnlineQuantity);
  const availableForSale =
    typeof variant.availableForSale === "boolean"
      ? variant.availableForSale
      : isAdminVariantSellable(variant);
  return {
    id: String(variant.id),
    title: String(variant.title || "Default"),
    sku: String(variant.sku || ""),
    price: String(variant.price || "0"),
    compareAtPrice:
      variant.compareAtPrice === null || variant.compareAtPrice === undefined
        ? null
        : String(variant.compareAtPrice),
    quantityAvailable,
    availableForSale,
    selectedOptions: normalizeSelectedOptions(variant.selectedOptions),
  };
}

function mapWebhookVariant(
  variant: Record<string, unknown>,
  optionNames: string[],
): SyncedProductVariant | null {
  const id = toVariantGid(
    variant.admin_graphql_api_id || variant.adminGraphqlApiId || variant.id,
  );
  if (!id) return null;

  const quantityAvailable = toNullableNumber(
    variant.inventory_quantity ?? variant.inventoryQuantity,
  );
  const selectedOptions = optionNames
    .map((name, index) => ({
      name,
      value: String(variant[`option${index + 1}`] || ""),
    }))
    .filter((option) => option.value);

  return {
    id,
    title: String(variant.title || "Default"),
    sku: String(variant.sku || ""),
    price: String(variant.price || "0"),
    compareAtPrice:
      variant.compare_at_price === null && variant.compareAtPrice === undefined
        ? null
        : String(variant.compare_at_price ?? variant.compareAtPrice ?? "") ||
          null,
    quantityAvailable,
    availableForSale: isWebhookVariantSellable(variant),
    selectedOptions,
  };
}

function normalizeSyncedVariant(value: unknown): SyncedProductVariant | null {
  const variant = asRecord(value);
  const id = String(variant.id || "");
  const price = Number(variant.price);
  if (
    !id.startsWith("gid://shopify/ProductVariant/") ||
    !Number.isFinite(price)
  ) {
    return null;
  }

  return {
    id,
    title: String(variant.title || "Default"),
    sku: String(variant.sku || ""),
    price: String(variant.price),
    compareAtPrice:
      variant.compareAtPrice === null || variant.compareAtPrice === undefined
        ? null
        : String(variant.compareAtPrice),
    quantityAvailable: toNullableNumber(variant.quantityAvailable),
    availableForSale: variant.availableForSale === true,
    selectedOptions: normalizeSelectedOptions(variant.selectedOptions),
  };
}

function normalizeSelectedOptions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((option) => asRecord(option))
    .map((option) => ({
      name: String(option.name || ""),
      value: String(option.value || ""),
    }))
    .filter((option) => option.name && option.value);
}

function getWebhookOptionNames(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((option) => String(asRecord(option).name || ""))
    .filter(Boolean)
    .slice(0, 3);
}

function readJsonValue(value: unknown) {
  const raw = asRecord(value).value ?? value;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function normalizeProductDescription(value: unknown) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim()
    .slice(0, 6_000);
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
