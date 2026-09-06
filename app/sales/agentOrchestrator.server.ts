import { z } from "zod";
import type { createCommerceToolLayer } from "./commerceTools.server";
import { extractProfileUpdates, mergeShopperProfile } from "./shopperProfile";
import type { ShopperProfile, SalesState } from "./types";

const toolNames = [
  "search_products",
  "get_product",
  "get_variants",
  "check_inventory",
  "compare_products",
  "get_cart",
  "get_related_products",
  "get_shipping_information",
  "get_return_policy",
  "create_bundle_suggestion",
] as const;
const toolSchema = z.object({
  name: z.enum(toolNames),
  arguments: z.record(z.string(), z.unknown()),
});
const responseSchema = z.object({
  message: z.string().max(2400).optional(),
  reply: z.string().max(2400).optional(),
  intent: z.string().max(80).optional(),
  profileUpdates: z.record(z.string(), z.unknown()).optional(),
  toolCalls: z.array(toolSchema).max(4).optional(),
  productIds: z.array(z.string().max(160)).max(4).optional(),
  action: z
    .object({
      type: z.enum(["show_products", "add_to_cart"]),
      productId: z.string().max(160),
      variantId: z.string().max(160),
      quantity: z.number().int().min(1).max(10),
    })
    .nullable()
    .optional(),
  followUpQuestion: z.string().max(300).nullable().optional(),
});

export function parseSalesAgentResponse(value: unknown) {
  const parsed = responseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Only accept profile text grounded in this shopper's own current message.
 * Numbers/options are deterministically extracted, never trusted to the model.
 */
export function applyGroundedProfileUpdates(
  profile: ShopperProfile,
  proposed: Record<string, unknown> | undefined,
  message: string,
) {
  const textUpdates: Partial<ShopperProfile> = {};
  for (const key of [
    "need",
    "intendedUse",
    "recipient",
    "occasion",
    "urgency",
  ] as const) {
    const value = proposed?.[key];
    if (
      typeof value === "string" &&
      value.length >= 2 &&
      value.length <= 180 &&
      message.toLowerCase().includes(value.toLowerCase())
    ) {
      textUpdates[key] = value;
    }
  }
  return mergeShopperProfile(profile, {
    ...textUpdates,
    ...extractProfileUpdates(message),
  });
}

/** One bounded read-tool round. Mutations are separately consent-validated UI actions. */
export function executeSalesReadTools(
  value: unknown,
  tools: ReturnType<typeof createCommerceToolLayer>,
) {
  const parsed = z.array(toolSchema).max(4).safeParse(value);
  if (!parsed.success) return [];
  return parsed.data.map((call) => {
    const approved = tools.validateToolCall(call);
    if (!approved)
      return {
        name: call.name,
        error: "Invalid or unavailable tool parameters",
      };
    const args = approved.arguments;
    const id = String(args.productId || "");
    const ids = Array.isArray(args.productIds)
      ? args.productIds.map(String)
      : [];
    let result: unknown;
    switch (approved.name) {
      case "search_products":
        result = tools.searchProducts(String(args.query || ""), {}, 3);
        break;
      case "get_product":
        result = tools.getProduct(id);
        break;
      case "get_variants":
        result = tools.getProductVariants(id);
        break;
      case "check_inventory":
        result = {
          source: "catalog_snapshot",
          note: "Availability is rechecked by Shopify when adding; do not claim live stock counts.",
          inventory: tools.checkInventory(String(args.variantId || "")),
        };
        break;
      case "compare_products":
        result = tools.compareProducts(ids);
        break;
      case "get_cart":
        result = tools.getCart();
        break;
      case "get_related_products":
        result = tools.getRelatedProducts(id);
        break;
      case "get_shipping_information":
        result = tools.getShippingInformation();
        break;
      case "get_return_policy":
        result = tools.getReturnPolicy();
        break;
      case "create_bundle_suggestion":
        result = {
          items: tools.createBundleSuggestion(ids),
          discountConfirmed: false,
        };
        break;
      default:
        return { name: call.name, error: "Tool is not a read capability" };
    }
    return { name: call.name, result: boundedToolResult(result) };
  });
}

export function salesAllowsRecommendations(state: SalesState) {
  return state !== "PURCHASED" && state !== "CHECKOUT";
}

export function requestedQuantity(message: string): number | null {
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const match =
    /\b(?:add|put|take|buy|get|quantity(?: of| to|:)?|make (?:it|that))\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(
      message,
    );
  if (!match) return 1;
  const value = words[match[1].toLowerCase()] ?? Number(match[1]);
  return Number.isInteger(value) && value >= 1 && value <= 10 ? value : null;
}

function boundedToolResult(value: unknown, depth = 0): unknown {
  if (depth > 6) return null;
  if (typeof value === "string") return value.slice(0, 1200);
  if (Array.isArray(value))
    return value.slice(0, 8).map((item) => boundedToolResult(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !["metafields", "searchText"].includes(key))
        .slice(0, 24)
        .map(([key, item]) => [key, boundedToolResult(item, depth + 1)]),
    );
  }
  return value;
}
