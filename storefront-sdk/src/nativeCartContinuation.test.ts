// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CartSnapshot } from "./cartState";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./cartState", async (original) => ({
  ...(await original<typeof import("./cartState")>()),
  readShopifyCart: mocks.read,
}));
import {
  NativeCartContinuation,
  NATIVE_CART_INTENT_KEY,
  NATIVE_CART_INTENT_TTL_MS,
  NATIVE_CART_BASELINE_TTL_MS,
} from "./nativeCartContinuation";
const owner = { shop: "one.myshopify.com", sessionId: "signed-shopper" };
const instances: NativeCartContinuation[] = [];
function snapshot(entries: Array<[number, number]> = []): CartSnapshot {
  const cartItems = entries.map(([id, quantity]) => ({
    key: `line:${id}`,
    productId: `gid://shopify/Product/${id}`,
    variantId: `gid://shopify/ProductVariant/${id}`,
    quantity,
    title: "Product",
    handle: "product",
  }));
  return {
    cartToken: "not-stored",
    currency: "USD",
    cartItems,
    cartProductIds: cartItems.map((item) => item.productId),
    cartVariantIds: cartItems.map((item) => item.variantId),
    cartItemCount: entries.reduce((sum, [, n]) => sum + n, 0),
    cartValue: 10,
  };
}
function page(path: string, from = "/products/shampoo") {
  history.replaceState({}, "", path);
  vi.spyOn(document, "referrer", "get").mockReturnValue(
    new URL(from, location.origin).href,
  );
}
function start(identity = owner) {
  const continuation = new NativeCartContinuation(() => identity);
  continuation.init();
  instances.push(continuation);
  return continuation;
}
function form() {
  document.body.innerHTML = `<form method="post" action="/fr/cart/add"><input name="id" value="101"><input name="quantity" value="1"><button type="submit">Add</button></form>`;
  return document.querySelector("form")!;
}
async function submit(target = form()) {
  const event = new SubmitEvent("submit", {
    bubbles: true,
    cancelable: true,
    submitter: target.querySelector("button"),
  });
  target.dispatchEvent(event);
  await Promise.resolve();
  return event;
}
async function departing(before = snapshot(), target = form()) {
  const source = start();
  source.remember(before);
  const event = await submit(target);
  window.dispatchEvent(new PageTransitionEvent("pagehide"));
  source.destroy();
  return { source, event, raw: sessionStorage.getItem(NATIVE_CART_INTENT_KEY) };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
  vi.resetAllMocks();
  sessionStorage.clear();
  page("/products/shampoo");
  window.AOVBoost = {};
});
afterEach(() => {
  instances.splice(0).forEach((instance) => instance.destroy());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("passive native cart continuation", () => {
  it("reads successful controls without invoking FormData or the theme's formdata handler", async () => {
    const target = form();
    target.insertAdjacentHTML(
      "beforeend",
      `<fieldset disabled><input name="id" value="999"></fieldset><input type="checkbox" name="properties[_aovboost_offer_id]" value="unchecked">`,
    );
    const event = vi.fn();
    target.addEventListener("formdata", event);
    vi.spyOn(window, "FormData").mockImplementation(() => {
      throw new Error("Must not invoke formdata");
    });
    const { raw } = await departing(snapshot(), target);
    expect(raw).not.toBeNull();
    expect(event).not.toHaveBeenCalled();
    page("/cart");
    expect(start().confirm(snapshot([[101, 1]]))).toMatchObject({
      confirmed: true,
    });
  });
  it("requires departure and a matching fresh delta, consumes once and never modifies/submits the form", async () => {
    const target = form(),
      html = target.outerHTML;
    const submitSpy = vi.spyOn(target, "submit");
    const { event, raw } = await departing(snapshot([[202, 2]]), target);
    expect(event.defaultPrevented).toBe(false);
    expect(target.outerHTML).toBe(html);
    expect(submitSpy).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(raw).not.toMatch(
      /sessionToken|not-stored|unitCost|inventory|margin/,
    );
    page("/fr/cart");
    const destination = start();
    expect(sessionStorage.getItem(NATIVE_CART_INTENT_KEY)).toBeNull();
    expect(
      destination.confirm(
        snapshot([
          [202, 2],
          [101, 1],
        ]),
      ),
    ).toMatchObject({
      mutationId: expect.any(String),
      confirmed: true,
      quantity: 1,
      variantId: "gid://shopify/ProductVariant/101",
      source: "verified_native_form_redirect",
    });
    expect(
      destination.confirm(
        snapshot([
          [202, 2],
          [101, 1],
        ]),
      ),
    ).toBeNull();
    expect(
      start().confirm(
        snapshot([
          [202, 2],
          [101, 1],
        ]),
      ),
    ).toBeNull();
  });
  it("discards a submit cancelled by a later theme listener", async () => {
    const target = form();
    target.addEventListener("submit", (event) => event.preventDefault(), {
      once: true,
    });
    const { raw, event } = await departing(snapshot(), target);
    expect(event.defaultPrevented).toBe(true);
    expect(raw).toBeNull();
  });
  it.each([
    ["another origin", "action", "https://other.example/cart/add"],
    ["a read", "method", "get"],
    ["another tab", "target", "_blank"],
    ["a JSON document", "action", "/cart/add.js"],
  ])("ignores %s", async (_label, attr, value) => {
    const target = form();
    target.setAttribute(attr, value);
    expect((await departing(snapshot(), target)).raw).toBeNull();
  });
  it("honors submitter overrides and excludes recommendation-origin and batch forms", async () => {
    for (const extra of [
      `<input name="properties[_aovboost_offer_id]" value="own-offer">`,
      `<input name="items[0][id]" value="101">`,
      `<input name="id" value="202">`,
    ]) {
      const target = form();
      target.insertAdjacentHTML("beforeend", extra);
      expect((await departing(snapshot(), target)).raw).toBeNull();
    }
    const target = form();
    target
      .querySelector("button")!
      .setAttribute("formaction", "https://other.example/cart/add");
    expect((await departing(snapshot(), target)).raw).toBeNull();
  });
  it("requires a recently read baseline and ignores an unarmed intent", async () => {
    const source = start();
    await submit();
    expect(sessionStorage.getItem(NATIVE_CART_INTENT_KEY)).toBeNull();
    source.remember(snapshot());
    vi.advanceTimersByTime(NATIVE_CART_BASELINE_TTL_MS + 1);
    await submit();
    expect(sessionStorage.getItem(NATIVE_CART_INTENT_KEY)).toBeNull();
    source.remember(snapshot());
    await submit();
    source.destroy();
    page("/cart");
    expect(start().confirm(snapshot([[101, 1]]))).toBeNull();
  });
  it.each([
    ["unchanged", [[202, 2]]],
    ["empty", []],
    [
      "wrong variant",
      [
        [202, 2],
        [303, 1],
      ],
    ],
    [
      "partial quantity",
      [
        [202, 2],
        [101, 2],
      ],
    ],
    [
      "another changed line",
      [
        [202, 1],
        [101, 2],
      ],
    ],
  ] as Array<[string, Array<[number, number]>]>)(
    "does not confirm an %s cart",
    async (_label, entries) => {
      await departing(snapshot([[202, 2]]));
      page("/cart");
      expect(start().confirm(snapshot(entries))).toBeNull();
    },
  );
  it.each([
    "expired",
    "wrong session",
    "wrong shop",
    "missing referrer",
    "wrong referrer",
    "wrong page",
    "new currency",
  ])("rejects %s continuation", async (reason) => {
    await departing();
    page(
      reason === "wrong page" ? "/collections/all" : "/cart",
      reason === "wrong referrer"
        ? "https://other.example/products/shampoo"
        : "/products/shampoo",
    );
    if (reason === "expired")
      vi.advanceTimersByTime(NATIVE_CART_INTENT_TTL_MS + 1);
    if (reason === "missing referrer")
      vi.spyOn(document, "referrer", "get").mockReturnValue("");
    const destination = start({
      ...owner,
      ...(reason === "wrong session" ? { sessionId: "other" } : {}),
      ...(reason === "wrong shop" ? { shop: "other.myshopify.com" } : {}),
    });
    const after = snapshot([[101, 1]]);
    if (reason === "new currency") after.currency = "EUR";
    expect(destination.confirm(after)).toBeNull();
  });
  it("clears a pending native intent after an observed Ajax mutation or BFCache restoration", async () => {
    const source = start();
    source.remember(snapshot());
    await submit();
    source.cancel();
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    expect(sessionStorage.getItem(NATIVE_CART_INTENT_KEY)).toBeNull();
    source.remember(snapshot());
    await submit();
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    expect(sessionStorage.getItem(NATIVE_CART_INTENT_KEY)).not.toBeNull();
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
    expect(sessionStorage.getItem(NATIVE_CART_INTENT_KEY)).toBeNull();
  });
  it("refreshes on passive form interest without delaying submit or duplicating concurrent reads", async () => {
    const source = start(),
      target = form();
    let resolve!: (cart: CartSnapshot) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    target
      .querySelector("input")!
      .dispatchEvent(new Event("focusin", { bubbles: true }));
    target
      .querySelector("input")!
      .dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect((await submit(target)).defaultPrevented).toBe(false);
    expect(sessionStorage.getItem(NATIVE_CART_INTENT_KEY)).toBeNull();
    resolve(snapshot());
    await Promise.resolve();
    // The in-flight pre-submit read is obsolete; only a later fresh read may arm a new add.
    vi.advanceTimersByTime(6000);
    mocks.read.mockResolvedValue(snapshot());
    await Promise.resolve();
    target
      .querySelector("input")!
      .dispatchEvent(new Event("focusin", { bubbles: true }));
    await Promise.resolve();
    await submit(target);
    expect(sessionStorage.getItem(NATIVE_CART_INTENT_KEY)).not.toBeNull();
    source.destroy();
  });
  it("fails closed under malformed storage, storage denial and revoked consent", async () => {
    sessionStorage.setItem(
      NATIVE_CART_INTENT_KEY,
      JSON.stringify({ before: { quantities: "invalid" } }),
    );
    expect(start().confirm(snapshot([[101, 1]]))).toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect((await departing()).event.defaultPrevented).toBe(false);
    vi.restoreAllMocks();
    await departing();
    page("/cart");
    const destination = start();
    window.AOVBoost = { settings: { trackingConsentRequired: true } } as any;
    expect(destination.confirm(snapshot([[101, 1]]))).toBeNull();
  });
});
