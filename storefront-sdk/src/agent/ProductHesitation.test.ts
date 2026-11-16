// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductHesitation, productDom } from "./ProductHesitation";
import { AGENT_LIMITS as L } from "./constants";
let sensor: ProductHesitation,
  fire: ReturnType<typeof vi.fn>,
  visible: boolean,
  allowed: boolean;
const primary =
  '<h1>Amazing Aluminum Bag Collection1</h1><div class="price__current" id="pdp-price">KSh499.44</div><form action="/cart/add"><input name="id" value="101"></form>';
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T00:00:00Z"));
  document.body.innerHTML = `<main><product-recommendations><div class="price">KSh1.00</div><form action="/cart/add"><input name="id" value="999"></form></product-recommendations><section>${primary}</section></main>`;
  visible = allowed = true;
  fire = vi.fn();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const shown = this.id !== "pdp-price" || visible;
      return {
        height: shown ? 20 : 0,
        width: 80,
        top: 10,
        bottom: shown ? 30 : 10,
        left: 0,
        right: 80,
        x: 0,
        y: 10,
        toJSON: () => ({}),
      };
    },
  );
  sensor = new ProductHesitation(() => allowed, fire);
});
afterEach(() => {
  sensor.destroy();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});
describe("primary PDP context and visible-price hesitation", () => {
  it("uses Velour's product-info and external quantity control, ignoring unrelated quick-add forms", () => {
    document.body.innerHTML = `<main><div class="product-info"><h1>Amazing Aluminum Bag Collection1</h1>
      <div class="product-block--price"><div id="product-price"><span class="product-price--sale">KSh499.44</span></div></div>
      <input form="product-form-main" name="quantity" value="1">
      <product-form><form id="product-form-main" method="post" action="/cart/add" enctype="multipart/form-data"><input name="id" value="101"><button name="add">Add to cart</button></form></product-form>
      <form id="shop-pay-installments-1" action="/cart/add"><input name="id" value="101"></form>
      </div><a class="card-banner"><form action="/cart/add"><input name="id" value="202"></form><data class="price">KSh1</data></a></main>`;
    expect(productDom().variantId).toBe("101");
    expect(productDom().prices.every((p) => p.closest(".product-info"))).toBe(
      true,
    );
    sensor.reset();
    vi.advanceTimersByTime(L.HESITATION_DWELL_MS);
    expect(fire).toHaveBeenCalledExactlyOnceWith(L.HESITATION_DWELL_MS);
  });
  it("ignores related prices and quick-add variants, using the actual title and purchase form", () => {
    const value = productDom();
    expect(value.title).toBe("Amazing Aluminum Bag Collection1");
    expect(value.variantId).toBe("101");
    expect(value.prices.map((e) => e.id)).toEqual(["pdp-price"]);
  });
  it("fires once after twenty visible seconds and never for a recommendation price", async () => {
    visible = false;
    sensor.reset();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fire).not.toHaveBeenCalled();
    visible = true;
    window.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(L.HESITATION_DWELL_MS - 1);
    expect(fire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fire).toHaveBeenCalledExactlyOnceWith(L.HESITATION_DWELL_MS);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fire).toHaveBeenCalledTimes(1);
  });
  it("pauses offscreen time and resumes when the real price returns", async () => {
    sensor.reset();
    await vi.advanceTimersByTimeAsync(10_000);
    visible = false;
    sensor.refresh();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fire).not.toHaveBeenCalled();
    visible = true;
    sensor.refresh();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fire).toHaveBeenCalledExactlyOnceWith(20_000);
  });
  it("handles late price insertion and section replacement", async () => {
    document.querySelector("#pdp-price")!.remove();
    sensor.reset();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fire).not.toHaveBeenCalled();
    document
      .querySelector("section")!
      .insertAdjacentHTML(
        "afterbegin",
        '<div class="productPrice" id="pdp-price">KSh499.44</div>',
      );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fire).not.toHaveBeenCalled();
    document.querySelector("#pdp-price")!.outerHTML =
      '<span class="product-price" id="pdp-price">KSh499.44</span>';
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fire).toHaveBeenCalledTimes(1);
  });
  it("pauses while chat/checkout/health gates suppress assistance and tears down pending work", async () => {
    sensor.reset();
    await vi.advanceTimersByTimeAsync(5_000);
    allowed = false;
    sensor.refresh();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fire).not.toHaveBeenCalled();
    allowed = true;
    sensor.refresh();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fire).not.toHaveBeenCalled();
    sensor.destroy();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fire).not.toHaveBeenCalled();
  });
  it("accepts duplicate primary forms only when they agree on the selected variant", () => {
    document
      .querySelector("section")!
      .insertAdjacentHTML(
        "beforeend",
        '<form action="/cart/add"><input name="id" value="101"></form>',
      );
    expect(productDom().variantId).toBe("101");
    document
      .querySelector("section form:last-child input")!
      .setAttribute("value", "202");
    expect(productDom().variantId).toBeUndefined();
  });
});
