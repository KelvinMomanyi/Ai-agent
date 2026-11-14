import { AGENT_LIMITS as L, PROVIDER_PRIORITY } from "./constants";
import type { Debug } from "./Debug";
import type { SessionStore } from "./SessionStore";
import type { Telemetry } from "./Telemetry";
import type {
  AgentContext,
  OfferProvider,
  Signal,
  UnmountReason,
} from "./types";
type Active = {
  provider: OfferProvider;
  token: object;
  mounted: boolean;
  signal: string;
  stopViewing?: () => void;
};
const foreground = (provider: OfferProvider) =>
  ["interruptive", "contextual"].includes(provider.surfaceClass);
const priority = (id: string) => {
  const index = PROVIDER_PRIORITY.indexOf(id);
  return index < 0 ? PROVIDER_PRIORITY.length : index;
};

export class Arbiter {
  private providers = new Map<string, OfferProvider>();
  private active = new Map<string, Active>();
  private evaluating = false;
  private destroyed = false;
  private reasons = new Map<string, string>();
  constructor(
    private context: () => AgentContext,
    private store: SessionStore,
    private telemetry: Telemetry,
    private debug: Debug,
  ) {}
  register(provider: OfferProvider): void {
    if (this.providers.has(provider.id))
      throw new Error("Duplicate offer provider");
    this.providers.set(provider.id, provider);
  }
  isActive(id: string): boolean {
    return this.active.has(id);
  }
  mounted(): string[] {
    return [...this.active.keys()];
  }
  reason(id: string): string {
    return this.reasons.get(id) || "no_candidate";
  }
  evaluate(signal: Signal): void {
    if (this.destroyed || this.evaluating) return;
    this.evaluating = true;
    try {
      const ctx = this.context();
      const rows = [...this.providers.values()].map((provider) => {
        let reason = "eligible";
        let score = 0;
        const existing = this.active.get(provider.id);
        if (ctx.session.disabledProviders.includes(provider.id))
          reason = "provider_failed_session";
        else {
          try {
            const eligibility = provider.isEligible(ctx);
            reason = eligibility.ok ? "eligible" : eligibility.reason;
            score = Math.max(0, Math.min(100, provider.score(ctx)));
            if (!Number.isFinite(score))
              throw new Error("Invalid provider score");
          } catch {
            this.disable(provider);
            reason = "provider_failed_session";
          }
        }
        if (
          reason === "eligible" &&
          (ctx.session.checkoutStarted || ctx.page.type === "checkout") &&
          foreground(provider)
        )
          reason = "checkout";
        if (
          reason === "eligible" &&
          ctx.session.chatOpen &&
          provider.surfaceClass !== "conversational" &&
          (!existing || foreground(provider))
        )
          reason = "chat_open";
        if (reason === "eligible" && !existing) {
          const dismissed =
            ctx.session.dismissed[provider.dismissalKey?.(ctx) || provider.id];
          if (dismissed?.count >= L.DISMISS_BACKOFF_SESSION_COUNT)
            reason = "dismissed_session";
          else if (
            dismissed &&
            signal.ts - dismissed.lastAt < L.DISMISS_BACKOFF_FIRST_MS
          )
            reason = "dismissal_backoff";
          else if (
            provider.id === "exit_intent" &&
            ctx.session.shown[provider.id]
          )
            reason = "exit_once_per_session";
          else if (provider.surfaceClass === "interruptive") {
            if (
              ctx.session.interruptiveDismissals >=
              L.GLOBAL_SILENCE_AFTER_N_DISMISSALS
            )
              reason = "global_silence";
            else if (
              ctx.session.interruptiveCount >= L.MAX_INTERRUPTIVE_PER_SESSION
            )
              reason = "session_cap";
            else if (
              ctx.session.lastInterruptiveAt &&
              signal.ts - ctx.session.lastInterruptiveAt <
                L.MIN_GAP_BETWEEN_INTERRUPTIVE_MS
            )
              reason = "interruptive_gap";
          }
        }
        return { provider, score, reason };
      });
      const eligible = rows
        .filter((row) => row.reason === "eligible")
        .sort(
          (a, b) =>
            b.score - a.score ||
            priority(a.provider.id) - priority(b.provider.id) ||
            a.provider.id.localeCompare(b.provider.id),
        );
      const chosen: OfferProvider[] = [];
      const slots = new Set<string>();
      let hasForeground = false;
      for (const row of eligible) {
        if (foreground(row.provider) && hasForeground)
          row.reason = "foreground_occupied";
        else if (slots.has(row.provider.slot)) row.reason = "slot_occupied";
        else {
          chosen.push(row.provider);
          slots.add(row.provider.slot);
          if (foreground(row.provider)) hasForeground = true;
        }
      }
      // All losing mounts (including pending theme engines) are cancelled before
      // any winner starts. A reservation lasts until the async result settles.
      for (const [id] of this.active) {
        if (ctx.agent.holdout || !chosen.some((provider) => provider.id === id))
          this.release(id, "suppressed");
      }
      for (const row of rows) {
        this.reasons.set(
          row.provider.id,
          ctx.agent.holdout && row.reason === "eligible"
            ? "holdout"
            : row.reason,
        );
        if (row.reason !== "eligible" && row.reason !== "no_offer")
          this.telemetry.emit(
            "suppressed",
            row.provider,
            signal.name,
            row.reason,
          );
      }
      for (const provider of chosen) {
        if (ctx.agent.holdout) {
          this.telemetry.emit("would_have_shown", provider, signal.name);
          continue;
        }
        if (this.active.has(provider.id)) continue;
        const entry: Active = {
          provider,
          token: {},
          mounted: false,
          signal: signal.name,
        };
        this.active.set(provider.id, entry);
        try {
          Promise.resolve(
            provider.mount(ctx, {
              closed: () => {
                if (this.active.get(provider.id) === entry)
                  this.release(provider.id, "expired");
              },
            }),
          )
            .then((result) => {
              if (this.destroyed || this.active.get(provider.id) !== entry)
                return;
              if (
                result.status !== "mounted" &&
                result.status !== "unchanged"
              ) {
                this.telemetry.emit(
                  "suppressed",
                  provider,
                  signal.name,
                  result.reason,
                );
                this.release(provider.id, "suppressed");
                this.evaluate({
                  name: "offer_ready",
                  data: {},
                  ts: Date.now(),
                });
                return;
              }
              entry.mounted = true;
              this.store.update((session) => {
                session.shown[provider.id] =
                  (session.shown[provider.id] || 0) + 1;
                if (provider.surfaceClass === "interruptive") {
                  session.interruptiveCount++;
                  session.lastInterruptiveAt = Date.now();
                }
              });
              this.telemetry.emit("impression", provider, entry.signal);
              entry.stopViewing = this.telemetry.observe(
                provider,
                entry.signal,
              );
            })
            .catch(() => {
              if (this.destroyed || this.active.get(provider.id) !== entry)
                return;
              this.disable(provider);
              this.release(provider.id, "suppressed");
              this.evaluate({ name: "offer_ready", data: {}, ts: Date.now() });
            });
        } catch {
          this.disable(provider);
          this.release(provider.id, "suppressed");
          queueMicrotask(() =>
            this.evaluate({ name: "offer_ready", data: {}, ts: Date.now() }),
          );
        }
      }
      this.debug.decision({
        signal: signal.name,
        ts: signal.ts,
        candidates: rows.map(({ provider, score, reason }) => ({
          id: provider.id,
          score,
          reason:
            ctx.agent.holdout && reason === "eligible" ? "holdout" : reason,
        })),
        accepted: ctx.agent.holdout
          ? []
          : chosen.map((provider) => provider.id),
      });
    } finally {
      this.evaluating = false;
    }
  }
  dismiss(id: string): void {
    const provider = this.providers.get(id);
    if (!provider || !this.active.has(id)) return;
    const dismissalKey = provider.dismissalKey?.(this.context()) || id;
    this.store.update((session) => {
      const count = session.dismissed[dismissalKey]?.count || 0;
      session.dismissed[dismissalKey] = {
        count: count + 1,
        lastAt: Date.now(),
      };
      if (provider.surfaceClass === "interruptive")
        session.interruptiveDismissals++;
    });
    this.telemetry.emit("dismissed", provider, "offer_dismissed");
    this.release(id, "dismissed");
  }
  release(id: string, reason: UnmountReason): void {
    const entry = this.active.get(id);
    if (!entry) return;
    this.active.delete(id);
    entry.stopViewing?.();
    try {
      entry.provider.consume?.();
      entry.provider.unmount(reason);
    } catch {
      this.disable(entry.provider);
    }
  }
  navigation(): void {
    for (const [id, entry] of this.active)
      if (entry.provider.surfaceClass !== "conversational")
        this.release(id, "navigation");
    for (const provider of this.providers.values())
      if (!this.active.has(provider.id)) provider.consume?.();
  }
  private disable(provider: OfferProvider): void {
    this.store.update((state) => {
      if (!state.disabledProviders.includes(provider.id))
        state.disabledProviders.push(provider.id);
    });
    this.telemetry.emit(
      "suppressed",
      provider,
      "offer_ready",
      "provider_exception",
    );
  }
  destroy(): void {
    this.destroyed = true;
    for (const id of this.active.keys()) this.release(id, "navigation");
    this.providers.clear();
  }
}
