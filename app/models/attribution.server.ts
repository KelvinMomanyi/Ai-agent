const OFFER_PROPERTY = "_aovboost_offer_id";

export type OrderAttribution = {
  productIds: string[];
  offerIds: string[];
  attributedOffers: Array<{ offerId: string; revenue: number }>;
  lineItems: Array<{
    productId: string;
    variantId: string;
    quantity: number;
    price: number;
    totalDiscount: number;
    offerId?: string;
  }>;
};

export function extractOrderAttribution(payload: unknown): OrderAttribution {
  const order = asRecord(payload);
  const sourceLines = Array.isArray(order.line_items) ? order.line_items : [];
  const revenueByOffer = new Map<string, number>();
  const productIds = new Set<string>();

  const lineItems = sourceLines.map((value) => {
    const line = asRecord(value);
    const productId = toGid("Product", line.product_id || asRecord(line.product).id);
    const variantId = toGid(
      "ProductVariant",
      line.variant_id || line.admin_graphql_api_id || asRecord(line.variant).id,
    );
    const quantity = positiveNumber(line.quantity, 1);
    const price = nonNegativeNumber(line.price);
    const totalDiscount = getLineDiscount(line);
    const lineRevenue = Math.max(price * quantity - totalDiscount, 0);
    const offerId = getOfferId(line.properties);

    if (productId) productIds.add(productId);
    if (offerId) {
      revenueByOffer.set(offerId, (revenueByOffer.get(offerId) || 0) + lineRevenue);
    }

    return {
      productId,
      variantId,
      quantity,
      price,
      totalDiscount,
      ...(offerId ? { offerId } : {}),
    };
  });

  const attributedOffers = Array.from(revenueByOffer, ([offerId, revenue]) => ({
    offerId,
    revenue: roundCurrency(revenue),
  }));

  return {
    productIds: Array.from(productIds),
    offerIds: attributedOffers.map(({ offerId }) => offerId),
    attributedOffers,
    lineItems,
  };
}

function getOfferId(value: unknown) {
  if (Array.isArray(value)) {
    for (const property of value) {
      const record = asRecord(property);
      const key = String(record.name || record.key || "");
      if (key === OFFER_PROPERTY) return cleanOfferId(record.value);
    }
    return "";
  }

  return cleanOfferId(asRecord(value)[OFFER_PROPERTY]);
}

function cleanOfferId(value: unknown) {
  const text = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{1,128}$/.test(text) ? text : "";
}

function getLineDiscount(line: Record<string, unknown>) {
  const explicit = Number(line.total_discount);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;

  const allocations = Array.isArray(line.discount_allocations)
    ? line.discount_allocations
    : [];
  return allocations.reduce(
    (total, allocation) =>
      total + nonNegativeNumber(asRecord(allocation).amount),
    0,
  );
}

function toGid(resource: string, value: unknown) {
  const text = String(value || "");
  if (!text) return "";
  return text.startsWith(`gid://shopify/${resource}/`)
    ? text
    : `gid://shopify/${resource}/${text}`;
}

function positiveNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}
