import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogReadiness } from "./productCatalogMapping";
const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  event: vi.fn(),
  session: vi.fn(),
  upsert: vi.fn(),
  pairingCount: vi.fn(),
}));
vi.mock("../db.server", () => ({
  default: {
    appSettings: { findUnique: mocks.settings },
    event: { findFirst: mocks.event, upsert: mocks.upsert },
    shopperSession: { findFirst: mocks.session },
    productRelationship: { count: mocks.pairingCount },
  },
}));
import {
  getSetupChecklist,
  recordAuthenticatedStorefrontSession,
} from "./onboarding.server";
const now = new Date("2026-11-05T12:00:00Z");
const readiness = { actionableProductCount: 3 } as CatalogReadiness;
beforeEach(() => vi.resetAllMocks());

describe("tenant-scoped onboarding state", () => {
  it("completes pairing setup only after a tenant has approved a complement", async () => {
    mocks.pairingCount.mockResolvedValue(1);
    const steps = await getSetupChecklist(
      "one.myshopify.com",
      readiness,
      null,
      now,
    );
    expect(steps.find(({ id }) => id === "pairings")?.state).toBe("complete");
    expect(mocks.pairingCount).toHaveBeenCalledWith({
      where: {
        shop: "one.myshopify.com",
        kind: "complement",
        status: { in: ["approved", "auto_approved"] },
      },
    });
  });
  it("uses indexed recent connection and shopper queries with the authenticated shop", async () => {
    mocks.event.mockResolvedValue({ timestamp: now });
    const steps = await getSetupChecklist(
      "one.myshopify.com",
      readiness,
      null,
      now,
    );
    expect(steps.find(({ id }) => id === "verify")?.state).toBe("complete");
    expect(mocks.event).toHaveBeenCalledWith({
      where: {
        storeId: "one.myshopify.com",
        event: "storefront_session_authenticated",
        timestamp: { gte: new Date("2026-10-22T12:00:00Z"), lte: now },
      },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true },
    });
    expect(mocks.session.mock.calls[0][0].where).toEqual({
      shop: "one.myshopify.com",
      lastActivityAt: { gte: new Date("2026-10-22T12:00:00Z"), lte: now },
    });
    expect(mocks.settings).toHaveBeenCalledWith({
      where: { shop: "one.myshopify.com" },
      select: { onboardingPreviewedAt: true },
    });
  });
  it("also verifies an existing authenticated shopper session", async () => {
    mocks.session.mockResolvedValue({ lastActivityAt: now });
    expect(
      (await getSetupChecklist("one.myshopify.com", readiness, null, now)).find(
        ({ id }) => id === "verify",
      )?.state,
    ).toBe("complete");
  });
  it("stores a bounded anonymous receipt covered by the existing Event tenant purge", async () => {
    await recordAuthenticatedStorefrontSession("one.myshopify.com", now);
    await recordAuthenticatedStorefrontSession("one.myshopify.com", now);
    await recordAuthenticatedStorefrontSession("two.myshopify.com", now);
    const first = mocks.upsert.mock.calls[0][0];
    expect(first.where).toEqual({
      id: "onboarding:storefront:one.myshopify.com",
      storeId: "one.myshopify.com",
    });
    expect(mocks.upsert.mock.calls[1][0].where).toEqual(first.where);
    expect(mocks.upsert.mock.calls[2][0].where.id).not.toBe(first.where.id);
    expect(first.create).toEqual({
      id: first.where.id,
      storeId: "one.myshopify.com",
      event: "storefront_session_authenticated",
      timestamp: now,
      data: {},
    });
    expect(first.update).toEqual({ timestamp: now });
  });
});
