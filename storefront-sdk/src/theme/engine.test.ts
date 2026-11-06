// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  mounts: [] as string[],
  throws: false,
}));
vi.mock("./verification", () => ({ verifyDisplay: mocks.verify }));
vi.mock("./adapters", () => ({
  observeCartUi: async () => ({ cartUi: "no_feedback" }),
  structuralDrawer: () => null,
  selectorFor: () => undefined,
  createAdapters: () =>
    ["native_drawer", "cart_page", "floating_card"].map((id) => ({
      id,
      canHandle: () => true,
      mount: (host: HTMLElement) => {
        mocks.mounts.push(id);
        if (mocks.throws && id === "native_drawer") throw new Error("fixture");
        document.body.append(host);
      },
      verify: () => true,
      unmount: () => {},
    })),
}));
import { createThemeEngine } from "./engine";
const config = {
  themeId: "123",
  status: "learning" as const,
  strategy: "native_drawer" as const,
  genericDrawer: false,
  preference: "auto" as const,
  appearance: { accentColor: null, radius: null, font: "inherit" as const },
};
const payload = {
  mutationId: "mutation",
  offerId: "offer",
  products: [
    {
      productId: "gid://shopify/Product/2",
      product: {
        id: "gid://shopify/Product/2",
        title: "Conditioner",
        handle: "conditioner",
        price: "12.00",
      },
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.mounts = [];
  mocks.throws = false;
  history.replaceState({}, "", "/products/shampoo");
  document.body.innerHTML = "<main></main>";
  mocks.verify.mockResolvedValue({
    verified: true,
    reason: "display_verified",
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});
describe("adaptive placement ladder", () => {
  it("closes a floating card with Escape without moving focus into a modal", async () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    const engine = createThemeEngine({
      identity: { themeId: "123", themeName: "Test" },
      config: { ...config, strategy: "floating_card" },
      report: () => {},
    });
    await engine.mount(payload);
    expect(document.activeElement).toBe(button);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(engine.isMounted()).toBe(false);
    expect(document.activeElement).toBe(button);
    engine.destroy();
  });
  it("steps down after failed verification and emits one impression only after success", async () => {
    mocks.verify.mockResolvedValueOnce({ verified: false, reason: "obscured" });
    const reports = vi.fn(),
      track = vi.fn();
    document.addEventListener("aovboost:track", track);
    const engine = createThemeEngine({
      identity: { themeId: "123", themeName: "Test" },
      config,
      report: reports,
    });
    const result = await engine.mount(payload);
    expect(result).toMatchObject({ strategy: "cart_page", verified: true });
    expect(mocks.mounts).toEqual(["native_drawer", "cart_page"]);
    expect(reports).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0][0].detail).toMatchObject({
      type: "widget_impression",
      strategy: "cart_page",
      verified: true,
    });
    engine.destroy();
    document.removeEventListener("aovboost:track", track);
  });
  it("contains adapter exceptions and stops locally when every strategy fails", async () => {
    mocks.throws = true;
    mocks.verify.mockResolvedValue({ verified: false, reason: "obscured" });
    const report = vi.fn();
    const engine = createThemeEngine({
      identity: { themeId: "123", themeName: "Test" },
      config,
      report,
    });
    expect(await engine.mount(payload)).toMatchObject({
      strategy: "none",
      verified: false,
    });
    expect(report.mock.calls[0][0]).toMatchObject({
      strategy: "native_drawer",
      reason: "adapter_exception",
    });
    engine.destroy();
  });
  it("cancels a stale verification after a newer mutation or navigation teardown", async () => {
    let resolve!: (value: any) => void;
    mocks.verify.mockImplementationOnce(
      () => new Promise((r) => (resolve = r)),
    );
    const report = vi.fn();
    const engine = createThemeEngine({
      identity: { themeId: "123", themeName: "Test" },
      config,
      report,
    });
    const pending = engine.mount(payload);
    await vi.waitFor(() => expect(mocks.verify).toHaveBeenCalled());
    engine.prepare("newer");
    resolve({ verified: true, reason: "display_verified" });
    expect(await pending).toMatchObject({
      verified: false,
      reason: "cancelled",
    });
    expect(report).not.toHaveBeenCalled();
    engine.destroy();
  });
  it("honors merchant off and preview suppresses all widget telemetry", async () => {
    const report = vi.fn();
    const off = createThemeEngine({
      identity: { themeId: "123", themeName: "Test" },
      config: { ...config, preference: "off" },
      report,
    });
    expect((await off.mount(payload)).verified).toBe(false);
    expect(mocks.mounts).toEqual([]);
    off.destroy();
    const track = vi.fn();
    document.addEventListener("aovboost:track", track);
    const preview = createThemeEngine({
      identity: { themeId: "123", themeName: "Test" },
      config,
      report: () => {},
    });
    expect(
      (await preview.mount({ ...payload, previewMode: true })).verified,
    ).toBe(true);
    expect(track).not.toHaveBeenCalled();
    preview.destroy();
    document.removeEventListener("aovboost:track", track);
  });
});
