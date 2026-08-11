import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfferDecision } from "../ai/types";
import {
  applyExperimentConfig,
  parseExperimentConfigText,
  validateExperimentConfig,
} from "./experimentConfig";

const baselineDecision: OfferDecision = {
  widgetType: "upsell_drawer",
  payload: {
    products: [
      {
        id: "catalog-product",
        variantId: "catalog-variant",
        price: "19.00",
      },
    ],
    copy: {
      headline: "Baseline headline",
      ctaText: "Baseline CTA",
      dismissText: "No thanks",
    },
  },
  reasoning: "Catalog-backed decision.",
  confidence: 0.8,
  aiProvider: "heuristic",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("experiment config validation", () => {
  it("accepts documented copy overrides", () => {
    expect(
      validateExperimentConfig({
        copy: {
          headline: "Treatment headline",
          ctaText: "Add this",
          offerLine: "Available while this session is active",
        },
      }).success,
    ).toBe(true);
  });

  it("rejects product and commerce fields at every schema level", () => {
    expect(validateExperimentConfig({ productId: "injected" }).success).toBe(
      false,
    );
    expect(validateExperimentConfig({ copy: { price: "0.01" } }).success).toBe(
      false,
    );
    expect(parseExperimentConfigText('{"discountValue": 50}').success).toBe(
      false,
    );
  });
});

describe("applyExperimentConfig", () => {
  it("merges validated copy after the baseline without changing catalog data", () => {
    const result = applyExperimentConfig({
      decision: baselineDecision,
      config: { copy: { ctaText: "Treatment CTA" } },
      experimentId: "experiment-1",
      variant: "treatment",
    });

    expect(result.payload.products).toEqual(baselineDecision.payload.products);
    expect(result.payload.copy).toEqual({
      headline: "Baseline headline",
      ctaText: "Treatment CTA",
      dismissText: "No thanks",
    });
  });

  it("warns and returns the unchanged decision when config is malformed", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = applyExperimentConfig({
      decision: baselineDecision,
      config: { productId: "injected" },
      experimentId: "experiment-1",
      variant: "treatment",
    });

    expect(result).toBe(baselineDecision);
    expect(warning).toHaveBeenCalledOnce();
  });
});
