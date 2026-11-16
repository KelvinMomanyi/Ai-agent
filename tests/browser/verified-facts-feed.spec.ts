import { test, expect } from "@playwright/test";
test.beforeEach(async ({ request, context }) => {
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === "http://127.0.0.1:4179")
      await route.continue();
    else throw new Error("Unexpected external request");
  });
  await request.post("/__qa/reset", {
    data: { agentCore: true, serverFacts: true, currency: "KES" },
  });
});
test("authenticated facts create bounded placements without theme blocks and disappear when revoked", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let reads = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/experience")) reads++;
  });
  await page.goto("/products/shampoo?aov_debug=1");
  const campaign = page.locator('[data-aovboost-widget="countdown_banner"]'),
    notice = page.locator('[data-aovboost-widget="inline_alert"]');
  await expect(campaign).toContainText("Configured fixture campaign");
  await expect(notice).toContainText("Supplied fixture notice");
  expect(reads).toBe(1);
  for (const widget of [campaign, notice]) {
    const rect = await widget.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
  }
  await page.route("**/apps/aovboost/experience", (r) =>
    r.fulfill({ status: 503, json: {} }),
  );
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(campaign).toHaveCount(0);
  await expect(notice).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("verified cart reward uses the shop currency and exposes a real code only at the threshold", async ({
  page,
}) => {
  await page.goto("/cart");
  const reward = page.locator('[data-aovboost-widget="discount_nudge"]');
  await expect(reward).toContainText("KES");
  await expect(reward.getByRole("link")).toHaveAttribute("href", "/cart");
  await page.route("**/apps/aovboost/offer", (route) =>
    route.fulfill({ json: { widgetType: null, payload: {} } }),
  );
  await page.evaluate(async () => {
    await fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          { id: 101, quantity: 1 },
          { id: 102, quantity: 1 },
        ],
      }),
    });
  });
  await expect(
    reward.getByRole("link", { name: "Apply code" }),
  ).toHaveAttribute("href", "/discount/FIXTURE10?redirect=%2Fcart");
});
test("flag off makes no verified-facts requests", async ({ page, request }) => {
  await request.post("/__qa/reset", { data: { agentCore: false } });
  let reads = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/experience")) reads++;
  });
  await page.goto("/products/shampoo");
  await page.waitForTimeout(1000);
  expect(reads).toBe(0);
  await expect(page.locator("[data-aovboost-auto-slot]")).toHaveCount(0);
});
