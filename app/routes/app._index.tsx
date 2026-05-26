import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  Box,
  List,
  InlineStack,
  Badge,
  Button,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  return (
    <Page
      title="AI Revenue Engine"
      subtitle="Autonomous Shopify revenue optimization for offers, bundles, experiments, and insights."
      primaryAction={{ content: "Configure engine", url: "/app/settings" }}
      secondaryActions={[{ content: "View dashboard", url: "/app/analytics" }]}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="500">
              <Box>
                <Text as="h1" variant="headingXl">
                  Sell revenue outcomes, not recommendations
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  The app now acts like an AI merchandiser: it chooses a revenue
                  goal, builds contextual offers, tests variants, and reports the
                  money left in the funnel.
                </Text>
              </Box>

              <InlineStack gap="200">
                <Badge>AOV Mode</Badge>
                <Badge>Profit Mode</Badge>
                <Badge>Dynamic Bundles</Badge>
                <Badge>AI Experiments</Badge>
                <Badge>Autopilot</Badge>
              </InlineStack>

              <InlineStack gap="300">
                <Button url="/app/settings" variant="primary">
                  Configure strategy
                </Button>
                <Button url="/app/analytics">Open revenue dashboard</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                What Changed
              </Text>
              <List>
                <List.Item>
                  Behavioral context is sent with each offer request, including
                  device, traffic source, page type, cart value, and viewed products.
                </List.Item>
                <List.Item>
                  The engine can optimize for AOV, profit, inventory clearance,
                  subscription adoption, lifetime value, or seasonal strategy.
                </List.Item>
                <List.Item>
                  Offers can become dynamic bundles with generated titles,
                  discounts, native placement metadata, and bundle-aware tracking.
                </List.Item>
                <List.Item>
                  Experiment data is attached to impressions and add-to-cart events
                  so the dashboard can surface winning variants.
                </List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Recommended Rollout
              </Text>
              <List type="number">
                <List.Item>
                  Start with Autopilot placement and AOV Mode to validate lift
                  without heavy merchant setup.
                </List.Item>
                <List.Item>
                  Turn on dynamic bundles once product catalog coverage looks good
                  in the dashboard.
                </List.Item>
                <List.Item>
                  Move high-volume stores into Profit, Inventory Clear, or LTV
                  modes when they have enough event data to compare outcomes.
                </List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
