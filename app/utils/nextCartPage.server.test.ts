// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderNextCartPage } from "./nextCartPage.server";
const product = {
  handle: "shampoo",
  title: "<script>bad</script>",
  variants: [
    {
      id: "gid://shopify/ProductVariant/101",
      title: "Default",
      price: "20.00",
      availableForSale: true,
    },
  ],
};
afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
describe("new-cart confirmation", () => {
  it("escapes catalog text, names its new-cart semantics and hides unavailable variants", () => {
    const html = renderNextCartPage(product, "offer");
    expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;");
    expect(html).toContain("completed order stays as placed");
    expect(() => renderNextCartPage({ variants: [] }, "offer")).toThrow();
  });
  it("never adds on GET/render and never retries a successful POST when refresh fails", async () => {
    document.body.innerHTML = renderNextCartPage(product, "offer");
    const requests: any[] = [];
    let added = false;
    const fetcher = vi.fn(async (url, options) => {
      requests.push({ url, options });
      if (String(url).includes("products/"))
        return new Response(
          JSON.stringify({
            variants: [
              { id: 101, title: "Default", price: 2000, available: true },
            ],
          }),
        );
      if (String(url).includes("add")) {
        added = true;
        return new Response("{}");
      }
      return new Response(JSON.stringify({ currency: "KES" }), {
        status: added ? 503 : 200,
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const script = document.querySelector("script")!;
    window.eval(script.textContent!);
    await vi.waitFor(() =>
      expect(
        (document.querySelector("[type=submit]") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(requests.every((r) => r.options?.method !== "POST")).toBe(true);
    expect(document.querySelector("select")!.textContent).toContain("KES");
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() =>
      expect(document.querySelector("[role=status]")!.textContent).toContain(
        "Review your cart",
      ),
    );
    expect(requests).toHaveLength(4);
    expect(requests[2].options.headers["X-AOVBoost-Source"]).toBe(
      "aov_postadd",
    );
    expect(JSON.parse(requests[2].options.body)).toMatchObject({
      id: "101",
      quantity: 1,
      properties: { _aovboost_offer_id: "offer" },
    });
    expect(document.querySelector("button")!.textContent).toBe("Review cart");
  });
});
