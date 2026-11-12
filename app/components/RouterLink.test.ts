// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterLink } from "./RouterLink";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("embedded Polaris router links", () => {
  it("navigates to internal destinations through React Router without a document request", async () => {
    await act(async () =>
      root.render(
        h(
          MemoryRouter,
          { initialEntries: ["/app?shop=one.myshopify.com&embedded=1"] },
          h(
            Routes,
            null,
            h(Route, {
              path: "/app",
              element: h(RouterLink, {
                url: "/app/preview",
                children: "Preview",
              }),
            }),
            h(Route, {
              path: "/app/preview",
              element: h("p", null, "Offer preview"),
            }),
          ),
        ),
      ),
    );
    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/app/preview");
    await act(async () => {
      expect(
        link.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            button: 0,
          }),
        ),
      ).toBe(false);
    });
    expect(container.textContent).toBe("Offer preview");
  });

  it.each([
    "https://admin.shopify.com/store/one",
    "//example.com/path",
    "mailto:support@example.com",
  ])("preserves native external link behavior for %s", async (url) => {
    await act(async () =>
      root.render(
        h(RouterLink, {
          url,
          external: true,
          target: "_blank",
          children: "Open",
        }),
      ),
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe(url);
    expect(container.querySelector("a")?.getAttribute("target")).toBe("_blank");
  });
});
