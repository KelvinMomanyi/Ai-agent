import type { StorefrontSettings } from "../sessionManager";

export function agentCoreEnabled(settings: StorefrontSettings = {}): boolean {
  return (
    window.AOVBoost?.agent_core_enabled === true ||
    window.AOVBoost?.settings?.agent_core_enabled === true ||
    settings.agent_core_enabled === true
  );
}

export const CART_SOURCES = [
  "shopper",
  "aov_upsell",
  "aov_bundle",
  "aov_strip",
  "aov_chat",
  "aov_exit",
  "aov_postadd",
] as const;
export type CartSource = (typeof CART_SOURCES)[number];
export type AgentCartSource = Exclude<CartSource, "shopper">;
export function cartSource(detail: Record<string, unknown>): CartSource {
  const value = detail.cartSource;
  return CART_SOURCES.includes(value as CartSource)
    ? (value as CartSource)
    : detail.recommendationOrigin === true
      ? "aov_postadd"
      : "shopper";
}
