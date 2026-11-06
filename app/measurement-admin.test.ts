import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
}));
vi.mock("./shopify.server", () => ({ authenticate: { admin: mocks.auth } }));
vi.mock("./db.server", () => ({
  default: { appSettings: { updateMany: mocks.update } },
}));
vi.mock("./redis.server", () => ({ redis: { del: mocks.del } }));
import { pauseCartRecommendationsAction } from "./models/measurementAdmin.server";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ session: { shop: "one.myshopify.com" } });
});
const request = (intent = "pause_recommendations") =>
  ({
    request: new Request("https://app.test/app", {
      method: "POST",
      body: new URLSearchParams({ intent, shop: "other.myshopify.com" }),
    }),
  }) as any;
describe("one-click conversion guardrail pause", () => {
  it("pauses only the authenticated shop and closes its cohort before invalidating settings", async () => {
    const result = await pauseCartRecommendationsAction(request());
    if (result instanceof Response)
      throw new Error("Expected pause acknowledgement");
    expect(result.data).toEqual({ ok: true });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { shop: "one.myshopify.com" },
      data: {
        upsellEnabled: false,
        holdoutEnabled: false,
        holdoutVersion: { increment: 1 },
      },
    });
    expect(mocks.del.mock.calls.map(([key]) => key).sort()).toEqual([
      "public-settings:one.myshopify.com",
      "settings:one.myshopify.com",
    ]);
  });
  it("requires admin authentication before any writes", async () => {
    const redirect = new Response(null, { status: 302 });
    mocks.auth.mockRejectedValueOnce(redirect);
    await expect(pauseCartRecommendationsAction(request())).rejects.toBe(
      redirect,
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects an unknown intent", async () => {
    const result = await pauseCartRecommendationsAction(request("invalid"));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
