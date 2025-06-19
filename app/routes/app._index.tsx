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
              </List>
            </Box>

            <Box>
              <Text as="h2" variant="headingMd">
                Quick Setup Guide
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Get AOVBoost running on your store in 3 simple steps:
              </Text>
              <List type="number">
                <List.Item>
                  Go to your Shopify admin → Online Store → Themes
                </List.Item>
                <List.Item>
                  Click "Customize" on your active theme
                </List.Item>
                <List.Item>
                  Add AOVBoost sections to your desired pages:
                  <List>
                    <List.Item>Homepage - for featured product recommendations</List.Item>
                    <List.Item>Product pages - for related product upsells</List.Item>
                    <List.Item>Collection pages - for cross-category suggestions</List.Item>
                    <List.Item>Cart page - for last-minute add-ons</List.Item>
                  </List>
                </List.Item>
              </List>
            </Box>

            <Box>
              <InlineStack gap="300">
                <Button primary>Set Up AOVBoost</Button>
                <Button url="/analytics">View Analytics</Button>
              </InlineStack>
            </Box>
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  </Page>
  );
}
