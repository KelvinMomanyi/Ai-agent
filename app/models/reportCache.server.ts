import { getJsonCache, setJsonCache } from "../redis.server";

const pending = new Map<string, Promise<unknown>>();

/** Short-lived tenant-scoped summaries; coalesce duplicate loads on warm instances. */
export async function cachedReport<T>(
  shop: string,
  report: string,
  from: Date,
  load: () => Promise<T>,
): Promise<T> {
  const key = `report:v2:${shop}:${report}:${Math.floor(from.getTime() / 60_000)}`;
  const cached = await getJsonCache<T>(key);
  if (cached) return cached;
  const running = pending.get(key);
  if (running) return running as Promise<T>;
  const task = load()
    .then(async (value) => {
      await setJsonCache(key, value, 30);
      return value;
    })
    .finally(() => pending.delete(key));
  // Never retain unbounded per-tenant state during a burst of distinct reports.
  if (pending.size < 100) pending.set(key, task);
  return task;
}
