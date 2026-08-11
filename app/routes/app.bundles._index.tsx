import {
  data as json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import {
  Badge,
  Banner,
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
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const id = String(formData.get("id") || "");
  const intent = String(formData.get("intent") || "");

  if (!id) return redirect("/app/bundles");

  try {
    if (intent === "toggle") {
      await toggleBundle(
        session.shop,
        id,
        String(formData.get("isActive")) !== "true",
        admin,
      );
    }

    if (intent === "delete") {
      await deleteBundle(session.shop, id, admin);
    }
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Shopify could not update the bundle discount.",
      },
      { status: 400 },
    );
  }

  return redirect("/app/bundles");
};

export default function BundleIndex() {
  const { bundles } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
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
          <BlockStack gap="400">
            {actionData?.error ? (
              <Banner tone="critical">{actionData.error}</Banner>
            ) : null}
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
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function formatDiscount(discountType: string, discountValue: string) {
  if (discountType === "percentage") return `${discountValue}% off`;
  if (discountType === "fixed_amount") {
    return `${discountValue} fixed amount off`;
  }
  return "No discount";
}
