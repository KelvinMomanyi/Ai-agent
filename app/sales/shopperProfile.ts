import type { ObjectionType, ShopperProfile } from "./types";

const COLORS = [
  "black",
  "white",
  "blue",
  "red",
  "green",
  "grey",
  "gray",
  "brown",
  "beige",
  "pink",
  "purple",
  "orange",
  "yellow",
  "navy",
  "gold",
  "silver",
];

const PREFERENCE_TERMS = [
  "comfort",
  "comfortable",
  "durability",
  "durable",
  "style",
  "stylish",
  "lightweight",
  "waterproof",
  "premium",
  "value",
  "quality",
  "performance",
  "casual",
];

export function emptyShopperProfile(now = new Date()): ShopperProfile {
  return {
    need: "",
    intendedUse: "",
    budgetMin: null,
    budgetMax: null,
    budgetCurrency: "",
    preferences: [],
    preferredColors: [],
    preferredSizes: [],
    brands: [],
    recipient: "",
    occasion: "",
    urgency: "",
    purchaseIntentScore: 0,
    priceSensitivity: "unknown",
    knownObjections: [],
    currentObjection: null,
    updatedAt: now.toISOString(),
  };
}

export function normalizeShopperProfile(
  value: unknown,
  now = new Date(),
): ShopperProfile {
  const input = asRecord(value);
  const fallback = emptyShopperProfile(now);
  return {
    need: cleanText(input.need, 240),
    intendedUse: cleanText(input.intendedUse, 240),
    budgetMin: validMoney(input.budgetMin),
    budgetMax: validMoney(input.budgetMax),
    budgetCurrency: cleanCurrency(input.budgetCurrency),
    preferences: cleanList(input.preferences, 12, 80),
    preferredColors: cleanList(input.preferredColors, 8, 40),
    preferredSizes: cleanList(input.preferredSizes, 8, 40),
    brands: cleanList(input.brands, 8, 80),
    recipient: cleanText(input.recipient, 120),
    occasion: cleanText(input.occasion, 120),
    urgency: cleanText(input.urgency, 120),
    purchaseIntentScore: clamp(Number(input.purchaseIntentScore || 0), 0, 100),
    priceSensitivity:
      input.priceSensitivity === "low" ||
      input.priceSensitivity === "medium" ||
      input.priceSensitivity === "high"
        ? input.priceSensitivity
        : fallback.priceSensitivity,
    knownObjections: cleanObjections(input.knownObjections),
    currentObjection: isObjection(input.currentObjection)
      ? input.currentObjection
      : null,
    updatedAt: cleanText(input.updatedAt, 40) || now.toISOString(),
  };
}

export function extractProfileUpdates(
  message: string,
): Partial<ShopperProfile> {
  const text = cleanText(message, 1_000);
  const lower = text.toLowerCase();
  if (!text) return {};

  const budget = extractBudget(text);
  const colors = COLORS.filter((color) =>
    new RegExp(`\\b${color}\\b`, "i").test(text),
  ).map((color) => (color === "gray" ? "grey" : color));
  const sizes = extractSizes(text);
  const preferences = PREFERENCE_TERMS.filter((term) =>
    new RegExp(`\\b${term}\\b`, "i").test(text),
  );
  const need = extractFirstGroup(text, [
    /\b(?:i need|i want|i(?:'m| am) looking for|looking for)\s+([^.!?]{2,180})/i,
    /\b(?:help me find|show me)\s+([^.!?]{2,180})/i,
  ]);
  const intendedUse = extractFirstGroup(text, [
    /\b(?:for|to use for|using (?:it|this) for)\s+([^.!?]{2,140})/i,
  ]);
  const recipient = /\b(?:gift|present)\b/i.test(text)
    ? /\b(?:for my|for a|for an)\s+([^.!?]{2,80})/i.exec(text)?.[1] ||
      "gift recipient"
    : /\bfor myself\b/i.test(text)
      ? "self"
      : "";
  const occasion = extractFirstGroup(text, [
    /\b(?:for|before)\s+(a |an |the )?(birthday|wedding|anniversary|holiday|trip|race|event)\b/i,
  ]);
  const urgency = /\b(?:today|tonight|right now|asap|immediately)\b/i.test(text)
    ? "immediate"
    : /\b(?:this week|within a week|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i.test(
          text,
        )
      ? "this week"
      : /\b(?:no rush|not urgent|just browsing)\b/i.test(text)
        ? "low"
        : "";

  return compactProfileUpdates({
    ...(need ? { need } : {}),
    ...(intendedUse ? { intendedUse } : {}),
    ...budget,
    ...(colors.length ? { preferredColors: colors } : {}),
    ...(sizes.length ? { preferredSizes: sizes } : {}),
    ...(preferences.length ? { preferences } : {}),
    ...(recipient ? { recipient: cleanText(recipient, 120) } : {}),
    ...(occasion ? { occasion } : {}),
    ...(urgency ? { urgency } : {}),
    ...(budget.budgetMax !== undefined ||
    /\b(?:cheap|cheaper|afford|budget)\b/i.test(lower)
      ? { priceSensitivity: "high" as const }
      : {}),
  });
}

export function mergeShopperProfile(
  currentValue: unknown,
  updates: Partial<ShopperProfile>,
  options: {
    objection?: ObjectionType | null;
    purchaseIntentScore?: number;
    now?: Date;
  } = {},
): ShopperProfile {
  const now = options.now || new Date();
  const current = normalizeShopperProfile(currentValue, now);
  const knownObjections = unique([
    ...current.knownObjections,
    ...(Array.isArray(updates.knownObjections)
      ? updates.knownObjections.filter(isObjection)
      : []),
    ...(options.objection ? [options.objection] : []),
  ]).slice(0, 12) as ObjectionType[];

  return {
    ...current,
    ...compactProfileUpdates(updates),
    preferences: unique([
      ...current.preferences,
      ...(updates.preferences || []),
    ]).slice(0, 12),
    preferredColors: unique([
      ...current.preferredColors,
      ...(updates.preferredColors || []),
    ]).slice(0, 8),
    preferredSizes: unique([
      ...current.preferredSizes,
      ...(updates.preferredSizes || []),
    ]).slice(0, 8),
    brands: unique([...current.brands, ...(updates.brands || [])]).slice(0, 8),
    knownObjections,
    currentObjection:
      options.objection === undefined
        ? updates.currentObjection === undefined
          ? current.currentObjection
          : updates.currentObjection
        : options.objection,
    purchaseIntentScore:
      options.purchaseIntentScore === undefined
        ? current.purchaseIntentScore
        : clamp(options.purchaseIntentScore, 0, 100),
    updatedAt: now.toISOString(),
  };
}

function extractBudget(text: string): Partial<ShopperProfile> {
  const currency = /\b(?:KSh|KES)\b/i.test(text)
    ? "KES"
    : /\b(?:USD|US\$|\$)\b/i.test(text)
      ? "USD"
      : /\b(?:GBP|£)\b/i.test(text)
        ? "GBP"
        : /\b(?:EUR|€)\b/i.test(text)
          ? "EUR"
          : "";
  const numbers = Array.from(
    text.matchAll(
      /(?:KSh|KES|USD|US\$|GBP|EUR|[$£€])?\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
    ),
  )
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .slice(0, 2);
  if (numbers.length === 0) return {};

  if (/\b(?:between|from)\b/i.test(text) && numbers.length >= 2) {
    return {
      budgetMin: Math.min(numbers[0], numbers[1]),
      budgetMax: Math.max(numbers[0], numbers[1]),
      ...(currency ? { budgetCurrency: currency } : {}),
    };
  }
  if (
    /\b(?:under|below|less than|up to|max(?:imum)?|budget(?: is| of)?)\b/i.test(
      text,
    )
  ) {
    return {
      budgetMax: numbers[0],
      ...(currency ? { budgetCurrency: currency } : {}),
    };
  }
  if (/\b(?:over|above|at least|minimum|from)\b/i.test(text)) {
    return {
      budgetMin: numbers[0],
      ...(currency ? { budgetCurrency: currency } : {}),
    };
  }
  return {};
}

function extractSizes(text: string) {
  const values = Array.from(
    text.matchAll(
      /\b(?:size\s*)?(XXS|XS|S|M|L|XL|XXL|XXXL|\d{1,3}(?:\.5)?)\b/gi,
    ),
  ).map((match) => match[1].toUpperCase());
  return unique(values).slice(0, 8);
}

function extractFirstGroup(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const value = match?.[2] || match?.[1];
    if (value) return cleanText(value, 240);
  }
  return "";
}

function compactProfileUpdates(updates: Partial<ShopperProfile>) {
  return Object.fromEntries(
    Object.entries(updates).filter(([, value]) => {
      if (value === undefined || value === null || value === "") return false;
      return !Array.isArray(value) || value.length > 0;
    }),
  ) as Partial<ShopperProfile>;
}

function cleanObjections(value: unknown) {
  return Array.isArray(value)
    ? (unique(value.filter(isObjection) as ObjectionType[]).slice(
        0,
        12,
      ) as ObjectionType[])
    : [];
}

function isObjection(value: unknown): value is ObjectionType {
  return [
    "PRICE",
    "QUALITY",
    "TRUST",
    "SHIPPING",
    "RETURNS",
    "SIZE",
    "FIT",
    "COMPATIBILITY",
    "NEED_TO_THINK",
    "COMPARISON",
    "OUT_OF_STOCK",
    "NOT_SURE",
    "OTHER",
  ].includes(String(value));
}

function validMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function cleanCurrency(value: unknown) {
  const currency = String(value || "").toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "";
}

function cleanList(value: unknown, maxItems: number, maxLength: number) {
  return Array.isArray(value)
    ? unique(
        value.map((item) => cleanText(item, maxLength)).filter(Boolean),
      ).slice(0, maxItems)
    : [];
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(
    Math.max(Number.isFinite(value) ? value : 0, minimum),
    maximum,
  );
}
