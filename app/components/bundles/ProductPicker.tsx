import { useMemo } from "react";
import { BlockStack, Button, InlineStack, Text, TextField } from "@shopify/polaris";

type ProductSummary = {
  id: string;
  title: string;
};

type ProductPickerProps = {
  label: string;
  selectedIds: string[];
  products: ProductSummary[];
  onChange: (ids: string[]) => void;
};

export function ProductPicker({
  label,
  selectedIds,
  products,
  onChange,
}: ProductPickerProps) {
  const selectedProducts = useMemo(
    () => products.filter((product) => selectedIds.includes(product.id)),
    [products, selectedIds],
  );

  const openPicker = async () => {
    const picker = (window as any).shopify?.resourcePicker;
    if (typeof picker !== "function") return;

    const selection = await picker({
      type: "product",
      multiple: true,
      selectionIds: selectedIds.map((id) => ({ id })),
    });

    if (Array.isArray(selection)) {
      onChange(selection.map((item) => String(item.id)).filter(Boolean));
    }
  };

  return (
    <BlockStack gap="200">
      <InlineStack align="space-between" blockAlign="center">
        <Text as="p" variant="bodyMd">
          {label}
        </Text>
        <Button onClick={openPicker}>Select products</Button>
      </InlineStack>

      <TextField
        label={`${label} product IDs`}
        labelHidden
        value={selectedIds.join(",")}
        onChange={(value) =>
          onChange(
            value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
          )
        }
        placeholder="gid://shopify/Product/..."
        autoComplete="off"
      />

      {selectedProducts.length > 0 ? (
        <Text as="p" variant="bodySm" tone="subdued">
          {selectedProducts.map((product) => product.title).join(", ")}
        </Text>
      ) : (
        <Text as="p" variant="bodySm" tone="subdued">
          No synced products selected.
        </Text>
      )}
    </BlockStack>
  );
}
