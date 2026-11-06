export const FOCUSED_CART_MIGRATION = "20261105140000_focused_cart_defaults";
export const SESSION_COMPATIBILITY_MIGRATION =
  "20261105135000_session_migration_compatibility";
export const SESSION_VIEW_COMMENT =
  "AOVBoost shop-only compatibility for 20261105140000_focused_cart_defaults";

/** Read-only inspection. Never return raw logs, row data or connection details. */
export async function inspectFocusedCartMigration(prisma) {
  const [context] = await prisma.$queryRaw`
    SELECT current_schema() schema, to_regclass('public._prisma_migrations') IS NOT NULL "hasHistory"`;
  if (context.schema !== "public")
    return {
      status: "needs_review",
      reason: "This recovery supports only the public schema.",
    };
  if (!context.hasHistory)
    return { status: "not_failed", reason: "No migration history yet." };
  const failures = await prisma.$queryRaw`
    SELECT logs FROM public._prisma_migrations WHERE migration_name=${FOCUSED_CART_MIGRATION}
      AND finished_at IS NULL AND rolled_back_at IS NULL ORDER BY started_at DESC LIMIT 1`;
  if (!failures.length)
    return {
      status: "not_failed",
      reason: "The focused-cart migration has no unresolved failure.",
    };
  if (
    !String(failures[0].logs || "").includes(
      'relation "Session" does not exist',
    )
  )
    return {
      status: "needs_review",
      reason:
        "The original error is not the known missing-uppercase-Session failure. Do not resolve it automatically.",
    };
  const relations = await prisma.$queryRaw`
    SELECT c.relname name,c.relkind::text kind,obj_description(c.oid,'pg_class') comment,
      CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid,true) ELSE NULL END definition
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('session','Session','Shop','AppSettings')`;
  if (
    !["session", "Shop", "AppSettings"].every((name) =>
      relations.some(
        (row) => row.name === name && ["r", "p"].includes(row.kind),
      ),
    )
  )
    return {
      status: "needs_review",
      reason:
        "Expected base tables are missing or have a different relation type.",
    };
  const upper = relations.find((row) => row.name === "Session");
  if (
    upper &&
    (upper.kind !== "v" ||
      upper.comment !== SESSION_VIEW_COMMENT ||
      ![
        "SELECT DISTINCT shop FROM session;",
        "SELECT DISTINCT shop FROM public.session;",
        "SELECT DISTINCT session.shop FROM session;",
        "SELECT DISTINCT session.shop FROM public.session;",
      ].includes(
        String(upper.definition)
          .replace(/\s+/g, " ")
          .trim()
          .replaceAll('"session"', "session")
          .replaceAll('"shop"', "shop")
          .replaceAll('"public"', "public"),
      ))
  )
    return {
      status: "needs_review",
      reason:
        "An unrelated or changed uppercase Session relation exists. It will not be replaced.",
    };
  const columns = await prisma.$queryRaw`
    SELECT table_name "tableName",column_name name,data_type type,is_nullable nullable,column_default "defaultValue"
    FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('session','Shop','AppSettings')`;
  const required = [
    ["session", "shop", "text"],
    ["Shop", "shopDomain", "text"],
    ["AppSettings", "id", "text"],
    ["AppSettings", "shop", "text"],
    ["AppSettings", "updatedAt", "timestamp without time zone"],
    ...[
      "chatEnabled",
      "bundlesEnabled",
      "upsellEnabled",
      "discountNudgeEnabled",
      "exitIntentEnabled",
      "postPurchaseEnabled",
      "proactiveMessagesEnabled",
      "hesitationDetectionEnabled",
      "bundleSupportEnabled",
    ].map((name) => ["AppSettings", name, "boolean"]),
    ["AppSettings", "maxProductRecommendations", "integer"],
  ];
  if (
    !required.every(([table, name, type]) =>
      columns.some(
        (row) =>
          row.tableName === table && row.name === name && row.type === type,
      ),
    )
  )
    return {
      status: "needs_review",
      reason: "Required migration columns have missing or incompatible types.",
    };
  const focused = columns.find(
    (row) => row.tableName === "AppSettings" && row.name === "focusedMode",
  );
  if (
    focused &&
    (focused.type !== "boolean" ||
      focused.nullable !== "NO" ||
      !["true", "false"].includes(focused.defaultValue))
  )
    return {
      status: "needs_review",
      reason:
        "The partial focusedMode column does not match a supported migration state.",
    };
  return {
    status: "retryable",
    reason:
      "Known Session/session casing failure and compatible schema confirmed. No data or migration history was changed.",
  };
}

export function focusedCartRecoveryMessage(result) {
  if (result.status === "not_failed") return result.reason;
  if (result.status !== "retryable")
    return `Focused-cart migration needs review: ${result.reason}`;
  return `${result.reason} Ensure ${SESSION_COMPATIBILITY_MIGRATION} is in the reviewed release, then an operator may run: npx prisma migrate resolve --rolled-back ${FOCUSED_CART_MIGRATION}; followed by npx prisma migrate deploy. Do not mark it applied or reset the database.`;
}
