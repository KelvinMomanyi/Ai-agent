import type { BillingAdmin } from "./entitlements.server";
import { managedPlanHandles } from "./billingConfiguration.server";
import config from "../config/plans.json";

export const SHOP_ID_QUERY = `#graphql
  query AOVBoostBillingShop { shop { id myshopifyDomain } }
`;
export const MANAGED_SUBSCRIPTION_QUERY = `#graphql
  query AOVBoostManagedSubscription($appId: ID!, $shopId: ID!) {
    activeSubscription(appId: $appId, shopId: $shopId) {
      shop { id myshopifyDomain }
      items { handle price { active } }
    }
  }
`;

// The Partner API is organization-scoped. Always derive and verify the shop
// identity using the authenticated shop's Admin API before accepting a plan.
export async function getManagedSubscriptions(
  shop: string,
  admin: BillingAdmin,
) {
  const partnerId = process.env.SHOPIFY_PARTNER_ID || "";
  const appId = process.env.SHOPIFY_PARTNER_APP_ID || "";
  const token = process.env.SHOPIFY_PARTNER_API_TOKEN || "";
  if (
    !/^\d+$/.test(partnerId) ||
    !/^gid:\/\/shopify\/App\/\d+$/.test(appId) ||
    !token
  ) {
    throw new Error("Managed billing credentials are not configured");
  }
  const shopResponse = await admin.graphql(SHOP_ID_QUERY, {
    tries: 1,
    signal: AbortSignal.timeout(1500),
  });
  const shopResult = await shopResponse.json();
  const identity = shopResult.data?.shop;
  if (
    !shopResponse.ok ||
    shopResult.errors?.length ||
    identity?.myshopifyDomain !== shop ||
    !/^gid:\/\/shopify\/Shop\/\d+$/.test(identity?.id || "")
  ) {
    throw new Error("Billing shop identity could not be verified");
  }
  const response = await fetch(
    `https://partners.shopify.com/${partnerId}/api/2026-07/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        query: MANAGED_SUBSCRIPTION_QUERY,
        variables: { appId, shopId: identity.id },
      }),
      signal: AbortSignal.timeout(1500),
      redirect: "error",
    },
  );
  const result = await response.json();
  if (
    !response.ok ||
    result.errors?.length ||
    !result.data ||
    !Object.hasOwn(result.data, "activeSubscription")
  ) {
    throw new Error("Managed subscription query unavailable");
  }
  const subscription = result.data.activeSubscription;
  if (subscription === null) return null;
  if (
    subscription.shop?.id !== identity.id ||
    subscription.shop?.myshopifyDomain !== shop ||
    !Array.isArray(subscription.items) ||
    !subscription.items.length ||
    !subscription.items.every(
      (item: any) =>
        typeof item.handle === "string" &&
        typeof item.price?.active === "boolean",
    )
  ) {
    throw new Error("Invalid managed subscription identity or items");
  }
  const active = subscription.items.filter((item: any) => item.price.active);
  if (!active.length)
    throw new Error("No verified active managed subscription items");
  const pro = new Set(managedPlanHandles("pro"));
  const free = new Set(managedPlanHandles("free"));
  return active.map((item: { handle: string }) => ({
    name: pro.has(item.handle.toLowerCase())
      ? config.tiers.pro.subscriptionNames[0]
      : free.has(item.handle.toLowerCase())
        ? config.tiers.free.subscriptionNames[0]
        : `Managed plan: ${item.handle.slice(0, 120)}`,
    status: "ACTIVE",
  }));
}
