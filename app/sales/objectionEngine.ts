import type { ObjectionType, ShopperProfile } from "./types";

const OBJECTION_RULES: Array<{
  type: ObjectionType;
  pattern: RegExp;
}> = [
  {
    type: "PRICE",
    pattern:
      /\b(?:too expensive|costly|cheaper|price|afford|budget|worth it)\b/i,
  },
  {
    type: "QUALITY",
    pattern:
      /\b(?:quality|durable|durability|reliable|break|last long|materials?)\b/i,
  },
  {
    type: "TRUST",
    pattern: /\b(?:trust|legit|scam|safe|secure|guarantee|authentic)\b/i,
  },
  {
    type: "SHIPPING",
    pattern: /\b(?:ship|shipping|delivery|deliver|arrive|dispatch)\b/i,
  },
  { type: "RETURNS", pattern: /\b(?:return|refund|exchange|money back)\b/i },
  {
    type: "SIZE",
    pattern: /\b(?:size|sizing|size chart|too small|too large)\b/i,
  },
  {
    type: "FIT",
    pattern: /\b(?:fit|comfort|comfortable|wide|narrow|tight|loose)\b/i,
  },
  {
    type: "COMPATIBILITY",
    pattern:
      /\b(?:compatible|compatibility|work with|fit with|connect to|support my)\b/i,
  },
  {
    type: "NEED_TO_THINK",
    pattern:
      /\b(?:need to think|think about it|not ready|maybe later|sleep on it)\b/i,
  },
  {
    type: "COMPARISON",
    pattern:
      /\b(?:compare|comparison|versus|\bvs\b|difference|which is better)\b/i,
  },
  {
    type: "OUT_OF_STOCK",
    pattern: /\b(?:out of stock|sold out|unavailable|not available)\b/i,
  },
  {
    type: "NOT_SURE",
    pattern: /\b(?:not sure|uncertain|can't decide|cannot decide|confused)\b/i,
  },
];

export function classifyObjection(message: string): ObjectionType | null {
  const matched = OBJECTION_RULES.find((rule) => rule.pattern.test(message));
  return matched?.type || null;
}

export function getObjectionGuidance(
  objection: ObjectionType | null,
  profile: ShopperProfile,
) {
  switch (objection) {
    case "PRICE":
      return "Explain verified value briefly, then include a genuinely suitable cheaper option when available. Never invent a discount.";
    case "QUALITY":
      return "Use only verified materials, specifications, warranty, reviews, and store facts. Say when evidence is unavailable.";
    case "TRUST":
      return "Reduce risk with verified merchant identity, policy, guarantee, and secure-checkout facts only.";
    case "SHIPPING":
      return "Answer from published shipping information. Never estimate an arrival date without verified data.";
    case "RETURNS":
      return "Explain the published return or refund policy accurately and link to it when available.";
    case "SIZE":
    case "FIT":
      return `Use available variant data and ask only for the missing size or fit preference.${profile.preferredSizes.length ? ` Known size: ${profile.preferredSizes.join(", ")}.` : ""}`;
    case "COMPATIBILITY":
      return "Recommend only when compatibility is explicitly supported by catalog facts; otherwise say it cannot be verified.";
    case "NEED_TO_THINK":
      return "Lower pressure and ask what single concern remains unresolved. Do not add another upsell.";
    case "COMPARISON":
      return "Compare only differences that matter to the shopper's stated need and give a clear best-fit opinion.";
    case "OUT_OF_STOCK":
      return "Acknowledge unavailable variants and offer the closest currently sellable alternative.";
    case "NOT_SURE":
      return "Ask one focused question about the most important buying criterion.";
    default:
      return "Address the shopper's concern directly and calmly without arguing or applying pressure.";
  }
}
