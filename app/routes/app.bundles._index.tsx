import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import {
  deleteBundle,
  listBundles,
  toggleBundle,
} from "../models/bundle.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const bundles = await listBundles(session.shop);

  return json({
    bundles: bundles.map((bundle) => ({
      id: bundle.id,
      name: bundle.name,
      description: bundle.description,
      isActive: bundle.isActive,
      triggerProductCount: bundle.triggerProductIds.length,
      discountSummary: formatDiscount(
        bundle.discountType,
        bundle.discountValue.toString(),
      ),
      itemCount: bundle.items.length,
      priority: bundle.priority,
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const id = String(formData.get("id") || "");
  const intent = String(formData.get("intent") || "");

  if (!id) return redirect("/app/bundles");

  if (intent === "toggle") {
    await toggleBundle(
      session.shop,
      id,
      String(formData.get("isActive")) !== "true",
    );
  }

  if (intent === "delete") {
    await deleteBundle(session.shop, id);
  }

  return redirect("/app/bundles");
};

export default function BundleIndex() {
  const { bundles } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <Page
      title="Bundles"
      backAction={{ content: "Dashboard", url: "/app" }}
      primaryAction={{ content: "Create bundle", url: "/app/bundles/new" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              {bundles.length === 0 ? (
                <Text as="p" tone="subdued">
                  Create a bundle to show contextual complete-the-set offers.
                </Text>
              ) : (
                bundles.map((bundle) => (
                  <div
                    key={bundle.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) auto",
                      gap: "16px",
                      padding: "12px 0",
                      borderBottom: "1px solid #ebebeb",
                    }}
                  >
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h3" variant="headingSm">
                          {bundle.name}
                        </Text>
                        <Badge tone={bundle.isActive ? "success" : undefined}>
                          {bundle.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </InlineStack>
                      <Text as="p" tone="subdued">
                        {bundle.triggerProductCount} triggers,{" "}
                        {bundle.itemCount} items, {bundle.discountSummary},
                        priority {bundle.priority}
                      </Text>
                    </BlockStack>

                    <InlineStack gap="200">
                      <Button url={`/app/bundles/${bundle.id}`}>Edit</Button>
                      <Form method="post">
                        <input type="hidden" name="id" value={bundle.id} />
                        <input
                          type="hidden"
                          name="isActive"
                          value={String(bundle.isActive)}
                        />
                        <input type="hidden" name="intent" value="toggle" />
                        <Button submit loading={isSubmitting}>
                          {bundle.isActive ? "Deactivate" : "Activate"}
                        </Button>
                      </Form>
                      <Form method="post">
                        <input type="hidden" name="id" value={bundle.id} />
                        <input type="hidden" name="intent" value="delete" />
                        <Button submit tone="critical" loading={isSubmitting}>
                          Delete
                        </Button>
                      </Form>
                    </InlineStack>
                  </div>
                ))
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function formatDiscount(discountType: string, discountValue: string) {
  if (discountType === "percentage") return `${discountValue}% off`;
  if (discountType === "fixed") return `$${discountValue} off`;
  return "No discount";
}
