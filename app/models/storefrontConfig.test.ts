import { describe, expect, it } from "vitest";
import {
  defaultStorefrontConfig,
  readStorefrontConfig,
  validateStorefrontConfig,
} from "./storefrontConfig";

describe("storefront configuration", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  it("defaults off and rejects malformed persisted versions", () => {
    expect(readStorefrontConfig(null)).toEqual(defaultStorefrontConfig());
    expect(
      readStorefrontConfig({ version: 2, agentCoreEnabled: true })
        .agentCoreEnabled,
    ).toBe(false);
  });
  it("requires actual future dates and complete campaign copy", () => {
    const config = defaultStorefrontConfig();
    config.campaign.enabled = true;
    expect(() => validateStorefrontConfig(config, now)).toThrow(
      "future end time",
    );
    config.campaign = {
      enabled: true,
      headline: "Weekend offer",
      body: "",
      endsAt: "2026-11-16T12:00:00Z",
    };
    expect(validateStorefrontConfig(config, now).campaign.headline).toBe(
      "Weekend offer",
    );
    config.campaign.startsAt = "2026-11-17T12:00:00Z";
    expect(() => validateStorefrontConfig(config, now)).toThrow(
      "start must be before",
    );
  });
  it("requires notice products and text and removes duplicate product ids", () => {
    const config = defaultStorefrontConfig();
    config.notice.enabled = true;
    expect(() => validateStorefrontConfig(config, now)).toThrow("notice text");
    config.notice.body = "Delivery information";
    config.notice.productIds = [
      "gid://shopify/Product/1",
      "gid://shopify/Product/1",
    ];
    expect(validateStorefrontConfig(config, now).notice.productIds).toEqual([
      "gid://shopify/Product/1",
    ]);
    config.notice.body = "Hello {productTitle}";
    expect(() => validateStorefrontConfig(config, now)).toThrow("placeholders");
  });
  it("rejects unsafe codes and impossible product ids", () => {
    const config = defaultStorefrontConfig();
    config.rewardCode = "../fake";
    expect(() => validateStorefrontConfig(config, now)).toThrow();
    config.rewardCode = "REAL-10";
    config.notice.productIds = ["unscoped-id"];
    expect(() => validateStorefrontConfig(config, now)).toThrow();
  });
});
