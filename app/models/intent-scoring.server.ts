import type { ProductCandidate } from "./revenue-engine.server";

// We'll update scoreProduct signature eventually, but for now we intercept building the offer.
// In revenue-engine.server.ts, you would import this and call it to adjust the score:

export function intentAwareScoreAdjustment(
  score: number,
  product: ProductCandidate,
  intentProfile: string,
  cartTotal: number,
  reasons: string[]
): number {
  const price = parseFloat(String(product.price || "0")) || 0;
  
  if (intentProfile === "high_intent") {
     // High intent users convert better, we can boost slightly pricier complementary items
     if (price >= 30) {
        reasons.push("High intent session supports higher-value add-ons.");
        return score + 1.5;
     }
  }

  if (intentProfile === "price_sensitive") {
     // They removed something from cart. Boost cheaper items.
     const priceRatio = price / Math.max(cartTotal, 1);
     if (priceRatio < 0.25) {
        reasons.push("Price-sensitive intent favored a low-friction add-on.");
        return score + 2.5;
     } else {
        return score - 1.5; // Penalize expensive items
     }
  }

  if (intentProfile === "abandoning") {
     // They are about to leave. Only show very low friction, high urgency items
     if (price < 25) {
        reasons.push("Abandoning session favored a low-risk impulse item.");
        return score + 3;
     }
  }

  return score;
}
