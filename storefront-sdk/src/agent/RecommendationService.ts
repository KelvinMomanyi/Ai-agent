import type { OfferDecision } from "../widgets/widgetManager";
import type { WidgetPayload, WidgetProduct } from "../widgets/BaseWidget";
import type { AgentContext } from "./types";
import { recommendationLimit } from "../../../shared/cartRecommendations";

export const RECOMMENDATION_LIMITS = Object.freeze({
  CACHE_TTL_MS: 15_000,
  CACHE_ENTRIES: 48,
  REQUEST_TIMEOUT_MS: 1_500,
  MAX_CANDIDATES: 10,
  HYDRATION_CONCURRENCY: 4,
  MAX_VARIANTS: 250,
});
export type RecommendationScope = {
  root: string;
  currency: string;
  locale: string;
  market: string;
};
type Options = {
  shop: string;
  scope: () => RecommendationScope;
  normalize: (payload: WidgetPayload) => WidgetProduct[];
  productResolved?: (product: {
    id: string;
    title: string;
    handle: string;
  }) => void;
};
type Result = { decision: OfferDecision | null; reason: string };
type Read = { promise: Promise<unknown>; controller: AbortController };
const TYPES = new Set(["bundle", "rec_strip", "upsell_drawer"]);
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const productId = (value: unknown) => {
  const id = String(value || "");
  return /^gid:\/\/shopify\/Product\/\d+$/.test(id)
    ? id
    : /^\d+$/.test(id)
      ? `gid://shopify/Product/${id}`
      : "";
};
const aborted = () =>
  new DOMException("Recommendation cancelled", "AbortError");
function withSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const stop = () => {
      signal.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      stop();
      reject(aborted());
    };
    signal.addEventListener("abort", cancel, { once: true });
    promise.then(
      (value) => {
        stop();
        resolve(value);
      },
      (error) => {
        stop();
        reject(error);
      },
    );
  });
}

/** Public catalog data only, in memory. Offer authorizations are never cached. */
export class RecommendationService {
  private cache = new Map<string, { value: unknown; expiresAt: number }>();
  private reads = new Map<string, Read>();
  private offers = new Map<string, Promise<OfferDecision | null>>();
  private claims = new Map<string, Set<string>>();
  private revision = 0;
  private destroyed = false;
  private counters = {
    catalogReads: 0,
    cacheHits: 0,
    coalescedReads: 0,
    coalescedOffers: 0,
    fallbacks: 0,
  };
  constructor(private options: Options) {}

  handles(type: string | null): boolean {
    return TYPES.has(type || "");
  }
  getStatus() {
    return {
      ...this.counters,
      cachedReads: this.cache.size,
      pendingReads: this.reads.size,
      pendingOffers: this.offers.size,
    };
  }
  async resolveProductId(handle: string): Promise<string | undefined> {
    try {
      let decoded = handle;
      try {
        decoded = decodeURIComponent(handle);
      } catch {
        /* Keep malformed input bounded by URL encoding. */
      }
      if (!decoded || decoded.length > 255) return undefined;
      const live = (await this.read(
        `products/${encodeURIComponent(decoded)}.js`,
      )) as { id?: unknown; title?: unknown; handle?: unknown };
      if (productId(live?.id))
        this.options.productResolved?.({
          id: productId(live.id),
          title: typeof live.title === "string" ? live.title.slice(0, 160) : "",
          handle: decoded,
        });
      return productId(live?.id) || undefined;
    } catch {
      return undefined;
    }
  }
  private scope(): RecommendationScope {
    const scope = this.options.scope();
    return {
      ...scope,
      root: /^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(scope.root) ? scope.root : "/",
    };
  }
  scopeKey(): string {
    return JSON.stringify([this.options.shop, this.scope()]);
  }

  coalesceOffer(
    key: string,
    request: () => Promise<OfferDecision | null>,
  ): Promise<OfferDecision | null> {
    if (this.destroyed) return Promise.resolve(null);
    const scope = this.scopeKey();
    const scopedKey = `${this.revision}:${scope}:${key}`;
    const pending = this.offers.get(scopedKey);
    if (pending) {
      this.counters.coalescedOffers++;
      return pending.then((value) => (value ? copy(value) : null));
    }
    const revision = this.revision;
    const promise = Promise.resolve()
      .then(() =>
        revision === this.revision &&
        scope === this.scopeKey() &&
        !this.destroyed
          ? request()
          : null,
      )
      .then((value) =>
        revision === this.revision &&
        scope === this.scopeKey() &&
        !this.destroyed
          ? value
          : null,
      );
    this.offers.set(scopedKey, promise);
    const clear = () => {
      if (this.offers.get(scopedKey) === promise) this.offers.delete(scopedKey);
    };
    promise.then(clear, clear);
    return promise.then((value) => (value ? copy(value) : null));
  }

  private async read(path: string, signal?: AbortSignal): Promise<unknown> {
    if (this.destroyed || signal?.aborted) throw aborted();
    const scope = this.scope();
    const key = `${this.scopeKey()}:${path}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      this.counters.cacheHits++;
      return copy(cached.value);
    }
    this.cache.delete(key);
    const existing = this.reads.get(key);
    if (existing) {
      this.counters.coalescedReads++;
      return withSignal(existing.promise.then(copy), signal);
    }
    const controller = new AbortController();
    const revision = this.revision;
    const entry: Read = { controller, promise: Promise.resolve(null) };
    this.counters.catalogReads++;
    entry.promise = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const value = await Promise.race([
          Promise.resolve().then(async () => {
            const response = await fetch(`${scope.root}${path}`, {
              signal: controller.signal,
              cache: "no-store",
              credentials: "same-origin",
              headers: { Accept: "application/json" },
            });
            if (!response.ok) throw new Error("Catalog unavailable");
            return response.json();
          }),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(aborted());
            }, RECOMMENDATION_LIMITS.REQUEST_TIMEOUT_MS);
          }),
          new Promise<never>((_resolve, reject) => {
            controller.signal.addEventListener(
              "abort",
              () => reject(aborted()),
              { once: true },
            );
          }),
        ]);
        if (
          revision !== this.revision ||
          this.destroyed ||
          controller.signal.aborted ||
          key !== `${this.scopeKey()}:${path}`
        )
          throw aborted();
        this.cache.set(key, {
          value: copy(value),
          expiresAt: Date.now() + RECOMMENDATION_LIMITS.CACHE_TTL_MS,
        });
        while (this.cache.size > RECOMMENDATION_LIMITS.CACHE_ENTRIES)
          this.cache.delete(this.cache.keys().next().value!);
        return value;
      } finally {
        clearTimeout(timer);
        if (this.reads.get(key) === entry) this.reads.delete(key);
      }
    })();
    this.reads.set(key, entry);
    return withSignal(entry.promise.then(copy), signal);
  }

  private async hydrate(
    product: WidgetProduct,
    signal?: AbortSignal,
  ): Promise<WidgetProduct | null> {
    const id = productId(product.id);
    if (!id || !product.handle || product.handle.length > 255) return null;
    try {
      const live = (await this.read(
        `products/${encodeURIComponent(product.handle)}.js`,
        signal,
      )) as Record<string, any>;
      if (
        !live ||
        productId(live.id) !== id ||
        live.available === false ||
        !Array.isArray(live.variants)
      )
        return null;
      const liveVariants = new Map(
        live.variants
          .slice(0, RECOMMENDATION_LIMITS.MAX_VARIANTS)
          .map((variant: Record<string, unknown>) => [
            `gid://shopify/ProductVariant/${variant.id}`,
            variant,
          ]),
      );
      const variants = product.variants.flatMap((variant) => {
        const current = liveVariants.get(variant.id) as
          Record<string, unknown> | undefined;
        if (
          !variant.availableForSale ||
          current?.available !== true ||
          typeof current.price !== "number" ||
          !Number.isFinite(current.price) ||
          current.price < 0
        )
          return [];
        return [
          {
            ...variant,
            price: (current.price / 100).toFixed(2),
            compareAtPrice:
              typeof current.compare_at_price === "number" &&
              Number.isFinite(current.compare_at_price) &&
              current.compare_at_price > current.price
                ? (current.compare_at_price / 100).toFixed(2)
                : null,
          },
        ];
      });
      if (!variants.length) return null;
      const selected =
        variants.find((variant) => variant.id === product.variantId) ||
        variants[0];
      return {
        ...product,
        id,
        title:
          typeof live.title === "string" && live.title.trim()
            ? live.title
            : product.title,
        variants,
        variantId: selected.id,
        price: selected.price,
      };
    } catch {
      return null;
    }
  }

  private excluded(providerId: string, ctx: AgentContext): Set<string> {
    const ids = new Set(
      ctx.cart.items.map((item) => productId(item.productId)).filter(Boolean),
    );
    for (const [owner, claimed] of this.claims)
      if (owner !== providerId) for (const id of claimed) ids.add(id);
    return ids;
  }
  isSelectionCurrent(providerId: string, ctx: AgentContext): boolean {
    const selected = this.claims.get(providerId);
    if (!selected) return true;
    const excluded = this.excluded(providerId, ctx);
    return ![...selected].some((id) => excluded.has(id));
  }

  async prepare(
    decision: OfferDecision,
    providerId: string,
    ctx: AgentContext,
    signal?: AbortSignal,
  ): Promise<Result> {
    if (!this.handles(decision.widgetType))
      return { decision, reason: "not_recommendation" };
    const no = (reason: string): Result => ({ decision: null, reason });
    if (
      this.destroyed ||
      signal?.aborted ||
      ctx.agent.holdout ||
      ctx.page.type === "checkout"
    )
      return no("recommendation_suppressed");
    const revision = this.revision,
      scope = this.scopeKey();
    const bundle = decision.widgetType === "bundle";
    const products = this.options.normalize(decision.payload || {});
    if (!products.length) return no("recommendation_data_required");
    const live = new Array<WidgetProduct | null>(products.length).fill(null);
    let next = 0;
    await Promise.all(
      Array.from(
        {
          length: Math.min(
            products.length,
            RECOMMENDATION_LIMITS.HYDRATION_CONCURRENCY,
          ),
        },
        async () => {
          while (
            next < products.length &&
            !signal?.aborted &&
            revision === this.revision
          ) {
            const index = next++;
            live[index] = await this.hydrate(products[index], signal);
          }
        },
      ),
    );
    if (
      signal?.aborted ||
      revision !== this.revision ||
      scope !== this.scopeKey() ||
      this.destroyed
    )
      return no("stale_recommendation");
    if (bundle && live.some((product) => !product))
      return no("bundle_component_unavailable");
    let eligible = live.filter(
      (product): product is WidgetProduct => product !== null,
    );
    const denied = this.excluded(providerId, ctx);
    const seen = new Set<string>();
    eligible = eligible.filter((product) => {
      const key = bundle ? product.variantId : product.id;
      if (denied.has(product.id) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (bundle && eligible.length !== products.length)
      return no("bundle_overlap");
    if (!eligible.length) return no("recommendations_already_present");

    // The existing app endpoint owns plan/holdout/filter approval and offer IDs.
    // Native recommendations may rank this approved pool; they never expand it.
    let fallback = false;
    if (
      !bundle &&
      !ctx.agent.aiHealthy &&
      decision.aiProvider !== "heuristic"
    ) {
      fallback = true;
      const seed = productId(
        decision.payload?.sourceProductId ||
          ctx.page.productId ||
          ctx.cart.items[0]?.productId,
      );
      let related: string[] = [];
      if (seed && decision.payload?.offerId) {
        try {
          const intent =
            decision.widgetType === "upsell_drawer"
              ? "complementary"
              : "related";
          const data = (await this.read(
            `recommendations/products.json?product_id=${seed.split("/").pop()}&intent=${intent}&limit=${RECOMMENDATION_LIMITS.MAX_CANDIDATES}`,
            signal,
          )) as { products?: Array<{ id?: unknown }> };
          if (Array.isArray(data?.products))
            related = data.products
              .map((product) => productId(product.id))
              .filter(Boolean);
        } catch {
          /* The approved, live-verified catalog still supplies a fallback. */
        }
      }
      const rank = new Map(related.map((id, index) => [id, index]));
      eligible.sort(
        (a, b) =>
          (rank.get(a.id) ?? RECOMMENDATION_LIMITS.MAX_CANDIDATES) -
            (rank.get(b.id) ?? RECOMMENDATION_LIMITS.MAX_CANDIDATES) ||
          a.id.localeCompare(b.id),
      );
      eligible = eligible.map((product) => ({
        ...product,
        reason: "Selected from this store's available products.",
      }));
    }
    if (
      signal?.aborted ||
      revision !== this.revision ||
      scope !== this.scopeKey() ||
      this.destroyed
    )
      return no("stale_recommendation");
    // Another provider can finish while the fallback request is pending.
    const currentDenied = this.excluded(providerId, ctx);
    eligible = eligible.filter((product) => !currentDenied.has(product.id));
    if (bundle && eligible.length !== products.length)
      return no("bundle_overlap");
    if (!eligible.length) return no("recommendations_already_present");
    if (decision.widgetType === "upsell_drawer")
      eligible = eligible.slice(
        0,
        recommendationLimit(
          decision.payload?.maxProductRecommendations ??
            ctx.config.maxProductRecommendations,
        ),
      );
    this.claims.set(providerId, new Set(eligible.map((product) => product.id)));
    if (fallback) this.counters.fallbacks++;
    return {
      decision: {
        ...decision,
        ...(fallback ? { aiProvider: "heuristic" as const } : {}),
        payload: { ...decision.payload, products: eligible },
      },
      reason: fallback ? "catalog_rule_fallback" : "catalog_verified",
    };
  }
  release(providerId: string): void {
    this.claims.delete(providerId);
  }
  invalidate(): void {
    this.revision++;
    for (const entry of this.reads.values()) entry.controller.abort();
    this.reads.clear();
    this.offers.clear();
    this.cache.clear();
  }
  destroy(): void {
    this.destroyed = true;
    this.invalidate();
    this.claims.clear();
  }
}
