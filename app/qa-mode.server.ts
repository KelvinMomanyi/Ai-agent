/** Owner-controlled deployment flags. Never accept these from a request. */
export function billingPaused() {
  return process.env.AOVBOOST_BILLING_PAUSED === "true";
}

/** Explicitly opt into per-instance QA limits; normal production stays distributed. */
export function qaLocalAiLimitsEnabled() {
  return billingPaused() && process.env.AOVBOOST_QA_LOCAL_AI_LIMITS === "true";
}
