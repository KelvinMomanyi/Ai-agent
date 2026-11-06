import {
  data,
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  type LoaderFunctionArgs,
} from "react-router";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  DataTable,
  Page,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import {
  getEntitlements,
  limitsFor,
  hostedUpgradeUrl,
  PLAN_CONFIG,
} from "../models/entitlements.server";
import { getUsage, usageMonth } from "../models/usage.server";
import {
  configuredRecurringPrice,
  upgradeAction,
} from "../models/upgrade.server";
export const action = upgradeAction;
export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const previousMonth = usageMonth(new Date(usageMonth().getTime() - 1));
  const [entitlement, usage] = await Promise.all([
    getEntitlements(session.shop, admin),
    getUsage(session.shop),
    // Flush the previous month's final counters during active admin visits.
    getUsage(session.shop, previousMonth),
  ]);
  return data(
    {
      entitlement,
      usage,
      plan: limitsFor(entitlement),
      month: usageMonth().toISOString(),
      canUpgrade: Boolean(
        hostedUpgradeUrl(session.shop) ||
        (PLAN_CONFIG.billingSource === "admin_api" &&
          PLAN_CONFIG.upgradeMode === "billing_api" &&
          configuredRecurringPrice()),
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export default function PlanAndUsage() {
  const { entitlement, usage, plan, month, canUpgrade } =
    useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const error = result && "error" in result ? result.error : null;
  const capped =
    plan.monthlyDisplays !== null &&
    usage.displayed + usage.pending >= plan.monthlyDisplays;
  return (
    <Page title="Plan & usage">
      <BlockStack gap="400">
        {error ? <Banner tone="critical">{error}</Banner> : null}
        {entitlement.state !== "verified" ? (
          <Banner
            tone="warning"
            title={
              entitlement.state === "grace"
                ? "Using your last verified plan"
                : "Plan verification needs attention"
            }
          >
            {entitlement.state === "grace"
              ? "Shopify or shared storage is temporarily unavailable. Your last verified access is preserved for up to 24 hours."
              : "The app owner needs to confirm the billing integration. Deterministic recommendations remain available; paid AI is paused until the plan can be verified."}
          </Banner>
        ) : null}
        {entitlement.unmapped ? (
          <Banner tone="warning">
            Your active subscription name needs an entitlement mapping. Pro
            access is preserved while the app owner reviews it.
          </Banner>
        ) : null}
        {capped ? (
          <Banner
            tone="warning"
            title={
              plan.monthlyDisplays !== null &&
              usage.displayed >= plan.monthlyDisplays
                ? "Monthly recommendation allowance reached"
                : "Recommendation capacity is temporarily reserved"
            }
          >
            Unused reservations expire within ten minutes. A used monthly
            allowance resets next UTC calendar month, or changes when you
            upgrade. Checkout continues normally.
          </Banner>
        ) : null}
        {!usage.available ? (
          <Banner tone="warning">
            Usage storage is temporarily unavailable. These are the last durable
            totals. Free offers and paid AI pause while shared limits cannot be
            verified.
          </Banner>
        ) : null}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              {plan.label}
            </Text>
            {entitlement.subscriptionName ? (
              <Text as="p">
                Shopify subscription: {entitlement.subscriptionName}
              </Text>
            ) : null}
            <Text as="p">
              Calendar month beginning {month.slice(0, 10)} UTC. No overage
              charges are created by these counters.
            </Text>
            <DataTable
              columnContentTypes={["text", "numeric", "text"]}
              headings={["Usage", "Used", "Monthly allowance"]}
              rows={[
                [
                  "Displayed recommendations",
                  usage.displayed,
                  plan.monthlyDisplays === null
                    ? "Unlimited"
                    : plan.monthlyDisplays,
                ],
                ["AI provider attempts", usage.aiCalls, plan.monthlyAiCalls],
              ]}
            />
            <Text as="p" tone="subdued">
              {plan.monthlyDisplays !== null
                ? "Free offers require analytics to count visible impressions. "
                : ""}
              One offer counts once when visibly displayed, even if it contains
              multiple products. {usage.pending} delivery reservations are
              pending for up to ten minutes. AI usage includes ranking, setup
              and chat attempts, including provider fallbacks. Reaching the AI
              allowance uses deterministic recommendations.
            </Text>
            <Form method="post">
              <input type="hidden" name="intent" value="refresh" />
              <Button submit loading={navigation.state !== "idle"}>
                Refresh plan
              </Button>
            </Form>
            {canUpgrade ? (
              <Form method="post">
                <input type="hidden" name="intent" value="upgrade" />
                <Button
                  submit
                  variant="primary"
                  loading={navigation.state !== "idle"}
                >
                  Choose or change plan on Shopify
                </Button>
              </Form>
            ) : (
              <Text as="p">
                Plan upgrades are awaiting billing setup by the app owner.
              </Text>
            )}
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Plan features
            </Text>
            <Text as="p">
              Holdout reporting:{" "}
              {plan.features.holdoutReporting ? "Included" : "Pro"}
            </Text>
            <Text as="p">
              Advanced browsing placements:{" "}
              {plan.features.advancedPlacements ? "Included" : "Pro"}
            </Text>
            <Text as="p" tone="subdued">
              Inventory and reorder features are not available in this release.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
