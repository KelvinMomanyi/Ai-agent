import { getJsonCache, setJsonCache } from "../redis.server";
import { unauthenticated } from "../shopify.server";

export type StorePolicy = {
  title: string;
  type: string;
  body: string;
  url: string;
  updatedAt?: string;
};

export type StoreKnowledge = {
  shop: string;
  name: string;
  description: string;
  primaryDomain: string;
  primaryUrl: string;
  contactEmail: string;
  currencyCode: string;
  moneyFormat: string;
  moneyWithCurrencyFormat: string;
  shipsToCountries: string[];
  policies: StorePolicy[];
  refreshedAt: string;
  source: "shopify_admin" | "shop_domain_fallback";
};

const STORE_KNOWLEDGE_TTL_SECONDS = 6 * 60 * 60;

export async function getStoreKnowledge(shop: string): Promise<StoreKnowledge> {
  const key = `store-knowledge:${shop}`;
  const cached = await getJsonCache<StoreKnowledge>(key);
  if (cached?.name) return cached;

  const fallback = buildFallbackStoreKnowledge(shop);
  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(`#graphql
      query AOVBoostStoreKnowledge {
        shop {
          name
          description
          contactEmail
          currencyCode
          currencyFormats {
            moneyFormat
            moneyWithCurrencyFormat
          }
          primaryDomain { host url }
          shipsToCountries
          shopPolicies {
            title
            type
            body
            url
            updatedAt
          }
        }
      }
    `);
    const result: any = await response.json();
    const value = result?.data?.shop;
    if (!value?.name) {
      throw new Error(
        Array.isArray(result?.errors)
          ? result.errors.map((error: any) => error?.message).join("; ")
          : "Shopify returned no shop profile",
      );
    }

    const knowledge: StoreKnowledge = {
      shop,
      name: cleanText(value.name, 200) || fallback.name,
      description: cleanText(value.description, 2_000),
      primaryDomain:
        cleanText(value.primaryDomain?.host, 300) || fallback.primaryDomain,
      primaryUrl:
        cleanText(value.primaryDomain?.url, 500) || fallback.primaryUrl,
      contactEmail: cleanText(value.contactEmail, 320),
      currencyCode: cleanCurrencyCode(value.currencyCode),
      moneyFormat: String(value.currencyFormats?.moneyFormat || "").slice(
        0,
        200,
      ),
      moneyWithCurrencyFormat: String(
        value.currencyFormats?.moneyWithCurrencyFormat || "",
      ).slice(0, 200),
      shipsToCountries: Array.isArray(value.shipsToCountries)
        ? value.shipsToCountries.map(String).filter(Boolean).slice(0, 250)
        : [],
      policies: normalizePolicies(value.shopPolicies),
      refreshedAt: new Date().toISOString(),
      source: "shopify_admin",
    };
    await setJsonCache(key, knowledge, STORE_KNOWLEDGE_TTL_SECONDS);
    return knowledge;
  } catch (error) {
    console.warn("AOVBoost could not load store knowledge:", {
      shop,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

export function formatStoreKnowledgeForPrompt(input: {
  store: StoreKnowledge;
  merchantKnowledge?: string | null;
  userMessage: string;
}) {
  const relevantPolicies = selectRelevantPolicies(
    input.store.policies,
    input.userMessage,
  );
  const identity = [
    `Store name: ${input.store.name}`,
    input.store.description
      ? `Store description: ${input.store.description}`
      : "",
    `Official storefront: ${input.store.primaryUrl || input.store.primaryDomain}`,
    `Store currency: ${input.store.currencyCode || "not provided"}`,
    input.store.shipsToCountries.length > 0
      ? `Configured shipping countries: ${input.store.shipsToCountries.join(", ")}`
      : "Configured shipping countries: not provided",
    isContactQuestion(input.userMessage) && input.store.contactEmail
      ? `Store contact email: ${input.store.contactEmail}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const merchantFacts = cleanText(input.merchantKnowledge, 8_000);
  const policies = relevantPolicies
    .map(
      (policy) =>
        `Policy: ${policy.title} (${policy.type})\nOfficial URL: ${policy.url}\nPublished text: ${cleanText(policy.body, 3_000)}`,
    )
    .join("\n\n");

  return [
    identity,
    merchantFacts ? `Merchant-verified store facts:\n${merchantFacts}` : "",
    policies ? `Relevant published Shopify policies:\n${policies}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildStoreKnowledgeFallbackReply(
  userMessage: string,
  store: StoreKnowledge,
) {
  const policies = selectRelevantPolicies(store.policies, userMessage);
  if (policies.length > 0) {
    const policy = policies[0];
    return `I want to keep this accurate. Please check ${policy.title} here: ${policy.url}`;
  }
  if (/\b(return|refund|exchange|money back)\b/i.test(userMessage)) {
    return "I don’t have a verified published return policy to quote, so I don’t want to guess. Please contact the store for confirmation.";
  }
  if (
    /\b(ship|shipping|deliver|delivery|dispatch|ships to)\b/i.test(userMessage)
  ) {
    return "I don’t have verified shipping details for that request, so I don’t want to guess. Please use the store’s checkout or contact the store to confirm delivery availability.";
  }
  if (isContactQuestion(userMessage) && store.contactEmail) {
    return `You can contact ${store.name} at ${store.contactEmail}.`;
  }
  if (isContactQuestion(userMessage)) {
    return "I don’t have a verified customer-service contact to share, so I don’t want to guess. Please use the store’s published contact page if one is available.";
  }
  if (/\b(who are you|what store|store name|where am i)\b/i.test(userMessage)) {
    return `You’re shopping with ${store.name}${store.primaryUrl ? ` at ${store.primaryUrl}` : ""}.`;
  }
  return "";
}

export function plainTextFromHtml(value: unknown, maxLength = 12_000) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim()
    .slice(0, maxLength);
}

function normalizePolicies(value: unknown): StorePolicy[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((policy) => ({
      title: cleanText(policy?.title, 200),
      type: cleanText(policy?.type, 100),
      body: plainTextFromHtml(policy?.body),
      url: cleanText(policy?.url, 500),
      updatedAt: cleanText(policy?.updatedAt, 100) || undefined,
    }))
    .filter((policy) => policy.title && policy.url)
    .slice(0, 20);
}

function selectRelevantPolicies(policies: StorePolicy[], userMessage: string) {
  const text = userMessage.toLowerCase();
  const desiredTypes = new Set<string>();
  if (/\b(return|refund|exchange|money back)\b/.test(text)) {
    desiredTypes.add("REFUND_POLICY");
  }
  if (
    /\b(ship|shipping|deliver|delivery|dispatch|country|countries)\b/.test(text)
  ) {
    desiredTypes.add("SHIPPING_POLICY");
  }
  if (/\b(privacy|personal data|data policy)\b/.test(text)) {
    desiredTypes.add("PRIVACY_POLICY");
  }
  if (/\b(terms|conditions|terms of service|terms of sale)\b/.test(text)) {
    desiredTypes.add("TERMS_OF_SERVICE");
    desiredTypes.add("TERMS_OF_SALE");
  }
  if (/\b(subscription|recurring|cancel subscription)\b/.test(text)) {
    desiredTypes.add("SUBSCRIPTION_POLICY");
  }
  if (desiredTypes.size === 0) return [];
  return policies.filter((policy) => desiredTypes.has(policy.type)).slice(0, 3);
}

function isContactQuestion(value: string) {
  return /\b(contact|email|phone|call|support team|customer service|human|person)\b/i.test(
    value,
  );
}

function buildFallbackStoreKnowledge(shop: string): StoreKnowledge {
  const name = shop
    .replace(/\.myshopify\.com$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
  return {
    shop,
    name: name || "this store",
    description: "",
    primaryDomain: shop,
    primaryUrl: shop ? `https://${shop}` : "",
    contactEmail: "",
    currencyCode: "",
    moneyFormat: "",
    moneyWithCurrencyFormat: "",
    shipsToCountries: [],
    policies: [],
    refreshedAt: new Date().toISOString(),
    source: "shop_domain_fallback",
  };
}

function cleanCurrencyCode(value: unknown) {
  const code = String(value || "")
    .trim()
    .toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "";
}

function cleanText(value: unknown, maxLength: number) {
  return plainTextFromHtml(value, maxLength);
}
