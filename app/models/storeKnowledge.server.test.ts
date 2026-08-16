import { describe, expect, it, vi } from "vitest";

vi.mock("../shopify.server", () => ({
  unauthenticated: { admin: vi.fn() },
}));
import {
  buildStoreKnowledgeFallbackReply,
  formatStoreKnowledgeForPrompt,
  plainTextFromHtml,
  type StoreKnowledge,
} from "./storeKnowledge.server";

const store: StoreKnowledge = {
  shop: "trail-shop.myshopify.com",
  name: "Trail Shop",
  description: "Equipment for East African trail adventures.",
  primaryDomain: "trail.example",
  primaryUrl: "https://trail.example",
  contactEmail: "help@trail.example",
  currencyCode: "KES",
  moneyFormat: "KSh{{amount}}",
  moneyWithCurrencyFormat: "KSh{{amount}} KES",
  shipsToCountries: ["KE", "UG"],
  policies: [
    {
      title: "Refund policy",
      type: "REFUND_POLICY",
      body: "Returns are accepted within 14 days when unused.",
      url: "https://trail.example/policies/refund-policy",
    },
    {
      title: "Shipping policy",
      type: "SHIPPING_POLICY",
      body: "Nairobi delivery normally takes two business days.",
      url: "https://trail.example/policies/shipping-policy",
    },
  ],
  refreshedAt: "2026-08-16T00:00:00.000Z",
  source: "shopify_admin",
};

describe("store-specific chat knowledge", () => {
  it("includes only policies relevant to the shopper question", () => {
    const prompt = formatStoreKnowledgeForPrompt({
      store,
      merchantKnowledge: "Support is open Monday to Friday.",
      userMessage: "How long does delivery take?",
    });

    expect(prompt).toContain("Trail Shop");
    expect(prompt).toContain(
      "Nairobi delivery normally takes two business days",
    );
    expect(prompt).not.toContain("Returns are accepted within 14 days");
  });

  it("uses official policy links instead of inventing a fallback answer", () => {
    expect(buildStoreKnowledgeFallbackReply("Can I return this?", store)).toBe(
      "I want to keep this accurate. Please check Refund policy here: https://trail.example/policies/refund-policy",
    );
  });

  it("strips executable markup from Shopify and merchant content", () => {
    expect(
      plainTextFromHtml(
        '<p>Hello <strong>there</strong>.</p><script>alert("x")</script>',
      ),
    ).toBe("Hello there.");
  });
});
