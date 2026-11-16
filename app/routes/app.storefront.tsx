import { useState } from "react";
import {
  Form,
  data as json,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  TextField,
  Checkbox,
  Button,
  Banner,
  Select,
  InlineStack,
} from "@shopify/polaris";
import type { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAppSettings } from "../models/settings.server";
import {
  readStorefrontConfig,
  validateStorefrontConfig,
} from "../models/storefrontConfig";
import { verifyReward } from "../models/storefrontData.server";
import { redis } from "../redis.server";
import { ResourcePickerField } from "../components/ResourcePickerField";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request),
    settings = await getAppSettings(session.shop);
  return json({
    config: readStorefrontConfig(settings.storefrontConfig),
    focusedMode: settings.focusedMode,
    shop: session.shop,
  });
};
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  try {
    const form = await request.formData(),
      raw = String(form.get("config") || "");
    if (raw.length > 16000) throw new Error("This configuration is too large.");
    const config = validateStorefrontConfig(JSON.parse(raw));
    if (config.rewardCode) await verifyReward(admin, config.rewardCode);
    if (config.notice.productIds.length) {
      const count = await prisma.product.count({
        where: { shop: session.shop, id: { in: config.notice.productIds } },
      });
      if (count !== config.notice.productIds.length)
        throw new Error(
          "Choose notice products from this store's synced catalog.",
        );
    }
    await prisma.appSettings.update({
      where: { shop: session.shop },
      data: { storefrontConfig: config as Prisma.InputJsonValue },
    });
    try {
      await Promise.all([
        redis.del(`public-settings:${session.shop}`),
        redis.del(`settings:${session.shop}`),
      ]);
    } catch {
      /* Durable configuration is authoritative. */
    }
    return json({ success: true, error: null });
  } catch (error) {
    return json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Configuration could not be saved.",
      },
      { status: 400 },
    );
  }
};

export default function Storefront() {
  const { config: initial, focusedMode, shop } = useLoaderData<typeof loader>(),
    result = useActionData<typeof action>(),
    navigation = useNavigation();
  const [config, setConfig] = useState(initial);
  return (
    <Page
      title="Storefront offers"
      backAction={{ content: "Recommendations", url: "/app/settings" }}
    >
      <Layout>
        <Layout.Section>
          <Form method="post">
            <input type="hidden" name="config" value={JSON.stringify(config)} />
            <BlockStack gap="400">
              {result?.success && (
                <Banner tone="success">Storefront configuration saved.</Banner>
              )}
              {result?.error && <Banner tone="critical">{result.error}</Banner>}
              {focusedMode && (
                <Banner>
                  Focused cart recommendations is on. Turn it off in
                  Recommendations to show browsing widgets, campaigns and
                  notices.
                </Banner>
              )}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Coordinated assistant
                  </Text>
                  <Checkbox
                    label="Enable Agent Core"
                    checked={config.agentCoreEnabled}
                    onChange={(agentCoreEnabled) =>
                      setConfig({ ...config, agentCoreEnabled })
                    }
                  />
                  <Checkbox
                    label="Use compact automatic placements"
                    helpText="Campaigns appear at the top and product notices or cart progress above the assistant. Add an AOVBoost offer placement block in the theme editor to choose an inline position."
                    checked={config.automaticPlacements}
                    onChange={(automaticPlacements) =>
                      setConfig({ ...config, automaticPlacements })
                    }
                  />
                  <Text as="p">
                    Feature switches remain on the Recommendations page. Each
                    offer also needs the real configuration below.
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Campaign countdown
                  </Text>
                  <Checkbox
                    label="Enable campaign"
                    checked={config.campaign.enabled}
                    onChange={(enabled) =>
                      setConfig({
                        ...config,
                        campaign: { ...config.campaign, enabled },
                      })
                    }
                  />
                  <TextField
                    label="Campaign title"
                    value={config.campaign.headline}
                    onChange={(headline) =>
                      setConfig({
                        ...config,
                        campaign: { ...config.campaign, headline },
                      })
                    }
                    autoComplete="off"
                    maxLength={100}
                  />
                  <TextField
                    label="Campaign message"
                    value={config.campaign.body}
                    onChange={(body) =>
                      setConfig({
                        ...config,
                        campaign: { ...config.campaign, body },
                      })
                    }
                    autoComplete="off"
                    maxLength={240}
                  />
                  <TextField
                    label="Campaign starts (UTC, optional)"
                    placeholder="2026-11-20T09:00:00Z"
                    value={config.campaign.startsAt || ""}
                    onChange={(startsAt) =>
                      setConfig({
                        ...config,
                        campaign: {
                          ...config.campaign,
                          startsAt: startsAt || undefined,
                        },
                      })
                    }
                    autoComplete="off"
                  />
                  <TextField
                    label="Campaign ends (UTC)"
                    placeholder="2026-11-27T23:59:59Z"
                    value={config.campaign.endsAt || ""}
                    onChange={(endsAt) =>
                      setConfig({
                        ...config,
                        campaign: {
                          ...config.campaign,
                          endsAt: endsAt || undefined,
                        },
                      })
                    }
                    helpText="A real future deadline is required. The banner disappears at that deadline."
                    autoComplete="off"
                  />
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Product notice
                  </Text>
                  <Checkbox
                    label="Enable product notice"
                    checked={config.notice.enabled}
                    onChange={(enabled) =>
                      setConfig({
                        ...config,
                        notice: { ...config.notice, enabled },
                      })
                    }
                  />
                  <ResourcePickerField
                    label="Notice products"
                    type="product"
                    value={config.notice.productIds.join(",")}
                    onChange={(value) =>
                      setConfig({
                        ...config,
                        notice: {
                          ...config.notice,
                          productIds: value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        },
                      })
                    }
                  />
                  <TextField
                    label="Product notice text"
                    value={config.notice.body}
                    onChange={(body) =>
                      setConfig({
                        ...config,
                        notice: { ...config.notice, body },
                      })
                    }
                    autoComplete="off"
                    maxLength={240}
                    helpText="Supply a factual product update. Dismissals persist for this notice; changing the text creates a new notice."
                  />
                  <TextField
                    label="Notice ends (UTC, optional)"
                    value={config.notice.endsAt || ""}
                    onChange={(endsAt) =>
                      setConfig({
                        ...config,
                        notice: {
                          ...config.notice,
                          endsAt: endsAt || undefined,
                        },
                      })
                    }
                    autoComplete="off"
                  />
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Cart reward
                  </Text>
                  <TextField
                    label="Shopify discount code"
                    value={config.rewardCode}
                    onChange={(rewardCode) =>
                      setConfig({ ...config, rewardCode })
                    }
                    autoComplete="off"
                    maxLength={64}
                    helpText="Use an existing storewide percentage or fixed-amount code for all customers, with a minimum spend and no usage limit. Shopify verifies the reward and spend target; the progress bar does not invent or create discounts."
                  />
                  <Button
                    url={`https://${shop}/admin/discounts`}
                    target="_blank"
                  >
                    Manage Shopify discounts
                  </Button>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Verified social proof
                  </Text>
                  <Checkbox
                    label="Show verified order counts"
                    checked={config.proof.enabled}
                    onChange={(enabled) =>
                      setConfig({
                        ...config,
                        proof: { ...config.proof, enabled },
                      })
                    }
                  />
                  <Select
                    label="Completed order window"
                    options={[
                      { label: "Last 7 complete UTC days", value: "7" },
                      { label: "Last 30 complete UTC days", value: "30" },
                    ]}
                    value={String(config.proof.windowDays)}
                    onChange={(value) =>
                      setConfig({
                        ...config,
                        proof: {
                          ...config.proof,
                          windowDays: Number(value) as 7 | 30,
                        },
                      })
                    }
                  />
                  <Text as="p">
                    Counts come from paid, uncancelled, non-test Shopify orders.
                    Fewer than five orders, incomplete history or an unavailable
                    data source keeps the widget hidden.
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    After checkout
                  </Text>
                  <Text as="p">
                    Add the AOVBoost next-cart picks block in Shopify&apos;s
                    checkout and accounts editor on the order-status page. It
                    recommends a product for a new cart. The separate checkout
                    post-purchase extension retains its existing behavior.
                  </Text>
                  <Button
                    url={`https://${shop}/admin/settings/checkout`}
                    target="_blank"
                  >
                    Open checkout and accounts settings
                  </Button>
                </BlockStack>
              </Card>
              <InlineStack gap="300">
                <Button
                  submit
                  variant="primary"
                  loading={navigation.state === "submitting"}
                >
                  Save storefront offers
                </Button>
                <Button url="/app/bundles">Manage bundles</Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
