// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasTrackingConsent, waitForTrackingConsent } from "./consent";

afterEach(() => {
  delete (window as Window & { Shopify?: unknown }).Shopify;
});
describe("tracking consent", () => {
  it("waits for affirmative consent and does not accept a denial event", async () => {
    let allowed = false;
    Object.assign(window, {
      Shopify: {
        customerPrivacy: { analyticsProcessingAllowed: () => allowed },
      },
    });
    const config = { settings: { trackingConsentRequired: true } };
    const resumed = vi.fn();
    const waiting = waitForTrackingConsent(config).then(resumed);
    document.dispatchEvent(new Event("visitorConsentCollected"));
    await Promise.resolve();
    expect(resumed).not.toHaveBeenCalled();
    allowed = true;
    document.dispatchEvent(new Event("visitorConsentCollected"));
    await waiting;
    expect(resumed).toHaveBeenCalledOnce();
    allowed = false;
    expect(hasTrackingConsent(config)).toBe(false);
  });
  it("fails closed while a required privacy API is unavailable", () => {
    expect(
      hasTrackingConsent({ settings: { trackingConsentRequired: true } }),
    ).toBe(false);
    expect(hasTrackingConsent({})).toBe(true);
  });
});
