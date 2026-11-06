import { createHmac, timingSafeEqual } from "node:crypto";
import { MEASUREMENT_ATTRIBUTE } from "../../shared/holdout";
function signature(shop: string, encoded: string) {
  const secret =
    process.env.AOVBOOST_STOREFRONT_SESSION_SECRET ||
    process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("Measurement signing unavailable");
  return createHmac("sha256", secret)
    .update(`measurement:${shop}:${encoded}`)
    .digest("base64url");
}
export function measurementLink(
  shop: string,
  sessionId: string,
  version: number,
) {
  const encoded = Buffer.from(
    JSON.stringify({ s: sessionId, v: version }),
  ).toString("base64url");
  return `m1.${encoded}.${signature(shop, encoded)}`;
}
export function verifyMeasurementLink(
  shop: string,
  value: unknown,
): { sessionId: string; version: number } | null {
  if (typeof value !== "string" || value.length > 512) return null;
  try {
    const [prefix, encoded, sig, extra] = value.split(".");
    if (prefix !== "m1" || !encoded || !sig || extra) return null;
    const expected = signature(shop, encoded);
    if (
      sig.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    )
      return null;
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    if (
      !/^[a-zA-Z0-9_-]{1,128}$/.test(parsed.s) ||
      !Number.isSafeInteger(parsed.v) ||
      parsed.v < 1
    )
      return null;
    return { sessionId: parsed.s, version: parsed.v };
  } catch {
    return null;
  }
}
export function orderMeasurementLink(shop: string, order: Record<string, any>) {
  const attributes = Array.isArray(order.note_attributes)
    ? order.note_attributes
    : [];
  const attribute = attributes.find(
    (entry: any) => (entry.name || entry.key) === MEASUREMENT_ATTRIBUTE,
  );
  return verifyMeasurementLink(shop, attribute?.value);
}
