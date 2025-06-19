import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  List,
  Link,
  InlineStack, 
  Badge,

} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";


export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  
  return null;
};



export default function Index() {
  
  return (
    <Page title="Welcome to AOVBoost">
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="500">
            <Box>
              <Text as="h1" variant="headingXl">
                Boost Your Average Order Value with AI
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                AOVBoost uses AI to recommend smart cross-sell and upsell products — no manual setup required.
              </Text>
            </Box>

            <Box>
              <InlineStack gap="400">
                <Badge status="success">Live AI Recommendations</Badge>
                <Badge>Cart Integration</Badge>
                <Badge>Shopify Native</Badge>
              </InlineStack>
            </Box>

            <Box>
              <InlineStack gap="300">
                <Link to="/app/analytics">View Analytics</Link>
              </InlineStack>
            </Box>
          </BlockStack>
        </Card>
      </Layout.Section>

      <Layout.Section>
        <Card>
          <BlockStack gap="400">
            <Box>
              <Text as="h2" variant="headingMd">
                Key Features
              </Text>
            </Box>
            <Box>
              <List>
                <List.Item>
                  Automatically display cross-sell offers based on what customers are shopping.
                </List.Item>
                <List.Item>
                  Works out of the box on product and cart pages — no code needed.
                </List.Item>
                <List.Item>
                  Track added revenue with real-time AOV analytics.
                </List.Item>
                <List.Item>
                  AI-powered product matching for higher conversion rates.
                </List.Item>
                <List.Item>
                  Seamless integration with your existing theme design.
                </List.Item>
              </List>
            </Box>
          </BlockStack>
        </Card>
      </Layout.Section>

      <Layout.Section>
        <Card>
          <BlockStack gap="400">
            <Box>
              <Text as="h2" variant="headingMd">
                Quick Setup Guide
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Get AOVBoost running on your store in 3 simple steps:
              </Text>
            </Box>
            <Box>
              <List type="number">
                <List.Item>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">Access Theme Editor:</Text> Go to your Shopify admin → Online Store → Themes
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">Customize Theme:</Text> Click "Customize" on your active theme
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">Add AOVBoost Sections:</Text> Use the "Add section" option to place AOVBoost on your desired pages
                </List.Item>
              </List>
            </Box>
          </BlockStack>
        </Card>
      </Layout.Section>

      <Layout.Section>
        <Card>
          <BlockStack gap="400">
            <Box>
              <Text as="h2" variant="headingMd">
                Recommended Page Placements
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Choose where to display recommendations for maximum impact:
              </Text>
            </Box>
            <Box>
              <List>
                <List.Item>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">Homepage:</Text> Featured product recommendations to showcase popular items
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">Product Pages:</Text> Related product upsells and complementary items
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">Collection Pages:</Text> Cross-category suggestions to expand browsing
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">Cart Page:</Text> Last-minute add-ons before checkout
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">Checkout:</Text> Final upsell opportunities (premium feature)
                </List.Item>
              </List>
            </Box>
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  </Page>
  );
}
