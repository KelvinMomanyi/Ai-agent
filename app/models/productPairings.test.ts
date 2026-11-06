import { describe, expect, it } from "vitest";
import {
  deterministicPairingCandidates,
  inferRoutineStage,
  normalizeVerticalPreset,
  validatePairingRanking,
  type PairingProduct,
} from "./productPairings";
const product = (
  id: number,
  title: string,
  extra: Partial<PairingProduct> = {},
): PairingProduct => ({
  id: `gid://shopify/Product/${id}`,
  title,
  vendor: null,
  productType: null,
  tags: [],
  collectionIds: [],
  ...extra,
});

describe("deterministic pairing evidence", () => {
  it.each([
    ["Daily shampoo, 250ml", "cleanse"],
    ["Leave-in conditioner", "condition"],
    ["Hair mask", "treat"],
    ["Styling gel", "style"],
    ["Daily SPF50", "protect"],
    ["Wide-tooth comb", "tools"],
  ])("infers %s as %s without personal or health claims", (title, stage) => {
    expect(inferRoutineStage(product(1, title))).toBe(stage);
  });
  it("uses product type before tags/title and leaves ambiguous stages neutral", () => {
    expect(
      inferRoutineStage(
        product(1, "Gift set", {
          productType: "Conditioner",
          tags: ["shampoo"],
        }),
      ),
    ).toBe("condition");
    expect(inferRoutineStage(product(1, "Shampoo & conditioner"))).toBeNull();
    expect(inferRoutineStage(product(1, "Unknown item"))).toBeNull();
  });
  it("adds routine candidates only for the beauty/haircare preset", () => {
    const source = product(1, "Shampoo");
    const target = product(2, "Conditioner");
    expect(
      deterministicPairingCandidates({
        source,
        targets: [target],
        preset: "generic",
        affinities: [],
      }),
    ).toEqual([]);
    const candidates = deterministicPairingCandidates({
      source,
      targets: [target],
      preset: "beauty_haircare",
      affinities: [],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].reasons[0]).toBe(
      "Pairs the cleanse stage with the condition stage of a routine.",
    );
    expect(candidates[0].confidence).toBeLessThan(0.85);
  });
  it("uses vendor, collections and actual order affinities in generic mode", () => {
    const source = product(1, "Source", {
      vendor: "Brand",
      collectionIds: ["c"],
    });
    const targets = [
      product(2, "Vendor", { vendor: "Brand" }),
      product(3, "Collection", { collectionIds: ["c"] }),
      product(4, "Orders"),
      product(5, "Heuristic"),
    ];
    const rows = deterministicPairingCandidates({
      source,
      targets,
      preset: "generic",
      affinities: [
        { targetId: targets[2].id, score: 0.9, orderCount: 4 },
        { targetId: targets[3].id, score: 0.99, orderCount: 0 },
      ],
    });
    expect(rows.map(({ targetProductId }) => targetProductId)).toContain(
      targets[2].id,
    );
    expect(rows.map(({ targetProductId }) => targetProductId)).not.toContain(
      targets[3].id,
    );
    expect(rows[0].confidence).toBe(0.92);
  });
  it("has deterministic strong-evidence scores and never suggests a self-pair", () => {
    const source = product(1, "Shampoo", { vendor: "Brand" });
    const target = product(2, "Conditioner", { vendor: "Brand" });
    const rows = deterministicPairingCandidates({
      source,
      targets: [source, target],
      preset: "beauty_haircare",
      affinities: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].confidence).toBe(0.9);
    expect(normalizeVerticalPreset("unrecognized")).toBe("generic");
  });
});

describe("pairing AI allowlist", () => {
  const source = product(1, "Shampoo", { vendor: "Brand" });
  const candidates = deterministicPairingCandidates({
    source,
    targets: [
      product(2, "Conditioner", { vendor: "Brand" }),
      product(3, "Comb", { vendor: "Brand" }),
    ],
    preset: "beauty_haircare",
    affinities: [],
  });
  it("drops foreign and duplicate IDs and ignores invented clinical reasons", () => {
    const valid = candidates[1];
    const rows = validatePairingRanking(
      {
        pairings: [
          {
            sourceProductId: "foreign-source",
            targetProductId: valid.targetProductId,
          },
          { sourceProductId: source.id, targetProductId: "foreign-target" },
          {
            sourceProductId: source.id,
            targetProductId: valid.targetProductId,
            reason: "Clinically proven to cure allergies for curly hair",
          },
          {
            sourceProductId: source.id,
            targetProductId: valid.targetProductId,
            reason: valid.reasons[0],
          },
        ],
      },
      candidates,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].targetProductId).toBe(valid.targetProductId);
    expect(rows[0].reason).toBe(valid.reasons[0]);
    expect(JSON.stringify(rows)).not.toMatch(
      /foreign|clinically|allergies|curly/i,
    );
  });
  it("accepts a reason only from that exact source/target pair", () => {
    const rows = validatePairingRanking(
      {
        pairings: [
          {
            sourceProductId: source.id,
            targetProductId: candidates[0].targetProductId,
            reason: candidates[0].reasons[1],
          },
        ],
      },
      candidates,
    );
    expect(rows[0].reason).toBe(candidates[0].reasons[1]);
  });
  it.each([null, {}, { pairings: "invalid" }])(
    "falls back deterministically on malformed output: %j",
    (output) => {
      expect(
        validatePairingRanking(output, candidates).map(
          ({ targetProductId }) => targetProductId,
        ),
      ).toEqual(candidates.map(({ targetProductId }) => targetProductId));
    },
  );
});
