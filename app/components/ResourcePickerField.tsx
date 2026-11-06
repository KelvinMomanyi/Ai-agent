import { useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { BlockStack, Button, InlineStack, Text } from "@shopify/polaris";
import {
  parseResourceIds,
  pickerSelectionValue,
  type ResourceKind,
} from "../models/resourcePicker";

export function ResourcePickerField({
  label,
  type,
  value,
  onChange,
  helpText,
}: {
  label: string;
  type: ResourceKind;
  value: string;
  onChange: (value: string) => void;
  helpText?: string;
}) {
  const shopify = useAppBridge();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [titles, setTitles] = useState<string[]>([]);
  const selectedIds = parseResourceIds(value);
  const openPicker = async () => {
    setOpening(true);
    setError("");
    try {
      const selection = await shopify.resourcePicker({
        type,
        action: "select",
        multiple: 500,
        selectionIds: selectedIds.map((id) => ({ id })),
        ...(type === "product" ? { filter: { variants: false } } : {}),
      });
      const next = pickerSelectionValue(selection, type);
      if (next !== undefined) {
        onChange(next);
        const ids = new Set(parseResourceIds(next));
        setTitles(
          selection
            ?.filter((item) => ids.has(item.id))
            .map((item) => item.title)
            .slice(0, 10) || [],
        );
      }
    } catch {
      setError(
        "The picker could not open. Open this app inside Shopify admin and try again.",
      );
    } finally {
      setOpening(false);
    }
  };
  return (
    <BlockStack gap="200">
      <Text as="h3" variant="headingSm">
        {label}
      </Text>
      <InlineStack gap="200">
        <Button
          onClick={openPicker}
          loading={opening}
          accessibilityLabel={`Choose ${label.toLowerCase()}`}
        >
          {type === "product" ? "Select products" : "Select collections"}
        </Button>
        <Button
          disabled={!selectedIds.length || opening}
          onClick={() => {
            onChange("");
            setTitles([]);
          }}
          accessibilityLabel={`Clear ${label.toLowerCase()}`}
        >
          Clear selection
        </Button>
      </InlineStack>
      <Text as="p" tone="subdued">
        {`${selectedIds.length} ${type}${selectedIds.length === 1 ? "" : "s"} selected`}
        {titles.length
          ? `: ${titles.join(", ")}${selectedIds.length > titles.length ? "…" : ""}`
          : ". Open the picker to review your selections."}
      </Text>
      {helpText ? (
        <Text as="p" tone="subdued">
          {helpText}
        </Text>
      ) : null}
      {error ? (
        <div role="alert">
          <Text as="p" tone="critical">
            {error}
          </Text>
        </div>
      ) : null}
    </BlockStack>
  );
}
