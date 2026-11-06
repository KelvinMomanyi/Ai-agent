import {
  type ThemeRuntimeConfig,
  type ThemeIdentity,
  type ThemeDisplayReport,
  type ThemeStrategy,
  type CartUi,
  CART_SURFACE_WAIT_MS,
} from "../../../shared/themeCompatibility";
import { UpsellDrawer } from "../widgets/UpsellDrawer";
import type { WidgetPayload } from "../widgets/BaseWidget";
import {
  createAdapters,
  observeCartUi,
  structuralDrawer,
  selectorFor,
  type CartObservation,
  type PlacementAdapter,
} from "./adapters";
import { verifyDisplay } from "./verification";
import { adaptAppearance } from "./appearance";
import { getStorefrontPage } from "../widgets/placement";
import { newMutationId } from "../cartState";
export { runThemePreview } from "./preview";
export type ThemeEngineOptions = {
  config: ThemeRuntimeConfig;
  identity: ThemeIdentity;
  report: (report: ThemeDisplayReport) => void | Promise<void>;
};
export function createThemeEngine(options: ThemeEngineOptions) {
  let lifecycle = new AbortController(),
    widget: UpsellDrawer | undefined,
    currentAdapter: PlacementAdapter | undefined,
    observer: MutationObserver | undefined,
    observation: Promise<CartObservation> | undefined,
    mutation = "",
    recoveries = 0;
  const adapters = createAdapters();
  const failedAdapters = new Set<ThemeStrategy>(),
    shownOffers = new Set<string>();
  let recovering = false,
    localDisabled = false;
  const stop = () => {
    lifecycle.abort();
    observer?.disconnect();
    widget?.destroy();
    currentAdapter?.unmount();
    widget = undefined;
    currentAdapter = undefined;
    observation = undefined;
  };
  const prepare = (id: string) => {
    if (localDisabled) return;
    if (mutation === id && observation) return;
    stop();
    lifecycle = new AbortController();
    mutation = id;
    recoveries = 0;
    observation = observeCartUi(lifecycle.signal);
  };
  const mount = async (
    payload: WidgetPayload,
  ): Promise<{
    strategy: ThemeStrategy;
    verified: boolean;
    reason: string;
    cartUi?: CartUi;
  }> => {
    if (localDisabled)
      return {
        strategy: "none",
        verified: false,
        reason: "local_circuit_open",
      };
    if (
      !["home", "product", "collection", "cart"].includes(getStorefrontPage())
    )
      return { strategy: "none", verified: false, reason: "protected_page" };
    prepare(String(payload.mutationId || "preview"));
    const signal = lifecycle.signal;
    const observationResult = await observation!;
    const observed =
      payload.cartUiHint === "page_redirect" && getStorefrontPage() === "cart"
        ? { ...observationResult, cartUi: "page_redirect" as const }
        : observationResult;
    const context = { config: options.config, identity: options.identity };
    const initial =
      options.config.preference === "off" ||
      options.config.status === "disabled"
        ? "none"
        : options.config.strategy;
    const start = adapters.findIndex((a) => a.id === initial);
    if (start < 0 || signal.aborted)
      return {
        strategy: "none",
        verified: false,
        reason: "placement_disabled",
      };
    const attemptId = newMutationId();
    const candidate = structuralDrawer();
    const selector = candidate ? selectorFor(candidate) : observed.selector;
    const report = (
      strategy: ThemeStrategy,
      verified: boolean,
      reason: string,
    ) => {
      if (signal.aborted) return;
      Promise.resolve(
        options.report({
          identity: options.identity,
          attemptId: `${attemptId}-${strategy}`,
          offerId: String(payload.offerId || ""),
          strategy,
          verified,
          reason,
          cartUi: observed.cartUi,
          ...(selector ? { selector } : {}),
        }),
      ).catch(() => {});
    };
    for (const adapter of adapters.slice(start)) {
      if (failedAdapters.has(adapter.id)) continue;
      if (signal.aborted)
        return { strategy: "none", verified: false, reason: "cancelled" };
      if (
        options.config.preference === "cart_page" &&
        adapter.id !== "cart_page"
      )
        continue;
      try {
        // A floating card waits for the theme's notification/drawer instead of covering it.
        if (adapter.id === "floating_card" && !adapter.canHandle(context)) {
          await new Promise<void>((resolve) => {
            const observer = new MutationObserver(() => {
              try {
                if (adapter.canHandle(context)) finish();
              } catch {
                finish();
              }
            });
            const finish = () => {
              clearTimeout(timer);
              observer.disconnect();
              signal.removeEventListener("abort", finish);
              resolve();
            };
            const timer = setTimeout(finish, CART_SURFACE_WAIT_MS);
            observer.observe(document.body, {
              subtree: true,
              childList: true,
              attributes: true,
              attributeFilter: [
                "class",
                "open",
                "hidden",
                "aria-hidden",
                "style",
              ],
            });
            signal.addEventListener("abort", finish, { once: true });
            if (signal.aborted) finish();
          });
        }
        if (!adapter.canHandle(context)) {
          report(adapter.id, false, "adapter_unavailable");
          continue;
        }
        widget = new UpsellDrawer({
          ...payload,
          presentation: "inline",
          cartDrawer: adapter.id === "native_drawer",
          verifiedDisplayManaged: true,
        });
        const host = widget.getElement();
        host.style.cssText =
          "display:block;max-height:45dvh;overflow:auto;min-width:0;";
        adapter.mount(host, context);
        currentAdapter = adapter;
        widget.mount(host.parentElement!);
        adaptAppearance(host, options.config.appearance);
        host.shadowRoot
          ?.querySelector("style")
          ?.append(
            document.createTextNode(
              `\n:host{font-family:var(--aovboost-font,system-ui)!important} .primary{border-radius:var(--aovboost-radius,8px)} a{color:var(--aovboost-link)} @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}`,
            ),
          );
        const guard = () => {
          try {
            const hidden = !adapter.verify();
            if (host.hidden !== hidden) host.hidden = hidden;
          } catch {
            if (recovering) return;
            recovering = true;
            failedAdapters.add(adapter.id);
            report(adapter.id, false, "adapter_exception");
            stop();
            void mount(payload).finally(() => {
              recovering = false;
            });
          }
        };
        observer = new MutationObserver(() => {
          if (signal.aborted || widget?.isDestroyed()) {
            if (widget?.isDestroyed()) lifecycle.abort();
            observer?.disconnect();
            return;
          }
          if (!host.isConnected && recoveries++ < 3) {
            try {
              if (adapter.canHandle(context)) {
                adapter.mount(host, context);
                widget?.reattach(host.parentElement!);
                adaptAppearance(host, options.config.appearance);
              }
            } catch {
              host.remove();
            }
          }
          if (host.isConnected) guard();
        });
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["class", "open", "hidden", "aria-hidden", "style"],
        });
        document.addEventListener(
          "keydown",
          (event) => {
            if (
              event.key === "Escape" &&
              adapter.id === "floating_card" &&
              !event.defaultPrevented &&
              !host.hidden &&
              adapter.verify()
            ) {
              event.preventDefault();
              widget?.dismissFromKeyboard();
            }
          },
          { signal },
        );
        const result = await verifyDisplay(host, signal);
        if (signal.aborted)
          return { strategy: "none", verified: false, reason: "cancelled" };
        if (result.verified && adapter.verify()) {
          const key = String(
            payload.offerId || payload.mutationId || "preview",
          );
          if (!shownOffers.has(key)) {
            widget.recordVerifiedImpression(adapter.id);
            shownOffers.add(key);
          }
          report(adapter.id, true, result.reason);
          return { strategy: adapter.id, ...result, cartUi: observed.cartUi };
        }
        report(adapter.id, false, result.reason);
        observer.disconnect();
        widget.destroy();
        adapter.unmount();
      } catch {
        failedAdapters.add(adapter.id);
        observer?.disconnect();
        widget?.destroy();
        adapter.unmount();
        report(adapter.id, false, "adapter_exception");
      }
    }
    localDisabled = true;
    return {
      strategy: "none",
      verified: false,
      reason: "all_strategies_failed",
      cartUi: observed.cartUi,
    };
  };
  return {
    prepare,
    mount,
    destroy: stop,
    isMounted: () =>
      Boolean(widget?.isMounted() && !widget.getElement().hidden),
  };
}
