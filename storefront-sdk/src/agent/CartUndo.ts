import type { WidgetDependencies } from "./experienceTypes";
import { AGENT_LIMITS as L } from "./constants";

type Line = {
  key: string;
  id: number;
  quantity: number;
  properties?: Record<string, unknown>;
  selling_plan?: number;
};
type Snapshot = { currency: string; items: Line[] };
const signature = (line: Line) =>
  JSON.stringify([
    line.id,
    Object.entries(line.properties || {}).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
    line.selling_plan || null,
  ]);
const fingerprint = (cart: Snapshot) =>
  JSON.stringify([
    cart.currency,
    cart.items
      .map((line) => [signature(line), line.quantity])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
// Exact line data lives in memory only. Never persist or log properties, notes or tokens.
export class CartUndo {
  private revision = 0;
  private listeners = new AbortController();
  private entry?: {
    before: Snapshot;
    after: Snapshot;
    line: Line;
    old?: Line;
    revision: number;
  };
  private busy = false;
  get variantId(): number | undefined {
    return this.entry?.line.id;
  }
  constructor(
    private deps: WidgetDependencies,
    private changed: (available: boolean) => void,
  ) {
    document.addEventListener(
      "aovboost:event",
      (event) => {
        const detail = (event as CustomEvent).detail;
        if (
          detail?.confirmed === true &&
          ["add_to_cart", "remove_from_cart", "quantity_changed"].includes(
            detail.type,
          )
        ) {
          this.revision++;
          this.changed(false);
        }
      },
      { signal: this.listeners.signal },
    );
  }
  private async read(): Promise<Snapshot | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      L.CART_ACTION_SNAPSHOT_TIMEOUT_MS,
    );
    try {
      const response = await fetch(this.deps.cartUrl("read"), {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return;
      const cart = await response.json();
      if (!Array.isArray(cart.items) || !cart.currency) return;
      return {
        currency: cart.currency,
        items: cart.items.map((line: any) => ({
          key: String(line.key),
          id: Number(line.variant_id || line.id),
          quantity: Number(line.quantity),
          ...(line.properties ? { properties: line.properties } : {}),
          ...(line.selling_plan_allocation?.selling_plan?.id
            ? {
                selling_plan: Number(
                  line.selling_plan_allocation.selling_plan.id,
                ),
              }
            : {}),
        })),
      };
    } catch {
      return;
    } finally {
      clearTimeout(timer);
    }
  }
  async perform<T>(operation: () => Promise<T>): Promise<T> {
    this.entry = undefined;
    this.changed(false);
    const before = await this.read(),
      revision = this.revision;
    const result = await operation();
    const after = await this.read();
    if (
      !result ||
      !before ||
      !after ||
      before.currency !== after.currency ||
      this.revision !== revision + 1
    )
      return result;
    const keys = new Set([...before.items, ...after.items].map(signature));
    const changes = [...keys]
      .map((key) => ({
        old: before.items.find((line) => signature(line) === key),
        next: after.items.find((line) => signature(line) === key),
      }))
      .filter(({ old, next }) => old?.quantity !== next?.quantity);
    // Ambiguous duplicate custom lines or concurrent edits get no undo affordance.
    if (
      changes.length === 1 &&
      keys.size === Math.max(before.items.length, after.items.length)
    ) {
      const { old, next } = changes[0];
      this.entry = {
        before,
        after,
        line: (next || old)!,
        old,
        revision: this.revision,
      };
      this.changed(true);
    }
    return result;
  }
  async undo(): Promise<"ok" | "changed" | "failed"> {
    if (this.busy || !this.entry) return "changed";
    this.busy = true;
    const entry = this.entry;
    this.entry = undefined;
    this.changed(false);
    try {
      const fresh = await this.read();
      if (
        !fresh ||
        this.revision !== entry.revision ||
        fingerprint(fresh) !== fingerprint(entry.after)
      )
        return "changed";
      const current = fresh.items.find(
        (line) => signature(line) === signature(entry.line),
      );
      const result = current
        ? await this.deps.mutateShopifyCart(
            "change",
            { id: current.key, quantity: entry.old?.quantity || 0 },
            "aov_chat",
            { undo: true },
          )
        : entry.old
          ? await this.deps.mutateShopifyCart(
              "add",
              {
                items: [
                  {
                    id: entry.old.id,
                    quantity: entry.old.quantity,
                    ...(entry.old.properties
                      ? { properties: entry.old.properties }
                      : {}),
                    ...(entry.old.selling_plan
                      ? { selling_plan: entry.old.selling_plan }
                      : {}),
                  },
                ],
              },
              "aov_chat",
              { undo: true },
            )
          : null;
      const restored = await this.read();
      return result &&
        restored &&
        fingerprint(restored) === fingerprint(entry.before)
        ? "ok"
        : "failed";
    } catch {
      return "failed";
    } finally {
      this.busy = false;
    }
  }
  destroy() {
    this.listeners.abort();
    this.entry = undefined;
  }
}
