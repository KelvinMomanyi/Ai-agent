import { describe, it, expect } from "vitest";
import {
  safeThemeIdentity,
  safeThemeSelector,
  themeEvidence,
} from "../../shared/themeCompatibility";
const report = (
  sessionHash: string,
  verified: boolean,
  strategy = "floating_card",
  offerId = `offer-${sessionHash}`,
) => ({ sessionHash, verified, strategy, offerId, selector: "#MiniCart" });
describe("untrusted theme evidence", () => {
  it("normalizes optional identity hints and rejects unsupported selectors", () => {
    expect(
      safeThemeIdentity({
        themeId: "123",
        themeName: "<Store>",
        schemaName: "Dawn",
        role: "main",
        unitCost: 123,
      }),
    ).toEqual({
      themeId: "123",
      themeName: "<Store>",
      schemaName: "Dawn",
      role: "main",
    });
    expect(safeThemeIdentity({ themeId: "<script>" }).themeId).toBe("unknown");
    for (const selector of [
      "#CartDrawer",
      "mini-cart",
      "#MiniCart .cart-items",
    ])
      expect(safeThemeSelector(selector)).toBe(true);
    for (const selector of [
      "body",
      "*",
      "#x,body",
      "#x:has(*)",
      "<img>",
      "[onclick]",
      "#x > script",
      "#" + "a".repeat(200),
    ])
      expect(safeThemeSelector(selector)).toBe(false);
  });
  it("does not promote a selector or degrade a profile from one session, even with many reports", () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      report("attacker", false, "native_drawer", `bad-${i}`),
    );
    expect(themeEvidence(rows)).toMatchObject({
      degrade: false,
      disabled: false,
      verified: false,
    });
    const good = Array.from({ length: 5 }, (_, i) => report(`good-${i}`, true));
    expect(themeEvidence([...good, ...rows])).toMatchObject({
      degrade: false,
      verified: true,
      selector: "#MiniCart",
    });
    expect(
      themeEvidence(
        Array.from({ length: 20 }, (_, i) =>
          report("same", true, "floating_card", `same-${i}`),
        ),
      ).selector,
    ).toBeUndefined();
  });
  it("requires both a minimum sample and distinct failing sessions before disabling all strategies", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      ["native_drawer", "cart_page", "floating_card"].map((strategy) =>
        report(`session-${i % 5}`, false, strategy, `offer-${i}`),
      ),
    ).flat();
    expect(themeEvidence(rows)).toMatchObject({
      rate: 0,
      degrade: true,
      disabled: true,
    });
    expect(themeEvidence(rows.slice(0, 12))).toMatchObject({
      degrade: false,
      disabled: false,
    });
  });
  it("uses offers as the denominator even when earlier adapters failed", () => {
    expect(
      themeEvidence([
        report("one", false, "native_drawer"),
        report("one", false, "cart_page"),
        report("one", true),
      ]),
    ).toMatchObject({ rate: 1, degrade: false });
  });
});
