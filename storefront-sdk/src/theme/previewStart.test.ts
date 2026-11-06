// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), session: vi.fn() }));
vi.mock("./loader", () => ({
  loadThemeEngine: async () => ({ runThemePreview: mocks.preview }),
}));
vi.mock("../sessionManager", () => ({ SessionManager: mocks.session }));
afterEach(() => {
  vi.unstubAllGlobals();
  history.replaceState({}, "", "/");
  window.AOVBoost = undefined;
});
describe("preview bootstrap isolation", () => {
  it("branches before shopper authentication, events, offers and normal SDK setup", async () => {
    history.replaceState(
      {},
      "",
      "/products/shampoo?aovboost_preview=synthetic-preview",
    );
    window.AOVBoost = { shop: "one.myshopify.com" };
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await import("../index");
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await vi.waitFor(() => expect(mocks.preview).toHaveBeenCalled());
    expect(mocks.session).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(window.AOVBoostSDK).toBeUndefined();
  });
});
