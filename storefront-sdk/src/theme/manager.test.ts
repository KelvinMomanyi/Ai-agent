// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  prepare: vi.fn(),
  mount: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("./loader", () => ({ loadThemeEngine: mocks.load }));
import { WidgetManager } from "../widgets/widgetManager";
import { defaultThemeConfig } from "../../../shared/themeCompatibility";
let manager: WidgetManager;
beforeEach(() => {
  vi.resetAllMocks();
  history.replaceState({}, "", "/products/shampoo");
  document.body.innerHTML = "<main></main>";
  mocks.mount.mockResolvedValue({
    verified: true,
    strategy: "floating_card",
    reason: "display_verified",
  });
  mocks.load.mockResolvedValue({
    createThemeEngine: () => ({
      prepare: mocks.prepare,
      mount: mocks.mount,
      destroy: mocks.destroy,
      isMounted: () => true,
    }),
  });
  manager = new WidgetManager({
    themeCompatibility: defaultThemeConfig("123"),
  });
});
afterEach(() => {
  manager.destroy();
  document.body.innerHTML = "";
});
const decision = {
  widgetType: "upsell_drawer",
  payload: {
    offerId: "offer",
    triggerType: "cart_item_added",
    mutationId: "mutation",
    products: [],
  },
};
describe("lazy cart engine integration", () => {
  it("does no loading or layout work on startup, restored carts or recommendation-origin adds", () => {
    for (const detail of [
      { type: "cart_restored" },
      { type: "add_to_cart", confirmed: true, recommendationOrigin: true },
    ])
      document.dispatchEvent(new CustomEvent("aovboost:event", { detail }));
    expect(mocks.load).not.toHaveBeenCalled();
    expect(manager.mountDecision({ ...decision, payload: {} }).status).toBe(
      "suppressed",
    );
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("loads on a confirmed add and mounts the resulting offer through the adaptive engine", async () => {
    document.dispatchEvent(
      new CustomEvent("aovboost:event", {
        detail: {
          type: "add_to_cart",
          confirmed: true,
          mutationId: "mutation",
        },
      }),
    );
    await vi.waitFor(() =>
      expect(mocks.prepare).toHaveBeenCalledWith("mutation"),
    );
    expect(manager.mountDecision(decision).status).toBe("pending");
    await vi.waitFor(() => expect(mocks.mount).toHaveBeenCalled());
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(manager.mountDecision(decision).status).toBe("unchanged");
  });
  it("discards an asynchronously loaded surface after navigation or a newer cart", async () => {
    let resolve!: (value: any) => void;
    mocks.load.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    manager.mountDecision(decision);
    manager.clearCartRecommendation();
    history.replaceState({}, "", "/cart");
    resolve({
      createThemeEngine: () => ({
        prepare: mocks.prepare,
        mount: mocks.mount,
        destroy: mocks.destroy,
        isMounted: () => false,
      }),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.mount).not.toHaveBeenCalled();
  });
});
