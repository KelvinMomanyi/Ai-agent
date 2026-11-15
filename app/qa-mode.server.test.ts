import { afterEach, describe, expect, it, vi } from "vitest";
import { billingPaused, qaLocalAiLimitsEnabled } from "./qa-mode.server";

afterEach(() => vi.unstubAllEnvs());

describe("owner-controlled production QA flags", () => {
  it.each([undefined, "", "false", "1", "TRUE", " true "])(
    "does not pause billing for %s or enable local limits on their own",
    (value) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AOVBOOST_BILLING_PAUSED", value);
      vi.stubEnv("AOVBOOST_QA_LOCAL_AI_LIMITS", "true");
      expect(billingPaused()).toBe(false);
      expect(qaLocalAiLimitsEnabled()).toBe(false);
    },
  );
  it("requires two separate explicit opt-ins for local production AI limits", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AOVBOOST_BILLING_PAUSED", "true");
    vi.stubEnv("AOVBOOST_QA_LOCAL_AI_LIMITS", "false");
    expect(billingPaused()).toBe(true);
    expect(qaLocalAiLimitsEnabled()).toBe(false);
    vi.stubEnv("AOVBOOST_QA_LOCAL_AI_LIMITS", "true");
    expect(qaLocalAiLimitsEnabled()).toBe(true);
    vi.stubEnv("AOVBOOST_BILLING_PAUSED", "false");
    expect(qaLocalAiLimitsEnabled()).toBe(false);
  });
});
