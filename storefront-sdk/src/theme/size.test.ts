import { describe, it, expect } from "vitest";
import {
  checkSdkSize,
  SDK_SIZE_BUDGET,
  SDK_STAGE_BUDGET,
} from "../../../scripts/check-sdk-size.mjs";
describe("SDK bundle budget", () => {
  it("counts shared and lazy chunks and gates the actual boot/conversation stages", () => {
    expect(() =>
      checkSdkSize([
        { name: "aovboost-sdk.js", bytes: Buffer.alloc(150000) },
        {
          name: "aovboost-agent-shared.js",
          bytes: Buffer.alloc(SDK_STAGE_BUDGET.boot.raw - 150000 + 1),
        },
      ]),
    ).toThrow(/boot.*budget/);
    expect(() =>
      checkSdkSize([
        { name: "aovboost-sdk.js", bytes: Buffer.alloc(150000) },
        {
          name: "aovboost-agent-ChatConversation-hash.js",
          bytes: Buffer.alloc(SDK_STAGE_BUDGET.lazyChat.raw + 1),
        },
      ]),
    ).toThrow(/lazyChat.*budget/);
    const sizes = checkSdkSize([
      { name: "aovboost-sdk.js", bytes: Buffer.alloc(150000) },
      { name: "aovboost-agent-shared.js", bytes: Buffer.alloc(50000) },
      {
        name: "aovboost-agent-ChatConversation-hash.js",
        bytes: Buffer.alloc(8000),
      },
    ]);
    expect(sizes.stages.boot.raw).toBe(200000);
    expect(sizes.stages.conversation.raw).toBe(208000);
  });
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
        {
          name: "theme.js",
          bytes: Buffer.alloc(SDK_SIZE_BUDGET.total - 150000 + 1),
        },
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
