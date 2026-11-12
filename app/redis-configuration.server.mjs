/** Select one complete server-side credential pair; never mix providers. */
export function redisConnection(env = process.env) {
  const requested = env.AOVBOOST_REDIS_SOURCE || "auto";
  if (!["auto", "upstash", "vercel_kv"].includes(requested))
    return { status: "invalid_source" };
  const source =
    requested === "auto"
      ? env.UPSTASH_REDIS_REST_URL || env.UPSTASH_REDIS_REST_TOKEN
        ? "upstash"
        : "vercel_kv"
      : requested;
  const [url, token] =
    source === "upstash"
      ? [env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN]
      : [env.KV_REST_API_URL, env.KV_REST_API_TOKEN];
  if (!url && !token) return { status: "not_configured", source };
  if (!url || !token) return { status: "incomplete_credentials", source };
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      return { status: "invalid_url", source };
  } catch {
    return { status: "invalid_url", source };
  }
  return { status: "configured", source, url, token };
}
