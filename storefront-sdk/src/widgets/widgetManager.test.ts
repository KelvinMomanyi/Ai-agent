import { describe, expect, it } from "vitest";
import { isWidgetEnabled } from "./widgetManager";

describe("isWidgetEnabled", () => {
  it("honors merchant settings for every configurable widget family", () => {
    const settings = {
      chatEnabled: false,
      bundlesEnabled: false,
      upsellEnabled: false,
      discountNudgeEnabled: false,
      exitIntentEnabled: false,
      postPurchaseEnabled: false,
    };

    expect(isWidgetEnabled("chat", settings)).toBe(false);
    expect(isWidgetEnabled("bundle", settings)).toBe(false);
    expect(isWidgetEnabled("upsell_drawer", settings)).toBe(false);
    expect(isWidgetEnabled("rec_strip", settings)).toBe(false);
    expect(isWidgetEnabled("discount_nudge", settings)).toBe(false);
    expect(isWidgetEnabled("countdown_banner", settings)).toBe(false);
    expect(isWidgetEnabled("exit_intent", settings)).toBe(false);
    expect(isWidgetEnabled("post_purchase", settings)).toBe(false);
  });

  it("keeps backward-compatible defaults and unrelated system widgets", () => {
    expect(isWidgetEnabled("chat", {})).toBe(true);
    expect(isWidgetEnabled("inline_alert", { chatEnabled: false })).toBe(true);
  });
});
