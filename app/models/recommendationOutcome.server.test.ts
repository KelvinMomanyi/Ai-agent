import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  updateSessions: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("../db.server", () => ({
  default: {
    $transaction: async (operation: (tx: unknown) => unknown) =>
      operation({
        $queryRaw: mocks.lock,
        recommendationOutcome: {
          findFirst: mocks.findFirst,
          findMany: mocks.findMany,
          update: mocks.update,
        },
        shopperSession: { updateMany: mocks.updateSessions },
      }),
  },
}));
import { markPurchasedRecommendationOutcomes } from "./recommendationOutcome.server";

const input = {
  shop: "example.myshopify.com",
  sessionIds: ["session-1"],
  orderId: "order-1",
  orderValue: 100,
  lineItems: [
    {
      productId: "p1",
      variantId: "v1",
      price: 50,
      quantity: 2,
      totalDiscount: 0,
    },
  ],
};
beforeEach(() => vi.resetAllMocks());
describe("order recommendation attribution", () => {
  it("returns the same persisted totals after duplicate delivery", async () => {
    mocks.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "outcome-1" })
      .mockResolvedValueOnce({ id: "outcome-1" });
    mocks.findMany.mockResolvedValue([
      { sessionId: "session-1", revenue: "100" },
    ]);
    const first = await markPurchasedRecommendationOutcomes(input);
    const second = await markPurchasedRecommendationOutcomes(input);
    expect(first).toEqual({ outcomeCount: 1, attributedRevenue: 100 });
    expect(second).toEqual(first);
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.lock).toHaveBeenCalledTimes(4);
    expect(mocks.findFirst.mock.calls[1][0].where).toMatchObject({
      session: { chatEngaged: true },
      rejectedAt: null,
      purchasedAt: null,
    });
  });
  it("marks a linked unassisted purchase without inventing AI revenue", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([]);
    expect(await markPurchasedRecommendationOutcomes(input)).toEqual({
      outcomeCount: 0,
      attributedRevenue: 0,
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateSessions).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          purchaseCompleted: true,
          aiAttributedRevenue: "0",
        }),
      }),
    );
  });
  it("groups repeated lines for the same variant into one credited outcome", async () => {
    mocks.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "outcome-1" });
    mocks.findMany.mockResolvedValue([
      { sessionId: "session-1", revenue: "200" },
    ]);
    await markPurchasedRecommendationOutcomes({
      ...input,
      lineItems: [...input.lineItems, ...input.lineItems],
    });
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.update.mock.calls[0][0].data.revenue).toBe("200");
  });
});
