import type { CatalogCacheProduct } from "../models/catalogCache.server";
import {
  resolveRequestedCartSelection,
  type ChatMessageHistory,
} from "../models/chatResponse";
import { requestedQuantity } from "./agentOrchestrator.server";

export type PendingCartSelection = {
  productId: string;
  quantity: number;
  options: Record<string, string>;
  expiresAt: number;
};

/** Retain a shopper-authorized add while asking only for missing variant options. */
export function resolveSalesCartIntent(input: {
  message: string;
  history: ChatMessageHistory;
  products: CatalogCacheProduct[];
  pending?: unknown;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const pending = parsePending(input.pending, now);
  if (
    /\b(?:cancel|never mind|nevermind|do not|don't|not now|no thanks)\b/i.test(
      input.message,
    )
  )
    return null;
  const requested = resolveRequestedCartSelection(
    input.message,
    input.history,
    input.products,
  );
  const pendingProduct =
    pending &&
    input.products.find((product) => product.id === pending.productId);
  const isOptionAnswer =
    pendingProduct &&
    input.message.length <= 100 &&
    !/[?]/.test(input.message) &&
    !/\b(?:shipping|returns?|delivery|compare|expensive|think|not|unsure)\b/i.test(
      input.message,
    ) &&
    pendingProduct.variants.some((variant) =>
      variant.selectedOptions.some((option) =>
        includesOption(input.message, option.value),
      ),
    );
  const product =
    requested?.product || (isOptionAnswer ? pendingProduct : null);
  if (!product) return null;
  const quantity = requested
    ? requestedQuantity(input.message)
    : pending!.quantity;
  const options: Record<string, string> =
    pending?.productId === product.id ? { ...pending.options } : {};
  for (const variant of product.variants)
    for (const option of variant.selectedOptions) {
      if (includesOption(input.message, option.value))
        options[option.name] = option.value;
    }
  const matches = product.variants.filter(
    (variant) =>
      variant.availableForSale &&
      Object.entries(options).every(([name, value]) =>
        variant.selectedOptions.some(
          (option) => option.name === name && option.value === value,
        ),
      ),
  );
  const variant =
    requested?.variant || (matches.length === 1 ? matches[0] : null);
  const missing = [
    ...new Set(
      matches.flatMap((item) =>
        item.selectedOptions.map((option) => option.name),
      ),
    ),
  ].filter((name) => !options[name]);
  const nextOption = missing.find(
    (name) =>
      new Set(
        matches.flatMap((item) =>
          item.selectedOptions
            .filter((option) => option.name === name)
            .map((option) => option.value),
        ),
      ).size > 1,
  );
  const choices = nextOption
    ? [
        ...new Set(
          matches.flatMap((item) =>
            item.selectedOptions
              .filter((option) => option.name === nextOption)
              .map((option) => option.value),
          ),
        ),
      ]
    : [];
  return {
    product,
    variant,
    quantity,
    question: nextOption
      ? `Which ${nextOption.toLowerCase()} would you like: ${choices.slice(0, 8).join(", ")}?`
      : "That combination isn't available. Please choose an available option on the card.",
    pending:
      variant || quantity === null
        ? null
        : {
            productId: product.id,
            quantity,
            options,
            expiresAt: now + 10 * 60_000,
          },
  };
}

function includesOption(message: string, option: string) {
  const escaped = option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, "i").test(message);
}

function parsePending(
  value: unknown,
  now: number,
): PendingCartSelection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pending = value as Partial<PendingCartSelection>;
  if (
    typeof pending.productId !== "string" ||
    !Number.isInteger(pending.quantity) ||
    Number(pending.quantity) < 1 ||
    Number(pending.quantity) > 10 ||
    !Number.isFinite(pending.expiresAt) ||
    Number(pending.expiresAt) < now ||
    !pending.options ||
    typeof pending.options !== "object" ||
    Array.isArray(pending.options) ||
    Object.values(pending.options).some((item) => typeof item !== "string")
  )
    return null;
  return pending as PendingCartSelection;
}
