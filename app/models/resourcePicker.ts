export type ResourceKind = "product" | "collection";

export function parseResourceIds(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ).slice(0, 500);
}

export function pickerSelectionValue(
  selection: readonly { id: unknown }[] | undefined,
  type: ResourceKind,
) {
  if (!selection) return undefined;
  const prefix = type === "product" ? "Product" : "Collection";
  const pattern = new RegExp(`^gid://shopify/${prefix}/[0-9]+$`);
  return Array.from(
    new Set(
      selection.map(({ id }) => String(id)).filter((id) => pattern.test(id)),
    ),
  )
    .slice(0, 500)
    .join(", ");
}
