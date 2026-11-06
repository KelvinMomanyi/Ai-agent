// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { classifyCartUi, createAdapters, observeCartUi } from "./adapters";
import { contrast, adaptAppearance } from "./appearance";
import { displayCheck, verifyDisplay } from "./verification";
import type { ThemeRuntimeConfig } from "../../../shared/themeCompatibility";
const config: ThemeRuntimeConfig = {
  themeId: "123",
  status: "learning",
  strategy: "native_drawer",
  genericDrawer: false,
  preference: "auto",
  appearance: { accentColor: null, radius: null, font: "inherit" },
};
const context = {
  identity: { themeId: "123", themeName: "Dawn", schemaName: "Dawn" },
  config,
};
const fixture = (name: string) => {
  document.body.innerHTML = readFileSync(
    resolve(process.cwd(), `storefront-sdk/test/fixtures/themes/${name}.html`),
    "utf8",
  );
};
beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState({}, "", "/products/shampoo");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({
      x: 20,
      y: 20,
      top: 20,
      left: 20,
      bottom: 220,
      right: 320,
      width: 300,
      height: 200,
      toJSON: () => ({}),
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});
describe("theme classification and typed placement adapters", () => {
  it("classifies Dawn drawers, notifications, redirects and no-feedback", () => {
    fixture("dawn-drawer");
    expect(classifyCartUi().cartUi).toBe("drawer");
    fixture("dawn-popup");
    expect(classifyCartUi().cartUi).toBe("popup_notification");
    fixture("product-page");
    expect(classifyCartUi().cartUi).toBe("no_feedback");
    history.replaceState({}, "", "/cart");
    fixture("cart-page");
    expect(classifyCartUi("/products/shampoo").cartUi).toBe("page_redirect");
  });
  it("observes only for the bounded window and sees theme DOM updates", async () => {
    fixture("product-page");
    const controller = new AbortController();
    const result = observeCartUi(controller.signal);
    fixture("dawn-drawer");
    await vi.advanceTimersByTimeAsync(1200);
    expect((await result).cartUi).toBe("drawer");
  });
  it("mounts in a matched visible Dawn drawer without modifying its form", () => {
    fixture("dawn-drawer");
    const [adapter] = createAdapters();
    const host = document.createElement("div");
    const form = document.querySelector("form#CartDrawer-Form")!.outerHTML;
    expect(adapter.canHandle(context)).toBe(true);
    adapter.mount(host, context);
    expect(host.closest(".drawer__inner")).not.toBeNull();
    expect(host.closest("form")).toBeNull();
    expect(adapter.verify()).toBe(true);
    expect(document.querySelector("form#CartDrawer-Form")!.outerHTML).toBe(
      form,
    );
    adapter.unmount();
    expect(host.isConnected).toBe(false);
  });
  it("keeps the generic structural drawer locked until the selector quorum is enabled", () => {
    fixture("custom-drawer");
    const [adapter] = createAdapters();
    const generic = {
      identity: { themeId: "123", themeName: "Custom" },
      config,
    };
    expect(adapter.canHandle(generic)).toBe(false);
    const learned = {
      ...generic,
      config: {
        ...config,
        status: "verified" as const,
        genericDrawer: true,
        drawerSelector: "#MiniCart",
      },
    };
    expect(adapter.canHandle(learned)).toBe(true);
    const host = document.createElement("div");
    adapter.mount(host, learned);
    expect(host.closest("mini-cart")).not.toBeNull();
    expect(host.closest("form")).toBeNull();
  });
  it("rejects a competing dialog and keeps floating cards off protected pages", () => {
    fixture("dawn-drawer");
    document.body.insertAdjacentHTML(
      "beforeend",
      "<dialog open>Other dialog</dialog>",
    );
    const adapters = createAdapters();
    expect(adapters[0].canHandle(context)).toBe(false);
    expect(adapters[2].canHandle(context)).toBe(false);
    document.body.innerHTML = "<main></main>";
    history.replaceState({}, "", "/checkout");
    expect(adapters[2].canHandle(context)).toBe(false);
  });
  it("mounts inline after cart items and a non-modal floating card as the final safe option", () => {
    fixture("cart-page");
    history.replaceState({}, "", "/cart");
    const adapters = createAdapters();
    const host = document.createElement("div");
    expect(adapters[1].canHandle(context)).toBe(true);
    adapters[1].mount(host, context);
    expect(host.closest("main")).not.toBeNull();
    adapters[1].unmount();
    history.replaceState({}, "", "/products/shampoo");
    adapters[2].mount(host, context);
    expect(host.parentElement).toBe(document.body);
    expect(host.getAttribute("aria-modal")).toBeNull();
    adapters[2].unmount();
  });
});
describe("verified display and visual adaptation", () => {
  it("requires viewport area, hit testing and a continuous dwell interval", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => host,
    });
    expect(displayCheck(host).verified).toBe(true);
    const result = verifyDisplay(host, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(700);
    let done = false;
    result.then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect((await result).verified).toBe(true);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => document.body,
    });
    expect(displayCheck(host)).toMatchObject({
      verified: false,
      reason: "obscured",
    });
  });
  it("fails closed when clipped or layout shifts beyond the named limit", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue({
      top: 1000,
      left: 0,
      right: 300,
      bottom: 1200,
      width: 300,
      height: 200,
    } as DOMRect);
    expect(displayCheck(host).verified).toBe(false);
    let top = 0;
    vi.mocked(host.getBoundingClientRect).mockImplementation(
      () =>
        ({
          top: (top += 200),
          left: 0,
          right: 300,
          bottom: top + 200,
          width: 300,
          height: 200,
        }) as DOMRect,
    );
    const result = await verifyDisplay(host, new AbortController().signal);
    expect(result.reason).toBe("layout_shift");
  });
  it("falls back to contrast-safe colors and applies merchant font/radius and RTL", () => {
    document.body.style.cssText =
      "color:rgb(240,240,240);background:rgb(255,255,255);direction:rtl;font-family:serif";
    const host = document.createElement("div");
    adaptAppearance(host, {
      accentColor: "#eeeeee",
      radius: 12,
      font: "system",
    });
    expect(
      contrast(
        host.style.getPropertyValue("--aovboost-ink"),
        host.style.getPropertyValue("--aovboost-surface"),
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(host.style.direction).toBe("rtl");
    expect(host.style.getPropertyValue("--aovboost-radius")).toBe("12px");
    expect(host.style.getPropertyValue("--aovboost-font")).toContain(
      "system-ui",
    );
  });
});
