import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  count: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  find: vi.fn(),
  remove: vi.fn(),
  settings: vi.fn(),
  offer: vi.fn(),
  rate: vi.fn(),
  records: [] as any[],
}));
vi.mock("../db.server", () => ({
  default: {
    themeProfile: {
      findUnique: mocks.profile,
      findUniqueOrThrow: mocks.profile,
      count: mocks.count,
      upsert: mocks.upsert,
      updateMany: mocks.update,
    },
    themeReport: {
      createMany: mocks.create,
      findMany: mocks.find,
      deleteMany: mocks.remove,
    },
    appSettings: { findUnique: mocks.settings },
    offer: { findFirst: mocks.offer },
  },
}));
vi.mock("../redis.server", () => ({ incrementRateLimit: mocks.rate }));
vi.mock("./installedShop.server", () => ({
  isInstalledShop: async () => true,
}));
vi.mock("./commerceTransaction.server", () => ({
  withCommerceTransaction: async (_ns: string, _key: string, run: any) => {
    const { default: db } = await import("../db.server");
    return run(db);
  },
}));
import {
  getThemeConfig,
  noteThemeSession,
  parseThemeReport,
  recordThemeReport,
  themeRateLimit,
} from "./themeCompatibility.server";
const shop = "one.myshopify.com",
  identity = { themeId: "123", themeName: "Dawn", schemaName: "Dawn" };
const report = {
  identity,
  attemptId: "attempt",
  offerId: "offer",
  strategy: "floating_card" as const,
  cartUi: "no_feedback" as const,
  verified: true,
  reason: "display_verified",
  selector: "#MiniCart",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.records = [];
  mocks.profile.mockResolvedValue({
    themeId: "123",
    status: "learning",
    strategy: "native_drawer",
    selectors: null,
  });
  mocks.count.mockResolvedValue(0);
  mocks.rate.mockResolvedValue(1);
  mocks.offer.mockResolvedValue({ id: "offer" });
  mocks.settings.mockResolvedValue({ placementPreference: "auto" });
  mocks.create.mockImplementation(async ({ data }) => {
    mocks.records.push(...data);
    return { count: 1 };
  });
  mocks.find.mockImplementation(async ({ where, skip }) =>
    skip || where.createdAt?.lt ? [] : mocks.records,
  );
});
describe("tenant-scoped advisory theme profiles", () => {
  it("starts an unseen theme in learning and never leaks private settings", async () => {
    mocks.profile.mockResolvedValue(null);
    mocks.settings.mockResolvedValue({
      placementPreference: "auto",
      unitCost: 99,
      inventoryQuantity: 10,
      recommendationAccentColor: "#123456",
      recommendationRadius: 200,
    });
    const config = await getThemeConfig(shop, { ...identity, themeId: "456" });
    expect(config).toMatchObject({
      themeId: "456",
      status: "learning",
      genericDrawer: false,
      appearance: { accentColor: "#123456", radius: 24 },
    });
    expect(JSON.stringify(config)).not.toMatch(/unitCost|inventory|margin/);
  });
  it("records distinct signed-session identity with bounded retention and no recommendation writes", async () => {
    await noteThemeSession(shop, "signed", identity);
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      skipDuplicates: true,
      data: [{ shop, themeId: "123", kind: "identity", attemptId: "session" }],
    });
    expect(mocks.offer).not.toHaveBeenCalled();
    expect(mocks.find.mock.calls[0][0]).toMatchObject({
      where: { shop, themeId: "123" },
      take: 100,
      skip: 1000,
    });
  });
  it("rejects foreign offers, over-limit reports and unsafe selectors before profile writes", async () => {
    mocks.offer.mockResolvedValueOnce(null);
    expect(await recordThemeReport(shop, "signed", report)).toBe(false);
    expect(mocks.upsert).not.toHaveBeenCalled();
    mocks.rate.mockResolvedValue(301);
    expect(await themeRateLimit(shop, "signed")).toBe(false);
    expect(() =>
      parseThemeReport({ ...report, selector: "#a, body" }),
    ).toThrow();
    expect(() => parseThemeReport({ ...report, attemptId: 12 })).toThrow();
  });
  it("promotes a selector only after verified agreement from five distinct signed sessions", async () => {
    for (let i = 0; i < 4; i++)
      await recordThemeReport(shop, `signed-${i}`, {
        ...report,
        attemptId: `attempt-${i}`,
        offerId: `offer-${i}`,
      });
    expect(
      mocks.update.mock.calls.every(
        ([arg]) => !arg.data.selectors && arg.data.status === "learning",
      ),
    ).toBe(true);
    await recordThemeReport(shop, "signed-4", {
      ...report,
      attemptId: "attempt-4",
      offerId: "offer-4",
    });
    expect(mocks.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { shop, themeId: "123" },
        data: expect.objectContaining({
          status: "verified",
          selectors: { drawer: "#MiniCart" },
          lastVerifiedAt: expect.any(Date),
        }),
      }),
    );
    for (const [arg] of mocks.offer.mock.calls)
      expect(arg.where.shop).toBe(shop);
  });
  it("does not count a replayed attempt and limits automatic profile proliferation", async () => {
    mocks.create.mockResolvedValueOnce({ count: 0 });
    await recordThemeReport(shop, "signed", report);
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.profile.mockResolvedValue(null);
    mocks.count.mockResolvedValue(20);
    await noteThemeSession(shop, "signed", { ...identity, themeId: "999" });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });
});
