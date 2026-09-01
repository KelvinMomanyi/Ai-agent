import { describe, expect, it } from "vitest";
import { buildSalesAssistantIntro } from "./copyWriter.server";

describe("sales assistant opening copy", () => {
  it("introduces verified catalog categories and products", () => {
    const intro = buildSalesAssistantIntro({
      affinities: [
        affinity("Trail Board", "Boards"),
        affinity("Hiking Hoodie", "Apparel"),
        affinity("Camp Mug", "Accessories"),
      ],
    });

    expect(intro).toContain("Boards, Apparel, and Accessories");
    expect(intro).toContain("Trail Board, Hiking Hoodie, and Camp Mug");
    expect(intro).toContain("help you choose the best fit");
  });

  it("keeps a useful conversational sales welcome without catalog context", () => {
    const intro = buildSalesAssistantIntro({});

    expect(intro).toContain("show you what’s in store");
    expect(intro).toContain("answer any question");
  });
});

function affinity(title: string, productType: string) {
  return { target: { title, productType } };
}
