import { describe, it, expect } from "vitest";
import {
  checkSdkSize,
  SDK_SIZE_BUDGET,
} from "../../../scripts/check-sdk-size.mjs";
describe("SDK bundle budget", () => {
  it("fails when the main or combined artifact crosses the named limit", () => {
    expect(() =>
      checkSdkSize([
        {
          name: "aovboost-sdk.js",
          bytes: Buffer.alloc(SDK_SIZE_BUDGET.main + 1),
        },
      ]),
    ).toThrow(/budget/);
    expect(() =>
      checkSdkSize([
        { name: "aovboost-sdk.js", bytes: Buffer.alloc(150000) },
        { name: "theme.js", bytes: Buffer.alloc(100000) },
      ]),
    ).toThrow(/budget/);
    expect(
      checkSdkSize([
        { name: "aovboost-sdk.js", bytes: Buffer.alloc(150000) },
        { name: "theme.js", bytes: Buffer.alloc(40000) },
      ]).total,
    ).toBe(190000);
  });
});
