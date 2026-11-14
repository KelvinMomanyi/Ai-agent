// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Holdout, holdoutBucket } from "./Holdout";
afterEach(() => vi.restoreAllMocks());
const policy = (
  percent: unknown,
  measurement: unknown = null,
  holdout = false,
  analytics = true,
) =>
  new Holdout("one.shop", "anonymous-visitor-1", {
    percent: () => percent,
    measurement: () => measurement,
    serverHoldout: () => holdout,
    analytics: () => analytics,
  });
describe("agent holdout assignment", () => {
  it("is stable across instances, uses all 100 buckets and changes monotonically with the percentage", () => {
    const buckets = new Set<number>();
    for (let n = 0; n < 1000; n++) {
      const id = `anonymous-${n}`,
        bucket = holdoutBucket("one.shop", id);
      buckets.add(bucket);
      expect(holdoutBucket("one.shop", id)).toBe(bucket);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
    }
    expect(buckets.size).toBe(100);
    expect(holdoutBucket("one.shop", "anonymous-visitor-1")).not.toBe(
      holdoutBucket("two.shop", "anonymous-visitor-1"),
    );
    const bucket = holdoutBucket("one.shop", "anonymous-visitor-1");
    expect(policy(bucket).current().holdout).toBe(false);
    expect(policy(bucket + 1).current().holdout).toBe(true);
    expect(policy(0).current().holdout).toBe(false);
    expect(policy(100).current().holdout).toBe(true);
  });
  it.each([undefined, null, "25", -1, 101, NaN, Infinity, 0.5])(
    "defaults invalid percentages to zero: %s",
    (percent) =>
      expect(policy(percent).current()).toMatchObject({
        holdout: false,
        source: "agent",
        percent: 0,
      }),
  );
  it("keeps both signed server arms authoritative over a contradictory local percentage", () => {
    const server = {
      arm: "exposed",
      version: 4,
      percent: 10,
      link: "synthetic-signed-link",
    };
    expect(policy(100, server).current()).toEqual({
      holdout: false,
      source: "server",
      version: 4,
      percent: 10,
    });
    expect(policy(0, { ...server, arm: "holdout" }).current()).toMatchObject({
      holdout: true,
      source: "server",
    });
    expect(policy(0, null, true).current().holdout).toBe(true);
  });
  it("recomputes on authoritative changes and never lets a false override defeat local holdout", () => {
    let server: any = null;
    const holdout = new Holdout("one.shop", "anonymous-visitor-1", {
      percent: () => 100,
      measurement: () => server,
      serverHoldout: () => false,
      analytics: () => true,
    });
    holdout.setServerHoldout(false);
    expect(holdout.current().holdout).toBe(true);
    server = { arm: "exposed", version: 1, percent: 10, link: "signed" };
    holdout.sync();
    expect(holdout.current().holdout).toBe(false);
    server = { ...server, arm: "holdout", version: 2 };
    expect(holdout.current().holdout).toBe(true);
  });
  it("does not add storage or log access and disables the local experiment without analytics", () => {
    const read = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const write = vi.spyOn(Storage.prototype, "setItem");
    const log = vi.spyOn(console, "debug");
    expect(policy(100).current()).toMatchObject({
      holdout: true,
      source: "agent",
    });
    expect(policy(100, null, false, false).current()).toMatchObject({
      holdout: false,
      percent: 0,
    });
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
