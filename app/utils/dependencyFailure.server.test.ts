import { describe, expect, it, vi } from "vitest";
import {
  dependencyFailureReason,
  reportDependencyFailure,
} from "./dependencyFailure.server";

describe("sanitized dependency diagnostics", () => {
  it("identifies nested DNS failures without exposing request data", () => {
    expect(
      dependencyFailureReason(
        new Error("fetch failed", { cause: { code: "ENOTFOUND" } }),
      ),
    ).toBe("dns_failure");
    expect(dependencyFailureReason({ code: "P2021" })).toBe("schema_missing");
    expect(dependencyFailureReason(new Error("WRONGPASS token=private"))).toBe(
      "authentication_failed",
    );
  });
  it("emits only safe categories and throttles repeated failures", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const error = new Error("secret token, URL and customer data");
      reportDependencyFailure("test_operation", error);
      reportDependencyFailure("test_operation", error);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith("AOVBoost dependency unavailable", {
        operation: "test_operation",
        reason: "unavailable",
      });
    } finally {
      log.mockRestore();
    }
  });
});
