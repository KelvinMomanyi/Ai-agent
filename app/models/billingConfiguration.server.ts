import config from "../config/plans.json";

export function billingSource() {
  const source = process.env.AOVBOOST_BILLING_SOURCE ?? config.billingSource;
  return ["admin_api", "shopify_app_pricing"].includes(source)
    ? source
    : "unconfirmed";
}

export function billingUpgradeMode() {
  const mode = process.env.AOVBOOST_UPGRADE_MODE ?? config.upgradeMode;
  return ["shopify_hosted", "billing_api"].includes(mode)
    ? mode
    : "unconfigured";
}

export function managedPlanHandles(tier: "free" | "pro") {
  const value =
    process.env[
      tier === "pro"
        ? "AOVBOOST_MANAGED_PRO_HANDLES"
        : "AOVBOOST_MANAGED_FREE_HANDLES"
    ] || "";
  return value
    .split(",")
    .map((handle) => handle.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 50);
}
