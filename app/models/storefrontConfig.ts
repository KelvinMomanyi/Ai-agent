import { z } from "zod";

const date = z.string().datetime({ offset: true });
const schema = z.object({
  version: z.literal(1),
  agentCoreEnabled: z.boolean(),
  automaticPlacements: z.boolean(),
  campaign: z.object({
    enabled: z.boolean(),
    headline: z.string().trim().max(100),
    body: z.string().trim().max(240),
    startsAt: date.optional(),
    endsAt: date.optional(),
  }),
  notice: z.object({
    enabled: z.boolean(),
    productIds: z
      .array(z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/))
      .max(50),
    body: z.string().trim().max(240),
    startsAt: date.optional(),
    endsAt: date.optional(),
  }),
  rewardCode: z
    .string()
    .trim()
    .max(64)
    .regex(/^[a-zA-Z0-9_-]*$/),
  proof: z.object({
    enabled: z.boolean(),
    windowDays: z.union([z.literal(7), z.literal(30)]),
  }),
});
export type StorefrontConfig = z.infer<typeof schema>;
export function defaultStorefrontConfig(): StorefrontConfig {
  return {
    version: 1,
    agentCoreEnabled: false,
    automaticPlacements: true,
    campaign: { enabled: false, headline: "", body: "" },
    notice: { enabled: false, productIds: [], body: "" },
    rewardCode: "",
    proof: { enabled: false, windowDays: 7 },
  };
}
export function readStorefrontConfig(value: unknown): StorefrontConfig {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : defaultStorefrontConfig();
}
export function validateStorefrontConfig(
  value: unknown,
  now = Date.now(),
): StorefrontConfig {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "Check the campaign dates, notice products and discount code.",
    );
  const config = parsed.data;
  for (const input of [config.campaign, config.notice]) {
    if (
      input.startsAt &&
      input.endsAt &&
      Date.parse(input.startsAt) >= Date.parse(input.endsAt)
    )
      throw new Error("The start must be before the end.");
  }
  if (
    config.campaign.enabled &&
    (!config.campaign.endsAt ||
      Date.parse(config.campaign.endsAt) <= now ||
      !config.campaign.headline)
  )
    throw new Error(
      "Supply a campaign title and a future end time, or turn the campaign off.",
    );
  if (
    config.notice.enabled &&
    (!config.notice.body || !config.notice.productIds.length)
  )
    throw new Error("Supply notice text and at least one product.");
  if (
    [config.campaign.headline, config.campaign.body, config.notice.body].some(
      (v) => /\{\{|\$\{|\{[a-zA-Z_]\w*\}/.test(v),
    )
  )
    throw new Error("Use complete text without template placeholders.");
  config.notice.productIds = [...new Set(config.notice.productIds)];
  return config;
}
