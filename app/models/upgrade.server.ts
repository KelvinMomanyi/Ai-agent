import { data, type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  billingSource,
  billingUpgradeMode,
} from "./billingConfiguration.server";
import {
  PLAN_CONFIG,
  hostedUpgradeUrl,
  invalidateEntitlements,
  billingTestModeEnabled,
} from "./entitlements.server";

export const CREATE_SUBSCRIPTION = `#graphql
  mutation AOVBoostUpgrade($name: String!, $returnUrl: URL!, $test: Boolean!, $lineItems: [AppSubscriptionLineItemInput!]!) {
    appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems) {
      confirmationUrl userErrors { field message }
    }
  }`;
type RecurringPrice = {
  amount: number;
  currencyCode: string;
  interval: "EVERY_30_DAYS" | "ANNUAL";
  test: boolean;
};
export function configuredRecurringPrice(): RecurringPrice | null {
  const value =
    PLAN_CONFIG.proRecurringPrice as unknown as RecurringPrice | null;
  return value &&
    Number.isFinite(value.amount) &&
    value.amount > 0 &&
    /^[A-Z]{3}$/.test(value.currencyCode) &&
    ["EVERY_30_DAYS", "ANNUAL"].includes(value.interval) &&
    typeof value.test === "boolean"
    ? value
    : null;
}
export async function upgradeAction({ request }: ActionFunctionArgs) {
  const { session, admin, redirect } = await authenticate.admin(request);
  const intent = (await request.formData()).get("intent");
  if (intent === "refresh") {
    if (billingTestModeEnabled()) return data({ ok: true });
    try {
      await invalidateEntitlements(session.shop);
    } catch {
      return data(
        { error: "Plan refresh is temporarily unavailable. Please retry." },
        { status: 503 },
      );
    }
    return data({ ok: true });
  }
  if (intent !== "upgrade")
    return new Response("Unknown action", { status: 400 });
  if (billingTestModeEnabled())
    return data(
      { error: "Billing test mode is active. No subscription is required." },
      { status: 409 },
    );
  const hosted = hostedUpgradeUrl(session.shop);
  if (hosted) return redirect(hosted, { target: "_top" });
  const price = configuredRecurringPrice();
  if (
    billingSource() !== "admin_api" ||
    billingUpgradeMode() !== "billing_api" ||
    !price
  )
    return data(
      { error: "Upgrade billing has not been configured by the app owner." },
      { status: 409 },
    );
  try {
    const returnUrl = new URL("/app/plan", process.env.SHOPIFY_APP_URL);
    if (returnUrl.protocol !== "https:") throw new Error("Invalid return URL");
    const response = await admin.graphql(CREATE_SUBSCRIPTION, {
      variables: {
        name:
          PLAN_CONFIG.tiers.pro.subscriptionNames[0] ||
          PLAN_CONFIG.tiers.pro.label,
        returnUrl: returnUrl.href,
        test: price.test,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: {
                  amount: price.amount,
                  currencyCode: price.currencyCode,
                },
                interval: price.interval,
              },
            },
          },
        ],
      },
    });
    const result: any = await response.json();
    const created = result.data?.appSubscriptionCreate;
    if (
      !response.ok ||
      result.errors?.length ||
      created?.userErrors?.length ||
      !created?.confirmationUrl
    )
      throw new Error("Confirmation unavailable");
    const url = new URL(created.confirmationUrl);
    if (
      url.protocol !== "https:" ||
      !(url.hostname === "admin.shopify.com" || url.hostname === session.shop)
    )
      throw new Error("Invalid confirmation URL");
    return redirect(url.href, { target: "_top" });
  } catch (error) {
    // Shopify redirect helpers throw Responses; preserve those and their auth headers.
    if (error instanceof Response) throw error;
    return data(
      { error: "Shopify could not start the upgrade. Please retry." },
      { status: 503 },
    );
  }
}
