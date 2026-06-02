import { useMemo, useState } from "react";
import { Form } from "@remix-run/react";
import {
  BlockStack,
  Button,
  Card,
  Checkbox,
  FormLayout,
  InlineStack,
  RangeSlider,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { ProductPicker } from "./ProductPicker";

type ProductSummary = {
  id: string;
  title: string;
};

type BundleItemState = {
  productId: string;
  quantity: number;
};

type BundleFormValue = {
  id?: string;
  name: string;
  description: string;
  discountType: "none" | "percentage" | "fixed";
  discountValue: string;
  triggerProductIds: string[];
  isActive: boolean;
  priority: number;
  items: BundleItemState[];
};

type BundleFormProps = {
  bundle: BundleFormValue;
  products: ProductSummary[];
  errors?: Record<string, string>;
};

export function BundleForm({ bundle, products, errors = {} }: BundleFormProps) {
  const [formState, setFormState] = useState<BundleFormValue>(bundle);
  const selectedItemIds = useMemo(
    () => formState.items.map((item) => item.productId),
    [formState.items],
  );

  const setBundleItemIds = (productIds: string[]) => {
    setFormState((current) => ({
      ...current,
      items: productIds.map((productId) => ({
        productId,
        quantity:
          current.items.find((item) => item.productId === productId)?.quantity || 1,
      })),
    }));
  };

  return (
    <Form method="post">
      <input
        type="hidden"
        name="triggerProductIds"
        value={JSON.stringify(formState.triggerProductIds)}
      />
      <input type="hidden" name="items" value={JSON.stringify(formState.items)} />
      <input type="hidden" name="isActive" value={String(formState.isActive)} />
      <input type="hidden" name="priority" value={String(formState.priority)} />

      <Card>
        <BlockStack gap="500">
          <FormLayout>
            <TextField
              label="Bundle name"
              name="name"
              value={formState.name}
              error={errors.name}
              onChange={(name) => setFormState({ ...formState, name })}
              autoComplete="off"
            />
            <TextField
              label="Description"
              name="description"
              value={formState.description}
              onChange={(description) =>
                setFormState({ ...formState, description })
              }
              multiline={3}
              autoComplete="off"
            />
          </FormLayout>

          <ProductPicker
            label="Trigger products"
            products={products}
            selectedIds={formState.triggerProductIds}
            onChange={(triggerProductIds) =>
              setFormState({ ...formState, triggerProductIds })
            }
          />

          <ProductPicker
            label="Bundle items"
            products={products}
            selectedIds={selectedItemIds}
            onChange={setBundleItemIds}
          />

          {formState.items.length > 0 ? (
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Quantities
              </Text>
              {formState.items.map((item) => (
                <TextField
                  key={item.productId}
                  label={getProductTitle(products, item.productId)}
                  type="number"
                  min={1}
                  value={String(item.quantity)}
                  onChange={(value) =>
                    setFormState({
                      ...formState,
                      items: formState.items.map((existing) =>
                        existing.productId === item.productId
                          ? {
                              ...existing,
                              quantity: Math.max(parseInt(value || "1", 10), 1),
                            }
                          : existing,
                      ),
                    })
                  }
                  autoComplete="off"
                />
              ))}
            </BlockStack>
          ) : null}

          <FormLayout>
            <Select
              label="Discount type"
              name="discountType"
              options={[
                { label: "None", value: "none" },
                { label: "Percentage", value: "percentage" },
                { label: "Fixed", value: "fixed" },
              ]}
              value={formState.discountType}
              onChange={(discountType) =>
                setFormState({
                  ...formState,
                  discountType: discountType as BundleFormValue["discountType"],
                })
              }
            />
            <TextField
              label="Discount value"
              name="discountValue"
              type="number"
              value={formState.discountValue}
              onChange={(discountValue) =>
                setFormState({ ...formState, discountValue })
              }
              autoComplete="off"
            />
            <RangeSlider
              label="Priority"
              min={0}
              max={100}
              value={formState.priority}
              onChange={(priority) =>
                setFormState({ ...formState, priority: Number(priority) })
              }
            />
            <Checkbox
              label="Active"
              checked={formState.isActive}
              onChange={(isActive) => setFormState({ ...formState, isActive })}
            />
          </FormLayout>

          <InlineStack gap="300">
            <Button submit variant="primary">
              Save
            </Button>
            <Button url="/app/bundles">Cancel</Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </Form>
  );
}

function getProductTitle(products: ProductSummary[], productId: string) {
  return products.find((product) => product.id === productId)?.title || productId;
}
