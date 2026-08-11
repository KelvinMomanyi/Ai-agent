const EMPTY_RESULT = { operations: [] };

/**
 * Applies only server-configured discounts to cart lines carrying the matching
 * private bundle ID/version properties. Product IDs and required quantities
 * are verified from Shopify's cart input; line properties never supply prices
 * or discount values.
 */
export function cartLinesDiscountsGenerateRun(input) {
  if (!input?.discount?.discountClasses?.includes("PRODUCT")) {
    return EMPTY_RESULT;
  }

  const configuredBundles = input.discount.metafield?.jsonValue?.bundles;
  const cartLines = Array.isArray(input?.cart?.lines) ? input.cart.lines : [];
  if (!Array.isArray(configuredBundles) || cartLines.length === 0) {
    return EMPTY_RESULT;
  }

  const candidates = [];
  for (const configuredBundle of configuredBundles) {
    const bundle = normalizeConfiguredBundle(configuredBundle);
    if (!bundle) continue;

    const matchingLines = cartLines.filter(
      (line) =>
        line.bundleId?.value === bundle.id &&
        line.bundleVersion?.value === bundle.version &&
        line.merchandise?.__typename === "ProductVariant",
    );
    const multiplier = getCompleteBundleMultiplier(matchingLines, bundle.items);
    if (multiplier < 1) continue;

    const targets = buildTargets(matchingLines, bundle.items, multiplier);
    if (targets.length === 0) continue;

    candidates.push({
      message: "AOVBoost bundle savings",
      targets,
      value:
        bundle.discountType === "percentage"
          ? { percentage: { value: bundle.discountValue.toFixed(2) } }
          : {
              fixedAmount: {
                amount: (bundle.discountValue * multiplier).toFixed(2),
                appliesToEachItem: false,
              },
            },
    });
  }

  if (candidates.length === 0) return EMPTY_RESULT;

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: "ALL",
        },
      },
    ],
  };
}

function normalizeConfiguredBundle(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id || "");
  const version = String(value.version || "");
  const discountType = value.discountType;
  const discountValue = Number(value.discountValue);
  const items = normalizeItems(value.items);

  if (!id || !version || items.length === 0) return null;
  if (discountType === "percentage") {
    if (discountValue < 1 || discountValue > 50) return null;
  } else if (discountType === "fixed_amount") {
    if (!Number.isFinite(discountValue) || discountValue <= 0) return null;
  } else {
    return null;
  }

  return { id, version, discountType, discountValue, items };
}

function normalizeItems(value) {
  if (!Array.isArray(value)) return [];
  const quantities = new Map();
  for (const item of value) {
    const productId = String(item?.productId || "");
    const quantity = Math.floor(Number(item?.quantity));
    if (!productId || !Number.isFinite(quantity) || quantity < 1) continue;
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
  }
  return Array.from(quantities, ([productId, quantity]) => ({
    productId,
    quantity,
  }));
}

function getCompleteBundleMultiplier(lines, requiredItems) {
  const available = new Map();
  for (const line of lines) {
    const productId = String(line.merchandise?.product?.id || "");
    const quantity = Math.floor(Number(line.quantity));
    if (!productId || !Number.isFinite(quantity) || quantity < 1) continue;
    available.set(productId, (available.get(productId) || 0) + quantity);
  }

  return requiredItems.reduce(
    (multiplier, item) =>
      Math.min(
        multiplier,
        Math.floor((available.get(item.productId) || 0) / item.quantity),
      ),
    Number.MAX_SAFE_INTEGER,
  );
}

function buildTargets(lines, requiredItems, multiplier) {
  const targets = [];
  for (const item of requiredItems) {
    let remaining = item.quantity * multiplier;
    for (const line of lines) {
      if (line.merchandise?.product?.id !== item.productId || remaining < 1) {
        continue;
      }
      const quantity = Math.min(
        Math.max(0, Math.floor(Number(line.quantity) || 0)),
        remaining,
      );
      if (quantity > 0) {
        targets.push({ cartLine: { id: line.id, quantity } });
        remaining -= quantity;
      }
    }
    if (remaining > 0) return [];
  }
  return targets;
}
