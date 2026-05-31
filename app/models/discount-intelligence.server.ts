import type { EngineConfig, CartItem } from "./revenue-engine.server";
import type { VisitorSession } from "@prisma/client";

export type DiscountDecision = {
  shouldDiscount: boolean;
  percentage: number;
  reason: string;
  confidence: number;
};

export function evaluateDiscount(input: {
  intentProfile: string;
  cartTotal: number;
  cartItems: CartItem[];
  visitorSession: VisitorSession;
  shopConfig: EngineConfig;
}): DiscountDecision {
  const { intentProfile, cartTotal, shopConfig } = input;
  
  // Default to the static configured percentage, but we will dynamically withhold it or change it
  let baseDiscount = shopConfig.discountPercentage || 0;
  
  if (baseDiscount === 0) {
     return { shouldDiscount: false, percentage: 0, reason: "Discounts disabled in config", confidence: 100 };
  }

  // High intent - would buy anyway, protect margin
  if (intentProfile === "high_intent") {
      return { 
          shouldDiscount: false, 
          percentage: 0, 
          reason: "Margin protected: High intent shopper showing no hesitation.", 
          confidence: 90 
      };
  }

  // Price sensitive - needs a nudge, maybe a bit higher than base if cart is big
  if (intentProfile === "price_sensitive") {
      const percentage = cartTotal > 100 ? Math.min(baseDiscount + 5, 20) : baseDiscount;
      return { 
          shouldDiscount: true, 
          percentage, 
          reason: "Price sensitive behavior detected (cart removes). Applying targeted discount.", 
          confidence: 85 
      };
  }

  // Abandoning - throw a slightly better offer to save the cart
  if (intentProfile === "abandoning" && cartTotal >= 30) {
      const percentage = Math.min(baseDiscount + 5, 25);
      return { 
          shouldDiscount: true, 
          percentage, 
          reason: "Exit intent / Abandonment detected. Applying save-the-sale discount.", 
          confidence: 95 
      };
  }

  // Browsing - don't waste discounts on cold traffic
  if (intentProfile === "browsing") {
      return { 
          shouldDiscount: false, 
          percentage: 0, 
          reason: "Margin protected: Browsing behavior with low engagement.", 
          confidence: 80 
      };
  }

  // Considering - default behavior
  return { 
      shouldDiscount: true, 
      percentage: baseDiscount, 
      reason: "Considering behavior: applying standard incentive.", 
      confidence: 75 
  };
}
