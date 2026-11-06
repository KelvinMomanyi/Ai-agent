// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResourceKind } from "../models/resourcePicker";
const mocks = vi.hoisted(() => ({ picker: vi.fn(), changed: vi.fn() }));
vi.mock("@shopify/app-bridge-react", () => ({
  useAppBridge: () => ({ resourcePicker: mocks.picker }),
}));
vi.mock("@shopify/polaris", async () => {
  const { createElement: h } = await import("react");
  return {
    BlockStack: ({ children }: any) => h("div", null, children),
    InlineStack: ({ children }: any) => h("div", null, children),
    Text: ({ children, as }: any) => h(as || "p", null, children),
    Button: ({ children, onClick, disabled, accessibilityLabel }: any) =>
      h(
        "button",
        { onClick, disabled, "aria-label": accessibilityLabel },
        children,
      ),
  };
});
import { ResourcePickerField } from "./ResourcePickerField";
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.resetAllMocks();
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
async function render(type: ResourceKind = "product") {
  const resource = type === "product" ? "Product" : "Collection";
  function Harness() {
    const [value, setValue] = useState(
      `gid://shopify/${resource}/1, gid://shopify/${resource}/2`,
    );
    return createElement(ResourcePickerField, {
      label: "Recommendation exclusions",
      type,
      value,
      onChange: (next) => {
        mocks.changed(next);
        setValue(next);
      },
    });
  }
  await act(async () => root.render(createElement(Harness)));
}
async function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (node) => node.textContent === label,
  )!;
  await act(async () => button.click());
}

describe("merchant resource selection", () => {
  it.each(["product", "collection"] as const)(
    "preselects and replaces %s IDs through App Bridge",
    async (type) => {
      const resource = type === "product" ? "Product" : "Collection";
      mocks.picker.mockResolvedValueOnce([
        { id: `gid://shopify/${resource}/3`, title: "Selected item" },
      ]);
      await render(type);
      expect(container.textContent).not.toContain("gid://");
      await click(
        type === "product" ? "Select products" : "Select collections",
      );
      expect(mocks.picker).toHaveBeenCalledWith({
        type,
        action: "select",
        multiple: 500,
        selectionIds: [
          { id: `gid://shopify/${resource}/1` },
          { id: `gid://shopify/${resource}/2` },
        ],
        ...(type === "product" ? { filter: { variants: false } } : {}),
      });
      expect(mocks.changed).toHaveBeenCalledWith(`gid://shopify/${resource}/3`);
      expect(container.textContent).toContain(
        `1 ${type} selected: Selected item`,
      );
    },
  );
  it("preserves existing selections when the merchant cancels", async () => {
    mocks.picker.mockResolvedValueOnce(undefined);
    await render();
    await click("Select products");
    expect(mocks.changed).not.toHaveBeenCalled();
    expect(container.textContent).toContain("2 products selected");
  });
  it("allows explicit clearing without entering product IDs", async () => {
    await render();
    await click("Clear selection");
    expect(mocks.changed).toHaveBeenCalledWith("");
    expect(container.textContent).toContain("0 products selected");
    expect(mocks.picker).not.toHaveBeenCalled();
  });
  it("keeps values and provides a recoverable message when App Bridge fails", async () => {
    mocks.picker.mockRejectedValueOnce(new Error("bridge unavailable"));
    await render();
    await click("Select products");
    expect(mocks.changed).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "try again",
    );
  });
});
