import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const mocks = vi.hoisted(() => ({
  plan: vi.fn(),
  query: vi.fn(),
  disconnect: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    $queryRaw = mocks.query;
    $disconnect = mocks.disconnect;
  },
}));
vi.mock("node:child_process", () => ({ spawnSync: mocks.spawn }));
vi.mock("../scripts/focused-cart-migration-recovery.mjs", () => ({
  planFocusedCartRecovery: mocks.plan,
}));
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("DATABASE_DIRECT_URL", "postgresql://synthetic-only.invalid/test");
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.query.mockImplementation(async (parts: TemplateStringsArray) =>
    parts.join("").includes("to_regclass") ? [{ present: true }] : [],
  );
  mocks.spawn.mockReturnValue({ status: 0 });
  mocks.plan.mockResolvedValue({
    message: "Verified test plan",
    scriptName: "migrate:rollback:focused-cart",
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe("guarded build reconciliation", () => {
  it("maps the recovery alias only to the failed focused-cart record", () => {
    const config = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(config.scripts["migrate:rollback:focused-cart"]).toBe(
      "prisma migrate resolve --rolled-back 20261105140000_focused_cart_defaults",
    );
    expect(config.scripts["vercel-build"]).toBe(
      "prisma migrate deploy && npm run build",
    );
  });
  it("runs the fixed Prisma resolution script once after validation and disconnect", async () => {
    await import("../scripts/reconcile-failed-migrations.mjs");
    expect(mocks.plan.mock.calls.length).toBe(1);
    expect(mocks.spawn.mock.calls.length).toBe(1);
    expect(mocks.spawn.mock.calls[0][1]).toEqual([
      "run",
      "migrate:rollback:focused-cart",
    ]);
    expect(mocks.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.spawn.mock.invocationCallOrder[0],
    );
  });
  it("does not run any resolution when no failed migration remains", async () => {
    mocks.plan.mockResolvedValue(null);
    await import("../scripts/reconcile-failed-migrations.mjs");
    expect(mocks.spawn.mock.calls.length).toBe(0);
  });
  it("stops before a command when the recovery plan is rejected", async () => {
    mocks.plan.mockRejectedValue(new Error("Schema needs review"));
    await expect(
      import("../scripts/reconcile-failed-migrations.mjs"),
    ).rejects.toThrow("needs review");
    expect(mocks.spawn.mock.calls.length).toBe(0);
    expect(mocks.disconnect.mock.calls.length).toBe(1);
  });
  it("propagates a failed Prisma command instead of continuing the build", async () => {
    mocks.spawn.mockReturnValue({ status: 1 });
    await expect(
      import("../scripts/reconcile-failed-migrations.mjs"),
    ).rejects.toThrow("status 1");
    expect(mocks.spawn.mock.calls.length).toBe(1);
  });
  it("propagates a command launch error", async () => {
    mocks.spawn.mockReturnValue({
      error: new Error("Test command unavailable"),
    });
    await expect(
      import("../scripts/reconcile-failed-migrations.mjs"),
    ).rejects.toThrow("Test command unavailable");
  });
});
