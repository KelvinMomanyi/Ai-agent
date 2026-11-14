import { AGENT_LIMITS as L } from "./constants";
import { WIDGET_PROVIDERS } from "./providers";
import { CART_SOURCES } from "./flag";
import type { AgentContext, OfferProvider } from "./types";

const EVENTS = [
  "impression",
  "viewed",
  "interaction",
  "accepted",
  "dismissed",
  "suppressed",
  "would_have_shown",
] as const;
type EventName = (typeof EVENTS)[number];
const opaque = (value: unknown) =>
  typeof value === "string" && /^[a-zA-Z0-9_:-]{1,128}$/.test(value)
    ? value
    : "";
const label = (value: unknown, fallback = "") =>
  typeof value === "string" && /^[a-z_]{1,64}$/.test(value) ? value : fallback;
const DEFINITIONS = new Map(
  Object.values(WIDGET_PROVIDERS).map((provider) => [provider.id, provider]),
);
export class Telemetry {
  private opportunities = new Set<string>();
  private offers = new Map<string, string>();
  constructor(
    private send: (type: string, payload: Record<string, unknown>) => void,
    private context: () => AgentContext,
  ) {}
  // Applied before EventBus records/buffers new standard events. Old public
  // events without the provider schema retain their compatibility path.
  project(event: Record<string, unknown>): Record<string, unknown> | null {
    if (
      !EVENTS.includes(event.type as EventName) ||
      event.provider_id === undefined
    )
      return event;
    const id = String(event.provider_id || ""),
      provider = DEFINITIONS.get(id);
    if (!provider) return null;
    const ctx = this.context(),
      assignment = ctx.agent.assignment;
    const offer = opaque(event.offer_id || event.offerId),
      mutation = opaque(event.mutation_id);
    return {
      type: event.type,
      ts:
        typeof event.ts === "number" && Number.isFinite(event.ts)
          ? event.ts
          : Date.now(),
      ...(typeof event.shop === "string" ? { shop: event.shop } : {}),
      ...(typeof event.sessionId === "string"
        ? { sessionId: event.sessionId }
        : {}),
      url: "",
      referrer: "",
      provider_id: id,
      surface_class: provider.surfaceClass,
      trigger_signal: label(event.trigger_signal, "offer_ready"),
      page_type: ctx.page.type,
      session_id: ctx.session.id,
      holdout: ctx.agent.holdout,
      ai_healthy: ctx.agent.aiHealthy,
      holdout_source: assignment?.source || "agent",
      holdout_version: assignment?.version || 1,
      holdout_percent: assignment?.percent || 0,
      ...(offer ? { offer_id: offer, offerId: offer } : {}),
      ...(mutation ? { mutation_id: mutation } : {}),
      ...(CART_SOURCES.includes(event.cart_source as any)
        ? { cart_source: event.cart_source }
        : {}),
      ...(label(event.reason) ? { reason: label(event.reason) } : {}),
    };
  }
  emit(
    type: EventName,
    provider: Pick<OfferProvider, "id" | "surfaceClass" | "attribution">,
    signal: string,
    reason?: string,
    fields: Record<string, unknown> = {},
  ): void {
    try {
      const ctx = this.context(),
        attribution = provider.attribution?.();
      const offer = opaque(fields.offer_id || attribution?.offer_id);
      const trigger =
        (offer && this.offers.get(`${provider.id}:${offer}`)) ||
        label(attribution?.trigger_signal, signal);
      if (type === "would_have_shown") {
        const key = `${provider.id}:${offer || trigger}:${ctx.session.pageViews}`;
        if (this.opportunities.has(key)) return;
        this.opportunities.add(key);
        if (this.opportunities.size > L.TELEMETRY_ENTRIES)
          this.opportunities.delete(this.opportunities.values().next().value!);
      }
      if (type === "impression" && offer) {
        this.offers.set(`${provider.id}:${offer}`, trigger);
        if (this.offers.size > L.TELEMETRY_ENTRIES)
          this.offers.delete(this.offers.keys().next().value!);
      }
      const event = this.project({
        ...fields,
        type,
        provider_id: provider.id,
        trigger_signal: trigger,
        offer_id: offer,
        reason,
        ts: Date.now(),
      });
      if (event) this.send(type, event);
    } catch {
      /* Tracking must not block storefront interaction. */
    }
  }
  observe(provider: OfferProvider, signal: string): () => void {
    const element = provider.element?.();
    if (!element || typeof IntersectionObserver === "undefined")
      return () => {};
    let timer: ReturnType<typeof setTimeout> | undefined,
      visible = false,
      stopped = false;
    const visibility = () => check();
    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
    const check = () => {
      if (stopped) return;
      if (!visible || document.visibilityState === "hidden") {
        clearTimeout(timer);
        timer = undefined;
        return;
      }
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        if (
          element.isConnected &&
          visible &&
          document.visibilityState !== "hidden"
        )
          this.emit("viewed", provider, signal);
        stop();
      }, L.VIEWED_MS);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (stopped) return;
        visible = entries.some(
          (entry) =>
            entry.isIntersecting && entry.intersectionRatio >= L.VIEWED_RATIO,
        );
        check();
      },
      { threshold: L.VIEWED_RATIO },
    );
    document.addEventListener("visibilitychange", visibility);
    observer.observe(element);
    return stop;
  }
}
