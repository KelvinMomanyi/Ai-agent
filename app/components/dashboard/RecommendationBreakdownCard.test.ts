import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppProvider } from "@shopify/polaris";
import i18n from "@shopify/polaris/locales/en.json";
import { describe, expect, it } from "vitest";
import { RecommendationBreakdownCard } from "./RecommendationBreakdownCard";
import {
  summarizeBreakdowns,
  MIN_BREAKDOWN_DISPLAYS,
  type BreakdownAggregate,
} from "../../models/recommendationBreakdown.server";

function row(
  displayed: number,
  axis: BreakdownAggregate["axis"] = "origin",
  bucket = "merchant",
): BreakdownAggregate {
  return {
    axis,
    bucket,
    displayed,
    clicked: 10,
    added: 5,
    purchased: 2,
    amounts: [
      { currency: "USD", revenue: 8 },
      { currency: "EUR", revenue: 12 },
    ],
  };
}
function render(rows: BreakdownAggregate[]) {
  return renderToStaticMarkup(
    createElement(
      AppProvider,
      { i18n },
      createElement(RecommendationBreakdownCard, {
        report: summarizeBreakdowns(rows),
      }),
    ),
  )
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");
}
describe("descriptive breakdown rendering", () => {
  it("shows an honest empty state without a lift or a rate", () => {
    const text = render([]);
    expect(text).toContain(
      "No displayed cart recommendations in this period. Not enough data yet.",
    );
    expect(text).not.toMatch(/\d+[.]?\d*%/);
    expect(text).toContain("not measured lift");
  });
  it("withholds subgroup rates below the named threshold while retaining counts", () => {
    const text = render([row(MIN_BREAKDOWN_DISPLAYS - 1)]);
    expect(text).toContain("Merchant pairings only");
    expect(text).toContain("10 / 29");
    expect(text).toContain("Not enough data yet");
    expect(text).not.toMatch(/\d+[.]?\d*%/);
  });
  it("shows explicit denominators only for descriptive samples and never sums currencies", () => {
    const text = render([
      row(MIN_BREAKDOWN_DISPLAYS),
      row(MIN_BREAKDOWN_DISPLAYS, "placement", "cart_page"),
    ]);
    expect(text).toContain("10 / 30 (33.3%)");
    expect(text).toContain("5 / 10 (50.0%)");
    expect(text).toContain("2 / 5 (40.0%)");
    expect(text).toContain("$8.00; €12.00");
    expect(text).not.toContain("$20.00");
    expect(text).toContain("Attributed line revenue");
    expect(text).toContain("These groups are not randomized");
    expect(text).toContain("do not add the tables together");
  });
  it("labels mixed and unknown coverage and does not invent a legacy currency", () => {
    const mixed = row(30, "origin", "mixed");
    mixed.amounts = [{ currency: null, revenue: 5 }];
    const text = render([
      mixed,
      { ...row(1, "placement", "unknown"), amounts: [] },
    ]);
    expect(text).toContain("Mixed pairing origins");
    expect(text).toContain("Unknown or unverified placement");
    expect(text).toContain("5 (currency unavailable)");
    expect(text).not.toContain("$5.00");
    expect(text).toContain("not each card");
    expect(text).toContain("not an independent display audit");
  });
});

describe("breakdown threshold and fixed partitions", () => {
  it("returns bounded zero rows and avoids dividing by an empty denominator", () => {
    const report = summarizeBreakdowns([]);
    expect(report.byOrigin).toHaveLength(6);
    expect(report.byPlacement).toHaveLength(4);
    expect(
      report.byOrigin.every(
        (entry) =>
          !entry.ready &&
          entry.clickRate === null &&
          entry.addRate === null &&
          entry.purchaseRate === null,
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(
      /NaN|Infinity|confidence|incrementalRevenue/,
    );
  });
  it("the reporting threshold is not a significance test or a holdout lift", () => {
    const sample = {
      ...row(MIN_BREAKDOWN_DISPLAYS),
      clicked: 0,
      added: 0,
      purchased: 0,
    };
    const report = summarizeBreakdowns([sample]);
    expect(report.byOrigin[0]).toMatchObject({
      ready: true,
      clickRate: 0,
      addRate: null,
      purchaseRate: null,
    });
    expect(report).not.toHaveProperty("lift");
    expect(report).not.toHaveProperty("significant");
  });
});
