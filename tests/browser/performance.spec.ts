import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  checkSdkSize,
  SDK_STAGE_BUDGET,
} from "../../scripts/check-sdk-size.mjs";
const folder = "extensions/aovboost-storefront/assets";
const assets = readdirSync(folder)
  .filter((name) =>
    /^aovboost-(sdk|agent-[\w-]+|theme-engine-[\w-]+)\.js$/.test(name),
  )
  .map((name) => ({ name, bytes: readFileSync(join(folder, name)) }));
const sizes = checkSdkSize(assets);
test.beforeEach(async ({ context }) => {
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === "http://127.0.0.1:4179")
      await route.continue();
    else throw new Error("External request in local simulation");
  });
});
test("flag off loads only the initial SDK and stays within its transfer budget", async ({
  page,
  request,
}, testInfo) => {
  await page.addInitScript(() => {
    let config: any;
    Object.defineProperty(window, "AOVBoost", {
      configurable: true,
      get: () => config,
      set: (value) => {
        config = { ...value, agent_holdout_percent: 100 };
      },
    });
  });
  await request.post("/__qa/reset", { data: { agentCore: false } });
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (/\/assets\/aovboost-.*\.js$/.test(request.url()))
      scripts.push(request.url().split("/").pop()!);
  });
  await page.goto("/products/shampoo");
  await page.waitForFunction(() => (window as any).AOVBoostSDK !== undefined);
  await page.waitForTimeout(800);
  expect(scripts).toEqual(["aovboost-sdk.js"]);
  expect(sizes.stages.initial.raw).toBeLessThanOrEqual(
    SDK_STAGE_BUDGET.initial.raw,
  );
  await testInfo.attach("sdk-performance.json", {
    body: Buffer.from(
      JSON.stringify({ mode: "flag_off", scripts, sizes }, null, 2),
    ),
    contentType: "application/json",
  });
});
test("flagged boot and first chat intent load each budgeted chunk once without layout shift", async ({
  page,
  request,
}, testInfo) => {
  await request.post("/__qa/reset", {
    data: { agentCore: true, chatEnabled: true },
  });
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (/\/assets\/aovboost-.*\.js$/.test(request.url()))
      scripts.push(request.url().split("/").pop()!);
  });
  await page.addInitScript(() => {
    (window as any).__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if (!(entry as any).hadRecentInput)
          (window as any).__cls += (entry as any).value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto("/products/shampoo");
  await expect(
    page.getByRole("button", { name: "Open assistant", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(300);
  expect(scripts.filter((name) => name.includes("ChatConversation"))).toEqual(
    [],
  );
  expect(scripts.filter((name) => name.includes("theme-engine"))).toEqual([]);
  const boot = scripts.reduce(
    (total, name) =>
      total + (assets.find((asset) => asset.name === name)?.bytes.length || 0),
    0,
  );
  expect(boot).toBe(sizes.stages.boot.raw);
  expect(new Set(scripts).size).toBe(scripts.length);
  const before = await page.locator("main").boundingBox();
  await page
    .getByRole("button", { name: "Open assistant", exact: true })
    .click();
  await expect(
    page.locator("[data-aovboost-widget='chat_window']").getByRole("dialog"),
  ).toBeVisible();
  await page.waitForTimeout(100);
  expect(
    scripts.filter((name) => name.includes("ChatConversation")),
  ).toHaveLength(1);
  expect(new Set(scripts).size).toBe(scripts.length);
  expect(
    scripts.reduce(
      (total, name) =>
        total +
        (assets.find((asset) => asset.name === name)?.bytes.length || 0),
      0,
    ),
  ).toBe(sizes.stages.conversation.raw);
  expect(await page.locator("main").boundingBox()).toEqual(before);
  const cls = await page.evaluate(() => (window as any).__cls);
  expect(cls).toBeLessThanOrEqual(0.01);
  await testInfo.attach("sdk-performance.json", {
    body: Buffer.from(
      JSON.stringify(
        { mode: "agent_then_chat", scripts, bootRaw: boot, cls, sizes },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });
});
