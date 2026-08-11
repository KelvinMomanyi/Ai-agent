import { z } from "zod";
import type { OfferDecision } from "../ai/types";

const experimentCopySchema = z
  .object({
    headline: z.string().trim().min(1).max(160).optional(),
    subheadline: z.string().trim().min(1).max(240).optional(),
    ctaText: z.string().trim().min(1).max(80).optional(),
    dismissText: z.string().trim().min(1).max(80).optional(),
    greeting: z.string().trim().min(1).max(240).optional(),
    assistantIntro: z.string().trim().min(1).max(240).optional(),
    ctaAccept: z.string().trim().min(1).max(80).optional(),
    ctaDecline: z.string().trim().min(1).max(80).optional(),
    offerLine: z.string().trim().min(1).max(240).optional(),
    progressLabel: z.string().trim().min(1).max(160).optional(),
    rewardDescription: z.string().trim().min(1).max(240).optional(),
    whyThisGoes: z.string().trim().min(1).max(240).optional(),
    oneLineReason: z.string().trim().min(1).max(240).optional(),
  })
  .strict();

/**
 * Experiment configs are intentionally presentation-only. Unknown fields at
 * either level reject the entire config, so product IDs, variants, prices,
 * discounts, thresholds, bundles, and other commerce data cannot be supplied
 * by an experiment.
 */
export const experimentConfigSchema = z
  .object({
    copy: experimentCopySchema.optional(),
  })
  .strict();

export type ExperimentConfig = z.infer<typeof experimentConfigSchema>;
export type ExperimentVariant = "control" | "treatment";

export const EXPERIMENT_CONFIG_PLACEHOLDER = `{
  "copy": {
    "headline": "Complete your setup",
    "subheadline": "A concise supporting message",
    "ctaText": "Add it now",
    "dismissText": "Not now"
  }
}`;

export const EXPERIMENT_CONFIG_HELP_TEXT =
  "Allowed: copy.headline, subheadline, ctaText, dismissText, greeting, assistantIntro, ctaAccept, ctaDecline, offerLine, progressLabel, rewardDescription, whyThisGoes, and oneLineReason. Unknown fields are rejected; product IDs, variants, prices, discounts, thresholds, and bundle contents are catalog-controlled.";

export function validateExperimentConfig(value: unknown) {
  return experimentConfigSchema.safeParse(value);
}

export function parseExperimentConfigText(
  value: string,
):
  | { success: true; data: ExperimentConfig }
  | { success: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || "{}");
  } catch {
    return { success: false, error: "Invalid JSON configuration" };
  }

  const error = getExperimentConfigError(parsed);
  if (error) return { success: false, error: `Unsupported config: ${error}` };

  return {
    success: true,
    data: experimentConfigSchema.parse(parsed),
  };
}

export function getExperimentConfigError(value: unknown): string | null {
  const result = validateExperimentConfig(value);
  if (result.success) return null;

  return result.error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}

export function applyExperimentConfig(input: {
  decision: OfferDecision;
  config: unknown;
  experimentId: string;
  variant: ExperimentVariant;
}): OfferDecision {
  const result = validateExperimentConfig(input.config);
  if (!result.success) {
    console.warn("AOVBoost experiment config rejected; using baseline copy:", {
      experimentId: input.experimentId,
      widgetType: input.decision.widgetType,
      variant: input.variant,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return input.decision;
  }

  const baselineCopy = asRecord(input.decision.payload.copy);
  return {
    ...input.decision,
    payload: {
      ...input.decision.payload,
      ...(result.data.copy
        ? { copy: { ...baselineCopy, ...result.data.copy } }
        : {}),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
