import { describe, expect, it } from "vitest";
import { buildSalesAgentSystemPrompt } from "./chatPrompt.server";

describe("sales agent prompt", () => {
  it("assembles all four grounded context sources and a structured action contract", () => {
    const prompt = buildSalesAgentSystemPrompt({
      storeIdentity: "Store name: Trail Shop",
      allowedProducts: "ID: gid://shopify/Product/1",
      cartState: "Verified live Shopify cart: empty.",
      visitorSignals: "Verified products viewed: Trail Board",
      conversationHistory: "Shopper: show me boards",
      activeBundles: "No active bundles",
      assistantTone: "friendly",
      brandVoice: "Practical",
      messageIntent: "product_search",
      urgencyLevel: "balanced",
      cartValueGoal: "KSh5,000.00",
      catalogStatus: "loaded",
    });

    expect(prompt).toContain("[STORE IDENTITY]");
    expect(prompt).toContain("[ALLOWED PRODUCTS]");
    expect(prompt).toContain("[CART STATE]");
    expect(prompt).toContain("[VISITOR SIGNALS]");
    expect(prompt).toContain("[CONVERSATION HISTORY]");
    expect(prompt).toContain("[OUTPUT CONTRACT]");
    expect(prompt).toContain('"type":"show_products"|"add_to_cart"');
    expect(prompt).toContain(
      "Never return an ID that is absent from [ALLOWED PRODUCTS]",
    );
  });
});
