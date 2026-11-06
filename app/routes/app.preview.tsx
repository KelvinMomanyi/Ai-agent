import {
  data as json,
  Form,
  redirect,
  useLoaderData,
  useNavigation,
  useSubmit,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  Thumbnail,
} from "@shopify/polaris";
import prisma from "../db.server";
import { getAdminOfferPreview } from "../models/offerPreview.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const source =
    new URL(request.url).searchParams.get("sourceProductId") || undefined;
  const [preview, response] = await Promise.all([
    getAdminOfferPreview(session.shop, source),
    admin.graphql(
      `#graphql\nquery AOVBoostPreviewCurrency { shop { currencyCode } }`,
    ),
  ]);
  const result = await response.json();
  const currencyCode = /^[A-Z]{3}$/.test(result.data?.shop?.currencyCode)
    ? result.data.shop.currencyCode
    : "USD";
  return json(
    { preview, currencyCode },
    { headers: { "Cache-Control": "no-store" } },
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "reviewed")
    return new Response("Invalid action", { status: 400 });
  const preview = await getAdminOfferPreview(
    session.shop,
    String(form.get("sourceProductId") || "") || undefined,
  );
  if (!preview.source || !preview.products.length)
    return new Response("No available preview to review", { status: 409 });
  const onboardingPreviewedAt = new Date();
  await prisma.appSettings.upsert({
    where: { shop: session.shop },
    update: { onboardingPreviewedAt },
    create: {
      shop: session.shop,
      onboardingPreviewedAt,
      pairingMode: "autopilot",
    },
  });
  return redirect("/app");
};

export default function OfferPreview() {
  const { preview, currencyCode } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submit = useSubmit();
  return (
    <Page
      title="Preview an offer"
      backAction={{ content: "Home", url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Banner tone="info">
              This read-only preview uses your synced products. It does not add
              items to a cart or count as a shopper offer or impression. Live
              offers depend on your settings and storefront placement.
            </Banner>
            {preview.sources.length ? (
              <Card>
                <Select
                  label="Product in the cart"
                  placeholder="Choose a product"
                  value={preview.source?.id || ""}
                  options={preview.sources.map(({ id, title }) => ({
                    value: id,
                    label: title,
                  }))}
                  disabled={navigation.state !== "idle"}
                  onChange={(sourceProductId) =>
                    submit({ sourceProductId }, { method: "get" })
                  }
                />
              </Card>
            ) : null}
            {preview.source && preview.products.length ? (
              <>
                <Text as="p">
                  When {preview.source.title} is in the cart, a catalog
                  recommendation can look like this:
                </Text>
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      You may also like
                    </Text>
                    {preview.products.map((product) => (
                      <InlineStack
                        key={product.id}
                        gap="300"
                        blockAlign="center"
                      >
                        {product.imageUrl ? (
                          <Thumbnail
                            source={product.imageUrl}
                            alt={product.title}
                          />
                        ) : null}
                        <BlockStack gap="100">
                          <Text as="h3" variant="headingSm">
                            {product.title}
                          </Text>
                          <Text as="p">
                            {new Intl.NumberFormat("en", {
                              style: "currency",
                              currency: currencyCode,
                            }).format(Number(product.price))}
                          </Text>
                          <Text as="p" tone="subdued">
                            {product.reason}
                          </Text>
                        </BlockStack>
                      </InlineStack>
                    ))}
                  </BlockStack>
                </Card>
                <Form method="post">
                  <input type="hidden" name="intent" value="reviewed" />
                  <input
                    type="hidden"
                    name="sourceProductId"
                    value={preview.source.id}
                  />
                  <Button
                    submit
                    variant="primary"
                    loading={navigation.state !== "idle"}
                  >
                    Mark preview reviewed
                  </Button>
                </Form>
              </>
            ) : (
              <Banner tone="warning">
                A preview needs two available products that pass your
                recommendation exclusions. Review and approve pairings, sync
                your catalog or choose another product.
              </Banner>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
