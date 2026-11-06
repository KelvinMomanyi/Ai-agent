import { describe, expect, it } from "vitest";
import { computeSetupChecklist, themeEmbedEditorUrl } from "./onboarding";

const now = new Date("2026-11-05T12:00:00Z");
const input = {
  actionableProductCount: 0,
  syncProgress: null,
  previewedAt: null,
  lastStorefrontActivityAt: null,
  now,
};
const state = (steps: ReturnType<typeof computeSetupChecklist>, id: string) =>
  steps.find((step) => step.id === id)?.state;

describe("setup checklist", () => {
  it("leaves the historical empty state when product webhooks populate the catalog", () => {
    expect(
      state(
        computeSetupChecklist({
          ...input,
          actionableProductCount: 2,
          storedProductCount: 2,
          syncProgress: { status: "complete", emptyCatalog: true },
        }),
        "sync",
      ),
    ).toBe("complete");
  });
  it("shows an availability blocker after a nonempty completed sync with no sellable variants", () => {
    const steps = computeSetupChecklist({
      ...input,
      storedProductCount: 2,
      syncProgress: { status: "complete" },
    });
    expect(state(steps, "sync")).toBe("blocked");
    expect(steps[0].detail).toContain("availability");
  });
  it("distinguishes never synced, syncing, empty and failed catalogs", () => {
    expect(state(computeSetupChecklist(input), "sync")).toBe("pending");
    expect(
      state(
        computeSetupChecklist({
          ...input,
          syncProgress: { status: "fetching" },
        }),
        "sync",
      ),
    ).toBe("in_progress");
    expect(
      state(
        computeSetupChecklist({
          ...input,
          syncProgress: { status: "complete", emptyCatalog: true },
        }),
        "sync",
      ),
    ).toBe("empty");
    expect(
      state(
        computeSetupChecklist({ ...input, syncProgress: { status: "failed" } }),
        "sync",
      ),
    ).toBe("failed");
  });
  it("blocks preview until at least two available products finish syncing", () => {
    expect(
      state(
        computeSetupChecklist({ ...input, actionableProductCount: 1 }),
        "preview",
      ),
    ).toBe("blocked");
    expect(
      state(
        computeSetupChecklist({
          ...input,
          actionableProductCount: 2,
          syncProgress: { status: "fetching" },
        }),
        "preview",
      ),
    ).toBe("blocked");
    expect(
      state(
        computeSetupChecklist({ ...input, actionableProductCount: 2 }),
        "preview",
      ),
    ).toBe("pending");
  });
  it("preserves an explicitly reviewed preview without shopper impressions", () => {
    expect(
      state(computeSetupChecklist({ ...input, previewedAt: now }), "preview"),
    ).toBe("complete");
  });
  it("hides pairing approval behind the Phase 3 flag", () => {
    expect(
      computeSetupChecklist({ ...input, pairingsEnabled: false }).some(
        ({ id }) => id === "pairings",
      ),
    ).toBe(false);
    expect(
      state(
        computeSetupChecklist({ ...input, pairingsEnabled: true }),
        "pairings",
      ),
    ).toBe("blocked");
  });
  it.each([0, 13, 14])(
    "verifies authenticated activity %i days ago",
    (days) => {
      const steps = computeSetupChecklist({
        ...input,
        lastStorefrontActivityAt: new Date(now.getTime() - days * 86_400_000),
        themeStatus: "verified",
        themeVerifiedAt: new Date(now.getTime() - days * 86400000),
      });
      expect(state(steps, "verify")).toBe("complete");
      expect(state(steps, "embed")).toBe("complete");
    },
  );
  it.each([-1, 15])(
    "does not verify future or stale activity (%i days ago)",
    (days) => {
      expect(
        state(
          computeSetupChecklist({
            ...input,
            lastStorefrontActivityAt: new Date(
              now.getTime() - days * 86_400_000,
            ),
            themeStatus: "verified",
            themeVerifiedAt: new Date(now.getTime() - days * 86400000),
          }),
          "verify",
        ),
      ).toBe("pending");
    },
  );
  it("uses Shopify's API-key/block-handle deep link without new scopes", () => {
    const url = new URL(
      themeEmbedEditorUrl("test.myshopify.com", "public-api-key")!,
    );
    expect(url.origin).toBe("https://test.myshopify.com");
    expect(url.pathname).toBe("/admin/themes/current/editor");
    expect(url.searchParams.get("context")).toBe("apps");
    expect(url.searchParams.get("activateAppId")).toBe(
      "public-api-key/aovboost",
    );
    expect(themeEmbedEditorUrl("evil.example.com", "key")).toBeNull();
    expect(themeEmbedEditorUrl("test.myshopify.com", "")).toBeNull();
  });
});
