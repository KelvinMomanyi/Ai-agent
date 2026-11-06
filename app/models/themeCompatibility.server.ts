import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { incrementRateLimit } from "../redis.server";
import { withCommerceTransaction } from "./commerceTransaction.server";
import { isInstalledShop } from "./installedShop.server";
import { waitUntil } from "@vercel/functions";
import {
  CART_UI_TYPES,
  THEME_STRATEGIES,
  THEME_WINDOW,
  THEME_REPORT_DAYS,
  THEME_QUORUM,
  safeThemeIdentity,
  safeThemeSelector,
  themeEvidence,
  type ThemeIdentity,
  type ThemeRuntimeConfig,
  type ThemeDisplayReport,
} from "../../shared/themeCompatibility";
export const THEME_SESSION_REPORT_LIMIT = 30;
export const THEME_SHOP_REPORT_LIMIT = 300;
export const MAX_THEME_PROFILES = 20;
async function canLearnIdentity(shop: string, themeId: string) {
  return (
    Boolean(
      await prisma.themeProfile.findUnique({
        where: { shop_themeId: { shop, themeId } },
        select: { themeId: true },
      }),
    ) ||
    (await prisma.themeProfile.count({ where: { shop } })) < MAX_THEME_PROFILES
  );
}
async function trimThemeReports(
  shop: string,
  themeId: string,
  db: Pick<Prisma.TransactionClient, "themeReport"> = prisma,
) {
  const overflow = await db.themeReport.findMany({
    where: { shop, themeId },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    skip: 1000,
    take: 100,
  });
  if (overflow.length)
    await db.themeReport.deleteMany({
      where: { shop, themeId, id: { in: overflow.map((row) => row.id) } },
    });
}
const sessionHash = (id: string) =>
  createHash("sha256").update(id).digest("hex");
export async function themeRateLimit(shop: string, sessionId: string) {
  const counts = await Promise.all([
    incrementRateLimit(
      `theme-report:session:${shop}:${sessionHash(sessionId)}`,
      3600,
    ),
    incrementRateLimit(`theme-report:shop:${shop}`, 60),
  ]);
  return (
    counts[0] <= THEME_SESSION_REPORT_LIMIT &&
    counts[1] <= THEME_SHOP_REPORT_LIMIT
  );
}
export async function getThemeConfig(
  shop: string,
  rawIdentity: unknown,
): Promise<ThemeRuntimeConfig> {
  const identity = safeThemeIdentity(rawIdentity);
  const [profile, settings] = await Promise.all([
    prisma.themeProfile.findUnique({
      where: { shop_themeId: { shop, themeId: identity.themeId } },
    }),
    prisma.appSettings.findUnique({
      where: { shop },
      select: {
        placementPreference: true,
        recommendationAccentColor: true,
        recommendationRadius: true,
        recommendationFont: true,
      },
    }),
  ]);
  const drawer = (profile?.selectors as Record<string, unknown> | null)?.drawer;
  const preference = [
    "auto",
    "cart_drawer",
    "cart_page",
    "floating_card",
    "off",
  ].includes(settings?.placementPreference || "")
    ? (settings!.placementPreference as ThemeRuntimeConfig["preference"])
    : "auto";
  return {
    themeId: identity.themeId,
    preference,
    status: (profile?.status as ThemeRuntimeConfig["status"]) || "learning",
    strategy:
      preference === "off" || profile?.status === "disabled"
        ? "none"
        : preference === "cart_page"
          ? "cart_page"
          : preference === "floating_card"
            ? "floating_card"
            : preference === "cart_drawer"
              ? "native_drawer"
              : THEME_STRATEGIES.includes(profile?.strategy as any)
                ? (profile!.strategy as any)
                : "native_drawer",
    genericDrawer:
      safeThemeSelector(drawer) &&
      profile?.status !== "learning" &&
      profile?.status !== "disabled",
    ...(safeThemeSelector(drawer) ? { drawerSelector: drawer } : {}),
    appearance: {
      accentColor: /^#[\da-f]{6}$/i.test(
        settings?.recommendationAccentColor || "",
      )
        ? settings!.recommendationAccentColor
        : null,
      radius:
        settings?.recommendationRadius != null
          ? Math.max(0, Math.min(24, settings.recommendationRadius))
          : null,
      font: settings?.recommendationFont === "system" ? "system" : "inherit",
    },
  };
}
export async function noteThemeSession(
  shop: string,
  sessionId: string,
  rawIdentity: unknown,
) {
  if (!(await isInstalledShop(shop))) return;
  if (!(await themeRateLimit(shop, sessionId))) return;
  const identity = safeThemeIdentity(rawIdentity);
  if (!(await canLearnIdentity(shop, identity.themeId))) return;
  await prisma.themeProfile.upsert({
    where: { shop_themeId: { shop, themeId: identity.themeId } },
    create: { shop, ...identityFields(identity) },
    update: {},
  });
  await prisma.themeReport.createMany({
    data: [
      {
        shop,
        themeId: identity.themeId,
        sessionHash: sessionHash(sessionId),
        attemptId: "session",
        kind: "identity",
        strategy: "none",
        cartUi: "unknown",
        verified: false,
        reason: "session_start",
      },
    ],
    skipDuplicates: true,
  });
  await trimThemeReports(shop, identity.themeId);
}
export function scheduleThemeSession(
  shop: string,
  sessionId: string,
  identity: unknown,
) {
  if (process.env.NODE_ENV === "production" && process.env.VERCEL !== "1")
    return;
  const task = Promise.resolve()
    .then(() => noteThemeSession(shop, sessionId, identity))
    .catch(() => {});
  try {
    waitUntil(task);
  } catch {
    /* Advisory evidence can be retried on the next request. */
  }
}
export function identityFields(identity: ThemeIdentity) {
  return {
    themeId: identity.themeId,
    themeName: identity.themeName,
    schemaName: identity.schemaName || null,
  };
}
export function parseThemeReport(value: unknown): ThemeDisplayReport {
  const v = value as ThemeDisplayReport;
  if (
    !v ||
    typeof v !== "object" ||
    typeof v.attemptId !== "string" ||
    !/^[\w-]{1,80}$/.test(v.attemptId) ||
    !THEME_STRATEGIES.includes(v.strategy) ||
    !CART_UI_TYPES.includes(v.cartUi) ||
    typeof v.verified !== "boolean" ||
    typeof v.reason !== "string" ||
    !/^[a-z_]{1,60}$/.test(v.reason) ||
    (v.selector !== undefined && !safeThemeSelector(v.selector)) ||
    (v.verified && v.strategy === "none")
  )
    throw new Error("Invalid theme report");
  return {
    identity: safeThemeIdentity(v.identity),
    attemptId: v.attemptId,
    offerId:
      typeof v.offerId === "string" ? v.offerId.slice(0, 128) : undefined,
    strategy: v.strategy,
    cartUi: v.cartUi,
    verified: v.verified,
    reason: v.reason,
    ...(v.selector ? { selector: v.selector } : {}),
  };
}
export async function recordThemeReport(
  shop: string,
  sessionId: string,
  report: ThemeDisplayReport,
) {
  if (!(await themeRateLimit(shop, sessionId))) return false;
  if (
    !report.offerId ||
    !(await prisma.offer.findFirst({
      where: {
        shop,
        sessionId,
        id: report.offerId,
        widgetType: "upsell_drawer",
      },
      select: { id: true },
    }))
  )
    return false;
  if (!(await canLearnIdentity(shop, report.identity.themeId))) return false;
  await withCommerceTransaction(
    "theme-report",
    `${shop}:${report.identity.themeId}`,
    async (tx) => {
      const key = { shop, themeId: report.identity.themeId };
      await tx.themeProfile.upsert({
        where: { shop_themeId: key },
        create: { shop, ...identityFields(report.identity) },
        update: {},
      });
      const result = await tx.themeReport.createMany({
        data: [
          {
            ...key,
            sessionHash: sessionHash(sessionId),
            attemptId: report.attemptId,
            offerId: report.offerId,
            strategy: report.strategy,
            cartUi: report.cartUi,
            verified: report.verified,
            reason: report.reason,
            selector: report.selector || null,
          },
        ],
        skipDuplicates: true,
      });
      if (!result.count) return;
      const reports = await tx.themeReport.findMany({
        where: {
          ...key,
          kind: "display",
          createdAt: {
            gte: new Date(Date.now() - THEME_REPORT_DAYS * 86400_000),
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: THEME_WINDOW,
      });
      const evidence = themeEvidence(reports);
      const profile = await tx.themeProfile.findUniqueOrThrow({
        where: { shop_themeId: key },
      });
      const status =
        report.identity.themeId === "unknown"
          ? "learning"
          : evidence.disabled
            ? "disabled"
            : evidence.degrade
              ? "degraded"
              : evidence.verified
                ? "verified"
                : profile.status;
      const failed = evidence.failedStrategies;
      const strategy = evidence.disabled
        ? "none"
        : evidence.degrade
          ? THEME_STRATEGIES.find((s) => s !== "none" && !failed.includes(s)) ||
            profile.strategy
          : profile.strategy;
      await tx.themeProfile.updateMany({
        where: key,
        data: {
          attempts: { increment: 1 },
          verifiedDisplays: { increment: report.verified ? 1 : 0 },
          failures: { increment: report.verified ? 0 : 1 },
          status,
          strategy,
          ...(evidence.verified ? { cartUi: report.cartUi } : {}),
          ...(evidence.selector
            ? { selectors: { drawer: evidence.selector } }
            : {}),
          ...(report.verified && evidence.verified
            ? { lastVerifiedAt: new Date() }
            : {}),
        },
      });
      const expired = await tx.themeReport.findMany({
        where: {
          shop,
          createdAt: {
            lt: new Date(Date.now() - THEME_REPORT_DAYS * 86400_000),
          },
        },
        select: { id: true },
        take: 100,
      });
      if (expired.length)
        await tx.themeReport.deleteMany({
          where: { shop, id: { in: expired.map((r) => r.id) } },
        });
      await trimThemeReports(shop, key.themeId, tx);
    },
  );
  return true;
}
export function latestThemePreviewQuery(shop: string) {
  return Prisma.sql`SELECT "themeName","lastPreviewResult" FROM "ThemeProfile" WHERE shop=${shop} AND jsonb_typeof("lastPreviewResult")='object' AND "lastPreviewResult"->>'at' IS NOT NULL ORDER BY "lastPreviewResult"->>'at' DESC LIMIT 1`;
}
export async function getThemeSummary(shop: string) {
  const candidates = await prisma.$queryRaw<
    Array<{ themeId: string; sessions: number }>
  >(
    Prisma.sql`WITH recent AS (SELECT "themeId","sessionHash","createdAt" FROM "ThemeReport" WHERE shop=${shop} AND "createdAt">=${new Date(Date.now() - THEME_REPORT_DAYS * 86400_000)} ORDER BY "createdAt" DESC LIMIT 1000) SELECT "themeId",COUNT(DISTINCT "sessionHash")::int sessions FROM recent GROUP BY "themeId" ORDER BY (COUNT(DISTINCT "sessionHash")>=${THEME_QUORUM}) DESC,MAX("createdAt") DESC LIMIT 1`,
  );
  const [profile, lastPreview, settings] = await Promise.all([
    candidates[0]
      ? prisma.themeProfile.findUnique({
          where: { shop_themeId: { shop, themeId: candidates[0].themeId } },
        })
      : prisma.themeProfile.findFirst({
          where: { shop },
          orderBy: { updatedAt: "desc" },
        }),
    prisma
      .$queryRaw<
        Array<{ themeName: string; lastPreviewResult: Prisma.JsonValue }>
      >(latestThemePreviewQuery(shop))
      .then((rows) => rows[0] || null),
    prisma.appSettings.findUnique({
      where: { shop },
      select: { placementPreference: true },
    }),
  ]);
  const reports = profile
    ? await prisma.themeReport.findMany({
        where: {
          shop,
          themeId: profile.themeId,
          kind: "display",
          createdAt: {
            gte: new Date(Date.now() - THEME_REPORT_DAYS * 86400_000),
          },
        },
        take: 1000,
        orderBy: { createdAt: "desc" },
      })
    : [];
  const offers = new Map<string, boolean>();
  reports.forEach((row) =>
    offers.set(
      row.offerId || row.id,
      row.verified || offers.get(row.offerId || row.id) || false,
    ),
  );
  return {
    profile,
    lastPreview,
    preference: settings?.placementPreference || "auto",
    verifiedRate: offers.size
      ? [...offers.values()].filter(Boolean).length / offers.size
      : null,
    sample: offers.size,
    identitySessions: candidates[0]?.sessions || 0,
  };
}
