import type { MerchantSalesSettings, SalesState } from "./types";

export type ProactiveDecision = {
  allowed: boolean;
  reason: string;
  confidence: number;
  messageType:
    | "collection_help"
    | "product_help"
    | "comparison_help"
    | "hesitation_help"
    | "returning_help"
    | null;
};

export function evaluateProactiveMessage(input: {
  triggerType: string;
  pageType: string;
  dwellSeconds: number;
  scrollDepth: number;
  intentScore: number;
  hesitationScore: number;
  salesState: SalesState;
  promptCount: number;
  dismissed: boolean;
  lastPromptAt?: number | null;
  now?: number;
  settings: MerchantSalesSettings;
}): ProactiveDecision {
  const deny = (reason: string): ProactiveDecision => ({
    allowed: false,
    reason,
    confidence: 0,
    messageType: null,
  });
  const blocked = proactiveBlockReason(input);
  if (blocked) return deny(blocked);

  let confidence = 0;
  let messageType: ProactiveDecision["messageType"] = null;
  if (
    input.pageType === "collection" &&
    input.dwellSeconds >= input.settings.proactiveDelaySeconds &&
    input.scrollDepth >= 25
  ) {
    confidence = 0.68;
    messageType = "collection_help";
  }
  if (
    input.pageType === "product" &&
    input.dwellSeconds >= input.settings.proactiveDelaySeconds &&
    (input.intentScore >= 15 || input.triggerType === "long_product_dwell")
  ) {
    confidence = 0.72;
    messageType = "product_help";
  }
  if (input.triggerType === "repeated_product_view") {
    confidence = 0.82;
    messageType = "comparison_help";
  }
  if (
    input.settings.hesitationDetectionEnabled &&
    input.hesitationScore >= 55
  ) {
    confidence = 0.86;
    messageType = "hesitation_help";
  }
  if (input.triggerType === "returning_shopper") {
    confidence = 0.7;
    messageType = "returning_help";
  }

  if (!messageType) return deny("no_eligible_rule");
  if (confidence < input.settings.minimumProactiveConfidence) {
    return deny("below_confidence_threshold");
  }
  return { allowed: true, reason: "eligible", confidence, messageType };
}

export function proactiveBlockReason(
  input: Pick<
    Parameters<typeof evaluateProactiveMessage>[0],
    | "settings"
    | "dismissed"
    | "salesState"
    | "promptCount"
    | "lastPromptAt"
    | "now"
  >,
) {
  if (!input.settings.agentEnabled) return "agent_disabled";
  if (!input.settings.proactiveMessagesEnabled) return "proactive_disabled";
  if (input.dismissed) return "shopper_dismissed";
  if (input.salesState === "PURCHASED" || input.salesState === "CHECKOUT")
    return "sales_state_disallows_interruption";
  if (input.promptCount >= input.settings.maxProactivePrompts)
    return "session_prompt_limit";
  if (
    input.lastPromptAt &&
    (input.now ?? Date.now()) - input.lastPromptAt <
      Math.max(120, input.settings.proactiveDelaySeconds) * 1_000
  )
    return "cooldown_active";
  return null;
}

export function getProactiveMessage(type: ProactiveDecision["messageType"]) {
  switch (type) {
    case "collection_help":
      return "Looking for something specific? I can narrow these down by budget or what you need it for.";
    case "product_help":
      return "Good choice. Want me to help check whether this is the best option for what you need?";
    case "comparison_help":
      return "Comparing a few options? I can help you choose the one that fits your needs best.";
    case "hesitation_help":
      return "Still deciding? If it’s sizing, price, or delivery you’re unsure about, I can help.";
    case "returning_help":
      return "Welcome back. Want to continue narrowing down the products you were considering?";
    default:
      return "Want a hand choosing the best fit?";
  }
}
