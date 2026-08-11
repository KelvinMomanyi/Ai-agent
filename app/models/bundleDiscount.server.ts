import { createHash } from "node:crypto";
import prisma from "../db.server";
import { refreshCatalogCache } from "./catalogCache.server";

export const BUNDLE_DISCOUNT_TYPES = [
  "none",
  "percentage",
  "fixed_amount",
] as const;

export type BundleDiscountType = (typeof BUNDLE_DISCOUNT_TYPES)[number];

export type ShopifyAdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<any> }>;
};

type BundleDiscountInput = {
  discountType: string;
  discountValue: unknown;
  items: Array<{ productId: string; quantity: number }>;
};

type NormalizedBundleDiscount<T extends BundleDiscountInput> = Omit<
  T,
  "discountType" | "discountValue"
> & {
  discountType: BundleDiscountType;
  discountValue: number;
};

type BundleDiscountSource = BundleDiscountInput & {
  id: string;
  isActive: boolean;
};

type FunctionBundle = {
  id: string;
  version: string;
  discountType: Exclude<BundleDiscountType, "none">;
  discountValue: number;
  items: Array<{ productId: string; quantity: number }>;
};

const FUNCTION_HANDLE = "aovboost-bundle-discount";
const CONFIG_NAMESPACE = "$app:aovboost-bundle-discount";
const CONFIG_KEY = "function-configuration";
const MAX_FUNCTION_CONFIG_BYTES = 9_500;

export class BundleValidationError extends Error {
  constructor(
    public readonly field: "discountType" | "discountValue" | "items",
    message: string,
  ) {
    super(message);
    this.name = "BundleValidationError";
  }
}

export function normalizeBundleDiscount<T extends BundleDiscountInput>(
  input: T,
): NormalizedBundleDiscount<T> {
  if (
    !BUNDLE_DISCOUNT_TYPES.includes(input.discountType as BundleDiscountType)
  ) {
    throw new BundleValidationError(
      "discountType",
      "Choose no discount, percentage, or fixed amount.",
    );
  }

  if (input.discountType === "none") {
    return {
      ...input,
      discountType: "none",
      discountValue: 0,
    };
  }

  const parsedValue = Number(input.discountValue);
  if (!Number.isFinite(parsedValue)) {
    throw new BundleValidationError(
      "discountValue",
      "Enter a valid discount value.",
    );
  }

  const discountValue = roundToTwoDecimals(parsedValue);
  if (input.discountType === "percentage") {
    if (discountValue < 1 || discountValue > 50) {
      throw new BundleValidationError(
        "discountValue",
        "Percentage discounts must be between 1% and 50%.",
      );
    }
  } else if (discountValue <= 0) {
    throw new BundleValidationError(
      "discountValue",
      "Fixed-amount discounts must be greater than zero.",
    );
  }

  return {
    ...input,
    discountType: input.discountType,
    discountValue,
  } as NormalizedBundleDiscount<T>;
}

/**
 * Refreshes the bundle item prices from Shopify and validates fixed discounts
 * against the resulting line-price sum. Shopify remains authoritative for the
 * base price; the local Product rows are refreshed so the next widget payload
 * uses the same snapshot that was validated here.
 */
export async function validateBundleDiscountAgainstCatalog(
  shop: string,
  input: BundleDiscountInput,
  admin: ShopifyAdminGraphql,
) {
  const normalized = normalizeBundleDiscount(input);
  if (normalized.discountType === "none") return 0;

  const quantitiesByProduct = new Map<string, number>();
  for (const item of normalized.items) {
    quantitiesByProduct.set(
      item.productId,
      (quantitiesByProduct.get(item.productId) || 0) + item.quantity,
    );
  }

  let response: Awaited<ReturnType<ShopifyAdminGraphql["graphql"]>>;
  try {
    response = await admin.graphql(
      `#graphql
      query AOVBoostBundleCatalogPrices($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            variants(first: 100) {
              nodes {
                id
                price
                inventoryPolicy
                sellableOnlineQuantity
              }
            }
          }
        }
      }`,
      { variables: { ids: Array.from(quantitiesByProduct.keys()) } },
    );
  } catch (error) {
    console.warn("Unable to read live Shopify prices for bundle discount", {
      shop,
      error,
    });
    throw new BundleValidationError(
      "discountValue",
      "Shopify prices could not be verified. Try saving again.",
    );
  }

  const result = await response.json();
  assertGraphqlSuccess(result, "Shopify prices could not be verified");
  const nodes = Array.isArray(result.data?.nodes) ? result.data.nodes : [];
  const priceByProduct = new Map<string, number>();

  for (const node of nodes) {
    if (!node?.id) continue;
    const price = selectCatalogPrice(node.variants?.nodes);
    if (price !== null) priceByProduct.set(String(node.id), price);
  }

  const missingProductIds = Array.from(quantitiesByProduct.keys()).filter(
    (productId) => !priceByProduct.has(productId),
  );
  if (missingProductIds.length > 0) {
    throw new BundleValidationError(
      "items",
      "Every bundle item must still exist in Shopify and have a priced variant.",
    );
  }

  await Promise.all(
    Array.from(priceByProduct, ([id, price]) =>
      prisma.product.updateMany({
        where: { shop, id },
        data: { price: price.toFixed(2) },
      }),
    ),
  );
  await refreshCatalogCache(shop);

  const catalogTotalCents = Array.from(
    quantitiesByProduct,
    ([productId, quantity]) =>
      Math.round((priceByProduct.get(productId) || 0) * 100) * quantity,
  ).reduce((total, lineTotal) => total + lineTotal, 0);
  const catalogTotal = catalogTotalCents / 100;

  assertBundleDiscountWithinCatalogTotal(normalized, catalogTotal);

  return catalogTotal;
}

export function assertBundleDiscountWithinCatalogTotal(
  input: {
    discountType: BundleDiscountType;
    discountValue: string | number;
  },
  catalogTotal: number,
) {
  if (
    input.discountType === "fixed_amount" &&
    Number(input.discountValue) >= catalogTotal
  ) {
    throw new BundleValidationError(
      "discountValue",
      `Fixed discount must be less than the live bundle total (${catalogTotal.toFixed(2)}).`,
    );
  }
}

export function getBundleDiscountVersion(bundle: BundleDiscountSource) {
  const normalized = normalizeBundleDiscount(bundle);
  if (normalized.discountType === "none") return "";

  const items = normalizeFunctionItems(normalized.items);
  const canonicalValue = Number(normalized.discountValue).toFixed(2);
  const canonicalItems = items
    .map((item) => `${item.productId}:${item.quantity}`)
    .join("|");

  return createHash("sha256")
    .update(
      `${bundle.id}|${normalized.discountType}|${canonicalValue}|${canonicalItems}`,
    )
    .digest("hex")
    .slice(0, 24);
}

/**
 * Keeps a single automatic app discount per shop. The Function configuration
 * contains only active bundle definitions and is updated atomically through a
 * JSON metafield owned by the automatic discount node.
 */
export async function syncBundleDiscountFunction(
  shop: string,
  admin: ShopifyAdminGraphql,
  transitionalBundles: BundleDiscountSource[] = [],
) {
  const [settings, activeBundles] = await Promise.all([
    prisma.appSettings.upsert({
      where: { shop },
      update: {},
      create: { shop },
    }),
    prisma.bundle.findMany({
      where: { shop, isActive: true },
      include: { items: true },
    }),
  ]);

  const activeFunctionBundles = dedupeFunctionBundles(
    activeBundles
      .map(toFunctionBundle)
      .filter((bundle): bundle is FunctionBundle => Boolean(bundle)),
  );
  const transitionalFunctionBundles = transitionalBundles
    .map(toFunctionBundle)
    .filter((bundle): bundle is FunctionBundle => Boolean(bundle));
  let functionBundles = dedupeFunctionBundles([
    ...activeFunctionBundles,
    ...transitionalFunctionBundles,
  ]);
  let configuration = serializeFunctionConfiguration(functionBundles);

  // Previous versions keep already-rendered widgets price-consistent during
  // an edit. If that grace data would exceed Shopify's 10 KB Function input
  // metafield limit, prefer the current active definitions.
  if (
    byteLength(configuration) > MAX_FUNCTION_CONFIG_BYTES &&
    transitionalFunctionBundles.length > 0
  ) {
    functionBundles = activeFunctionBundles;
    configuration = serializeFunctionConfiguration(functionBundles);
  }
  if (byteLength(configuration) > MAX_FUNCTION_CONFIG_BYTES) {
    throw new BundleValidationError(
      "discountValue",
      "There are too many active bundle discount definitions for Shopify. Deactivate another discounted bundle and try again.",
    );
  }

  if (!settings.bundleDiscountId && functionBundles.length === 0) return;

  let discountId = settings.bundleDiscountId;
  if (discountId) {
    try {
      await setFunctionConfiguration(admin, discountId, configuration);
      return;
    } catch (error) {
      if (!isMissingDiscountError(error)) throw error;
      discountId = null;
      await prisma.appSettings.update({
        where: { shop },
        data: { bundleDiscountId: null },
      });
    }
  }

  if (functionBundles.length === 0) return;

  const createdDiscountId = await createAutomaticDiscount(admin, configuration);
  await prisma.appSettings.update({
    where: { shop },
    data: { bundleDiscountId: createdDiscountId },
  });
}

function toFunctionBundle(bundle: BundleDiscountSource): FunctionBundle | null {
  if (!bundle.isActive) return null;

  const normalized = normalizeBundleDiscount(bundle);
  if (normalized.discountType === "none") return null;

  const items = normalizeFunctionItems(normalized.items);
  if (items.length === 0) return null;

  return {
    id: bundle.id,
    version: getBundleDiscountVersion({ ...bundle, ...normalized, items }),
    discountType: normalized.discountType,
    discountValue: Number(normalized.discountValue),
    items,
  };
}

function normalizeFunctionItems(
  items: Array<{ productId: string; quantity: number }>,
) {
  const quantities = new Map<string, number>();
  for (const item of items) {
    const productId = String(item.productId || "").trim();
    const quantity = Math.max(1, Math.floor(Number(item.quantity || 1)));
    if (!productId) continue;
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
  }

  return Array.from(quantities, ([productId, quantity]) => ({
    productId,
    quantity,
  })).sort((left, right) => left.productId.localeCompare(right.productId));
}

function dedupeFunctionBundles(bundles: FunctionBundle[]) {
  return Array.from(
    new Map(
      bundles.map((bundle) => [`${bundle.id}:${bundle.version}`, bundle]),
    ).values(),
  );
}

function serializeFunctionConfiguration(bundles: FunctionBundle[]) {
  return JSON.stringify({ schemaVersion: 1, bundles });
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

async function createAutomaticDiscount(
  admin: ShopifyAdminGraphql,
  configuration: string,
) {
  const response = await admin.graphql(
    `#graphql
    mutation AOVBoostBundleDiscountCreate(
      $automaticAppDiscount: DiscountAutomaticAppInput!
    ) {
      discountAutomaticAppCreate(
        automaticAppDiscount: $automaticAppDiscount
      ) {
        automaticAppDiscount { discountId }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        automaticAppDiscount: {
          title: "AOVBoost bundle discounts",
          functionHandle: FUNCTION_HANDLE,
          discountClasses: ["PRODUCT"],
          startsAt: new Date().toISOString(),
          combinesWith: {
            orderDiscounts: true,
            productDiscounts: false,
            shippingDiscounts: true,
          },
          metafields: [configurationMetafield(configuration)],
        },
      },
    },
  );
  const result = await response.json();
  assertGraphqlSuccess(result, "Shopify bundle discount could not be created");
  const payload = result.data?.discountAutomaticAppCreate;
  assertUserErrors(
    payload?.userErrors,
    "Shopify bundle discount could not be created",
  );
  const discountId = String(payload?.automaticAppDiscount?.discountId || "");
  if (!discountId) {
    throw new BundleValidationError(
      "discountValue",
      "Shopify did not return an automatic discount ID.",
    );
  }
  return discountId;
}

async function setFunctionConfiguration(
  admin: ShopifyAdminGraphql,
  discountId: string,
  configuration: string,
) {
  const response = await admin.graphql(
    `#graphql
    mutation AOVBoostBundleDiscountConfiguration(
      $metafields: [MetafieldsSetInput!]!
    ) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key }
        userErrors { field message code }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: discountId,
            ...configurationMetafield(configuration),
          },
        ],
      },
    },
  );
  const result = await response.json();
  assertGraphqlSuccess(result, "Shopify bundle discount could not be updated");
  assertUserErrors(
    result.data?.metafieldsSet?.userErrors,
    "Shopify bundle discount could not be updated",
  );
}

function configurationMetafield(value: string) {
  return {
    namespace: CONFIG_NAMESPACE,
    key: CONFIG_KEY,
    type: "json",
    value,
  };
}

function assertGraphqlSuccess(result: any, fallback: string) {
  if (!Array.isArray(result?.errors) || result.errors.length === 0) return;
  throw new BundleValidationError(
    "discountValue",
    `${fallback}: ${result.errors
      .map((error: any) => String(error?.message || "Unknown GraphQL error"))
      .join("; ")}`,
  );
}

function assertUserErrors(errors: unknown, fallback: string) {
  if (!Array.isArray(errors) || errors.length === 0) return;
  throw new BundleValidationError(
    "discountValue",
    `${fallback}: ${errors
      .map((error: any) => String(error?.message || "Unknown Shopify error"))
      .join("; ")}`,
  );
}

function isMissingDiscountError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /does not exist|not found|invalid.*owner|owner.*invalid/i.test(
    message,
  );
}

function selectCatalogPrice(value: unknown) {
  const variants = Array.isArray(value)
    ? value.filter(
        (variant) =>
          variant &&
          Number.isFinite(Number(variant.price)) &&
          Number(variant.price) >= 0,
      )
    : [];
  if (variants.length === 0) return null;

  const sellable = variants.filter(
    (variant) =>
      String(variant.inventoryPolicy || "").toUpperCase() === "CONTINUE" ||
      Number(variant.sellableOnlineQuantity || 0) > 0,
  );
  const candidates = sellable.length > 0 ? sellable : variants;
  return Math.min(...candidates.map((variant) => Number(variant.price)));
}

function roundToTwoDecimals(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
