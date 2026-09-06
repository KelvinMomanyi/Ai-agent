import type {
  CatalogCacheProduct,
  CatalogSnapshot,
} from "../models/catalogCache.server";
import type { GroundedCartContext } from "../models/chatResponse";
import type { StoreKnowledge } from "../models/storeKnowledge.server";
import type { AgentToolCall, MerchantSalesSettings } from "./types";

export type ValidatedCartMutation = {
  type: "add_to_cart";
  productId: string;
  productTitle: string;
  variantId: string;
  quantity: number;
};

export type ValidatedCartLineMutation =
  | { type: "remove_from_cart"; lineId: string }
  | { type: "update_cart_line"; lineId: string; quantity: number };

export type CommerceSearchFilters = {
  budgetMin?: number;
  budgetMax?: number;
  productType?: string;
  colors?: string[];
  sizes?: string[];
};

export function createCommerceToolLayer(input: {
  shop: string;
  catalog: CatalogSnapshot;
  cart: GroundedCartContext;
  store: StoreKnowledge;
  settings: MerchantSalesSettings;
}) {
  const allowedProducts = input.catalog.products.filter(
    (product) =>
      product.availableForSale &&
      !input.settings.excludedProductIds.includes(product.id) &&
      !product.collectionIds?.some((id) =>
        input.settings.excludedCollectionIds.includes(id),
      ),
  );
  const byId = new Map(allowedProducts.map((product) => [product.id, product]));

  return {
    capabilities: [
      "search_products",
      "get_product",
      "get_variants",
      "check_inventory",
      "compare_products",
      "get_cart",
      "add_to_cart",
      "get_related_products",
      "get_shipping_information",
      "get_return_policy",
      "create_bundle_suggestion",
    ] as const,

    searchProducts(
      query: string,
      filters: CommerceSearchFilters = {},
      limit = 8,
    ) {
      const terms = tokenize(query);
      return allowedProducts
        .filter((product) => matchesSearchFilters(product, filters))
        .map((product) => ({
          product,
          score: terms.reduce(
            (score, term) =>
              score + (product.searchText.toLowerCase().includes(term) ? 1 : 0),
            0,
          ),
        }))
        .filter((entry) => terms.length === 0 || entry.score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            Number(right.product.orderCount || 0) -
              Number(left.product.orderCount || 0),
        )
        .slice(0, clamp(limit, 1, 20))
        .map((entry) => entry.product);
    },

    getProduct(productId: string) {
      return byId.get(productId) || null;
    },

    getProductVariants(productId: string) {
      return (byId.get(productId)?.variants || []).filter(
        (variant) => variant.availableForSale,
      );
    },

    checkInventory(variantId: string) {
      for (const product of allowedProducts) {
        const variant = product.variants.find((item) => item.id === variantId);
        if (variant) {
          return {
            productId: product.id,
            variantId: variant.id,
            availableForSale: variant.availableForSale,
            quantityAvailable: variant.quantityAvailable,
          };
        }
      }
      return null;
    },

    compareProducts(productIds: string[]) {
      return productIds
        .slice(0, 4)
        .map((id) => byId.get(id))
        .filter((product): product is CatalogCacheProduct => Boolean(product))
        .map(toComparableProduct);
    },

    getCart() {
      return input.cart;
    },

    validateAddToCart(
      value: unknown,
      options: { explicitlyRequested: boolean },
    ): ValidatedCartMutation | null {
      if (!options.explicitlyRequested) return null;
      const action = asRecord(value);
      const product = byId.get(String(action.productId || ""));
      if (!product) return null;
      const variantId = String(action.variantId || "");
      const variant = product.variants.find(
        (item) => item.id === variantId && item.availableForSale,
      );
      const quantity = Number(action.quantity ?? 1);
      if (
        !variant ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 10
      )
        return null;
      if (
        variant.quantityAvailable !== null &&
        variant.quantityAvailable < quantity
      )
        return null;
      return {
        type: "add_to_cart",
        productId: product.id,
        productTitle: `${product.title}${variant.title && !/^default(?: title)?$/i.test(variant.title) ? ` (${variant.title})` : ""}`,
        variantId: variant.id,
        quantity,
      };
    },

    validateRemoveFromCart(
      value: unknown,
      options: { explicitlyRequested: boolean },
    ): ValidatedCartLineMutation | null {
      if (!options.explicitlyRequested) return null;
      const lineId = String(asRecord(value).lineId || "").slice(0, 160);
      if (!lineId || !input.cart.items.some((item) => item.lineId === lineId)) {
        return null;
      }
      return { type: "remove_from_cart", lineId };
    },

    validateUpdateCartLine(
      value: unknown,
      options: { explicitlyRequested: boolean },
    ): ValidatedCartLineMutation | null {
      if (!options.explicitlyRequested) return null;
      const action = asRecord(value);
      const lineId = String(action.lineId || "").slice(0, 160);
      const quantity = Number(action.quantity);
      if (
        !lineId ||
        !input.cart.items.some((item) => item.lineId === lineId) ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 10
      ) {
        return null;
      }
      return { type: "update_cart_line", lineId, quantity };
    },

    getRelatedProducts(productId: string) {
      const source = byId.get(productId);
      if (!source) return [];
      return allowedProducts
        .filter(
          (product) =>
            product.id !== source.id &&
            (product.category === source.category ||
              product.tags.some((tag) => source.tags.includes(tag))),
        )
        .slice(0, 8);
    },

    getShippingInformation() {
      return input.store.policies.filter((policy) =>
        /shipping/i.test(policy.type),
      );
    },

    getReturnPolicy() {
      return input.store.policies.filter((policy) =>
        /refund|return/i.test(`${policy.type} ${policy.title}`),
      );
    },

    createBundleSuggestion(productIds: string[]) {
      if (!input.settings.bundleSupportEnabled) return [];
      return productIds
        .slice(0, 3)
        .map((id) => byId.get(id))
        .filter((product): product is CatalogCacheProduct => Boolean(product));
    },

    validateDiscount(code: string) {
      const normalized = code.trim().toLowerCase();
      if (!input.settings.discountPermission || !normalized) return null;
      return (
        input.settings.allowedDiscountCodes.find(
          (allowed) => allowed.trim().toLowerCase() === normalized,
        ) || null
      );
    },

    validateToolCall(call: AgentToolCall) {
      return validateAllowlistedToolCall(call, {
        productIds: new Set(byId.keys()),
        variantIds: new Set(
          allowedProducts.flatMap((product) =>
            product.variants.map((variant) => variant.id),
          ),
        ),
        discountCodes: new Set(
          input.settings.allowedDiscountCodes.map((code) =>
            code.trim().toLowerCase(),
          ),
        ),
        discountsAllowed: input.settings.discountPermission,
      });
    },
  };
}

export function validateAllowlistedToolCall(
  call: AgentToolCall,
  allowed: {
    productIds: Set<string>;
    variantIds: Set<string>;
    discountCodes: Set<string>;
    discountsAllowed: boolean;
  },
) {
  const knownTools = new Set([
    "search_products",
    "get_product",
    "get_variants",
    "check_inventory",
    "compare_products",
    "get_cart",
    "add_to_cart",
    "remove_from_cart",
    "update_cart_line",
    "get_related_products",
    "get_shipping_information",
    "get_return_policy",
    "create_bundle_suggestion",
    "apply_discount",
  ]);
  if (!knownTools.has(call.name)) return null;
  const args = asRecord(call.arguments);
  const productId = String(args.productId || "");
  const variantId = String(args.variantId || "");
  if (productId && !allowed.productIds.has(productId)) return null;
  if (variantId && !allowed.variantIds.has(variantId)) return null;
  if (
    ["get_product", "get_variants", "get_related_products"].includes(
      call.name,
    ) &&
    !productId
  )
    return null;
  if (call.name === "check_inventory" && !variantId) return null;
  if (
    ["compare_products", "create_bundle_suggestion"].includes(call.name) &&
    (!Array.isArray(args.productIds) ||
      args.productIds.length < 2 ||
      args.productIds.length > 4 ||
      args.productIds.some(
        (id) => typeof id !== "string" || !allowed.productIds.has(id),
      ))
  )
    return null;
  if (
    args.quantity !== undefined &&
    (!Number.isInteger(args.quantity) ||
      Number(args.quantity) < 1 ||
      Number(args.quantity) > 10)
  )
    return null;
  if (call.name === "apply_discount") {
    const code = String(args.code || "")
      .trim()
      .toLowerCase();
    if (!allowed.discountsAllowed || !allowed.discountCodes.has(code)) {
      return null;
    }
  }
  return {
    name: call.name,
    arguments: sanitizeToolArguments(args),
  } as AgentToolCall;
}

function toComparableProduct(product: CatalogCacheProduct) {
  return {
    id: product.id,
    title: product.title,
    description: product.description,
    productType: product.productType,
    vendor: product.vendor,
    price: product.price,
    compareAtPrice: product.compareAtPrice,
    tags: product.tags,
    availableVariants: product.variants
      .filter((variant) => variant.availableForSale)
      .map((variant) => ({
        id: variant.id,
        title: variant.title,
        price: variant.price,
        quantityAvailable: variant.quantityAvailable,
        selectedOptions: variant.selectedOptions,
      })),
  };
}

function matchesSearchFilters(
  product: CatalogCacheProduct,
  filters: CommerceSearchFilters,
) {
  const price = Number(product.price || 0);
  if (Number.isFinite(filters.budgetMin) && price < Number(filters.budgetMin)) {
    return false;
  }
  if (Number.isFinite(filters.budgetMax) && price > Number(filters.budgetMax)) {
    return false;
  }
  if (
    filters.productType &&
    product.productType.toLowerCase() !== filters.productType.toLowerCase()
  ) {
    return false;
  }
  const optionValues = product.variants
    .filter((variant) => variant.availableForSale)
    .flatMap((variant) =>
      variant.selectedOptions.map((option) => ({
        name: option.name.toLowerCase(),
        value: option.value.toLowerCase(),
      })),
    );
  if (
    filters.colors?.length &&
    !filters.colors.some((color) =>
      optionValues.some(
        (option) =>
          option.name.includes("color") && option.value === color.toLowerCase(),
      ),
    )
  ) {
    return false;
  }
  if (
    filters.sizes?.length &&
    !filters.sizes.some((size) =>
      optionValues.some(
        (option) =>
          option.name.includes("size") && option.value === size.toLowerCase(),
      ),
    )
  ) {
    return false;
  }
  return true;
}

function sanitizeToolArguments(value: Record<string, unknown>) {
  const quantity = Math.floor(Number(value.quantity || 1));
  return {
    ...(value.query ? { query: String(value.query).slice(0, 240) } : {}),
    ...(value.productId ? { productId: String(value.productId) } : {}),
    ...(Array.isArray(value.productIds)
      ? { productIds: value.productIds.map(String).slice(0, 4) }
      : {}),
    ...(value.variantId ? { variantId: String(value.variantId) } : {}),
    ...(value.lineId ? { lineId: String(value.lineId).slice(0, 160) } : {}),
    ...(Number.isFinite(quantity) ? { quantity: clamp(quantity, 1, 10) } : {}),
    ...(value.code ? { code: String(value.code).slice(0, 100) } : {}),
  };
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2)
    .slice(0, 20);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}
