const PRIVATE_SIGNAL_KEY =
  /^(?:metafields|cost|unitCost|costCurrency|costPrice|margin|grossMargin|netMargin|marginAmount|marginBand|marginPercent|marginPercentage|inventory.*|quantityAvailable|sellableOnlineQuantity|availableQuantity|stock|stockQuantity|stockRisk|daysOfCover|pairingProvenance|pairOrigin|pairStatus|pairConfidence|modelVersion|evidence|supportingFields)$/i;

/** Keep cart quantity and public availability; merchant stock/cost signals stay server-side. */
export function stripPrivateSignals<T>(value: T): T {
  let visited = 0;
  const clean = (item: unknown, depth: number): unknown => {
    if (++visited > 20_000 || depth > 20) return null;
    if (!item || typeof item !== "object") return item;
    if (typeof (item as { toJSON?: unknown }).toJSON === "function")
      return clean((item as { toJSON(): unknown }).toJSON(), depth + 1);
    if (Array.isArray(item))
      return item.map((entry) => clean(entry, depth + 1));
    return Object.fromEntries(
      Object.entries(item)
        .filter(([key, entry]) => {
          const normalized = key.replace(/[_-]/g, "").toLowerCase();
          return (
            !PRIVATE_SIGNAL_KEY.test(normalized) &&
            !(normalized === "available" && typeof entry === "number")
          );
        })
        .map(([key, entry]) => [key, clean(entry, depth + 1)]),
    );
  };
  return clean(value, 0) as T;
}
