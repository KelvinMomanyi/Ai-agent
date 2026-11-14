import { test, expect, type Page } from "@playwright/test";
const productId = "gid://shopify/Product/1";
const now = new Date("2026-11-13T08:00:00Z");
const future = "2026-11-14T00:00:00Z";
const surface = (page: Page, type: string) =>
  page.locator(`[data-aovboost-widget='${type}']`);
test.beforeEach(async ({ context, request }) => {
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === "http://127.0.0.1:4179")
      await route.continue();
    else throw new Error("External request in local simulation");
  });
  await request.post("/__qa/reset", {
    data: { agentCore: true, factSlots: true, currency: "KES" },
  });
});
async function configure(
  page: Page,
  agentFacts: Record<string, unknown> = {},
  campaign: Record<string, unknown> = {},
) {
  await page.addInitScript(
    ({ facts, campaign }) => {
      let config: any;
      Object.defineProperty(window, "AOVBoost", {
        configurable: true,
        get: () => config,
        set: (value) => {
          config = { ...value, agentFacts: facts, campaign };
        },
      });
      (window as any).__factShifts = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          if (!(entry as any).hadRecentInput)
            (window as any).__factShifts.push((entry as any).value);
      }).observe({ type: "layout-shift", buffered: true });
    },
    { facts: agentFacts, campaign },
  );
}
async function start(
  page: Page,
  type: string,
  path = "/products/shampoo",
  payload: Record<string, unknown> = {},
) {
  await page.route("**/apps/aovboost/offer", (route) =>
    route.fulfill({
      json: {
        widgetType: type,
        payload: { offerId: "facts-fixture-offer", ...payload },
      },
    }),
  );
  await page.goto(path);
  await page.waitForFunction(() =>
    (window as any).AOVBoostSDK?.diagnose().recentDecisions.some(
      (row: any) => row.widgetType !== null,
    ),
  );
}
for (const type of [
  "discount_nudge",
  "countdown_banner",
  "social_proof",
  "inline_alert",
])
  test(`missing authoritative facts suppress ${type} despite generated claims`, async ({
    page,
  }) => {
    await configure(page);
    await start(
      page,
      type,
      type === "discount_nudge" ? "/cart" : "/products/shampoo",
      {
        threshold: 50,
        endsAt: future,
        body: "Only one left",
        products: [{ id: productId, title: "Shampoo", orderCount: 999 }],
        copy: { rewardDescription: "Free shipping" },
      },
    );
    await expect(surface(page, type)).toHaveCount(0);
  });
test("countdown uses the configured deadline, expires without moving content and works with AI unavailable", async ({
  page,
}) => {
  await page.clock.install({ time: now });
  await configure(
    page,
    {},
    {
      type: "flash",
      endsAt: "2026-11-13T08:00:05Z",
      headline: "Store campaign",
    },
  );
  await start(page, "countdown_banner");
  await expect(surface(page, "countdown_banner")).toBeVisible();
  await expect(surface(page, "countdown_banner")).toContainText(
    "Store campaign",
  );
  await expect(surface(page, "countdown_banner")).toContainText(
    "2026-11-13 08:00:05 UTC",
  );
  const before = await page.locator("#after-facts").boundingBox();
  await page.clock.fastForward(5_100);
  await expect(surface(page, "countdown_banner")).toHaveCount(0);
  expect(await page.locator("#after-facts").boundingBox()).toEqual(before);
  await page.waitForTimeout(60);
  expect(
    await page.evaluate(() =>
      (window as any).__factShifts.reduce(
        (sum: number, value: number) => sum + value,
        0,
      ),
    ),
  ).toBe(0);
  await page.evaluate(() =>
    (window as any).AOVBoostSDK.requestOffer("manual", {}),
  );
  await expect(surface(page, "countdown_banner")).toHaveCount(0);
});
test("proof requires the minimum count and shows the exact completed window for this product", async ({
  page,
}) => {
  await page.clock.install({ time: now });
  await configure(page, {
    version: 1,
    proof: [
      {
        productId,
        verified: true,
        count: 4,
        startsAt: "2026-11-01T00:00:00Z",
        endsAt: "2026-11-12T23:59:59Z",
      },
    ],
  });
  await start(page, "social_proof", "/products/shampoo", {
    products: [{ id: productId, title: "Shampoo", orderCount: 999 }],
  });
  await expect(surface(page, "social_proof")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).AOVBoost.agentFacts.proof[0].count = 5;
    return (window as any).AOVBoostSDK.requestOffer("manual", {});
  });
  await expect(surface(page, "social_proof")).toContainText(
    "5 verified orders included Shampoo.",
  );
  await expect(surface(page, "social_proof")).toContainText(
    "2026-11-01 00:00:00 UTC",
  );
  await expect(surface(page, "social_proof")).toContainText(
    "2026-11-12 23:59:59 UTC",
  );
  await page.clock.fastForward(6_000);
  await expect(surface(page, "social_proof")).not.toContainText("999");
});
test("notice dismissal persists by payload ID, and a new notice can appear immediately", async ({
  page,
}) => {
  await configure(page, {
    version: 1,
    alerts: [
      {
        id: "public-notice-v1",
        productId,
        body: "Store collection is available on weekdays.",
      },
    ],
  });
  await start(page, "inline_alert");
  await expect(surface(page, "inline_alert")).toContainText(
    "Store collection is available on weekdays.",
  );
  await surface(page, "inline_alert")
    .getByRole("button", { name: "Dismiss notification" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(surface(page, "inline_alert")).toHaveCount(0);
  const saved = await page.evaluate(() =>
    JSON.stringify({ ...sessionStorage }),
  );
  expect(saved).not.toContain("public-notice-v1");
  expect(saved).not.toContain("Store collection is available");
  await page.reload();
  await page.waitForFunction(
    () => (window as any).AOVBoostSDK?.diagnose().recentDecisions.length > 0,
  );
  await expect(surface(page, "inline_alert")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).AOVBoost.agentFacts.alerts[0] = {
      id: "public-notice-v2",
      productId: "gid://shopify/Product/1",
      body: "New store collection hours.",
    };
    return (window as any).AOVBoostSDK.requestOffer("manual", {});
  });
  await expect(surface(page, "inline_alert")).toContainText(
    "New store collection hours.",
  );
});
test("cart progress uses the shared live currency snapshot and never claims a reward was applied", async ({
  page,
}) => {
  const errors: string[] = [],
    cartReads: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().endsWith("/cart.js")) cartReads.push(request.url());
  });
  await configure(page, {
    version: 1,
    reward: {
      id: "configured-v1",
      configured: true,
      description: "the configured shipping offer",
      threshold: 50,
      currency: "KES",
      code: "REAL_MERCHANT_CODE",
    },
  });
  await start(page, "discount_nudge", "/cart", { threshold: 50 });
  await expect(surface(page, "discount_nudge")).toContainText(
    new Intl.NumberFormat("en", { style: "currency", currency: "KES" }).format(
      50,
    ),
  );
  await expect(
    surface(page, "discount_nudge").getByRole("progressbar"),
  ).toHaveAttribute("aria-valuenow", "0");
  await expect(
    surface(page, "discount_nudge").getByRole("link", { name: "Review cart" }),
  ).toHaveAttribute("href", "/cart");
  const before = await page.locator("#after-facts").boundingBox(),
    readCount = cartReads.length;
  await page.evaluate(() => {
    (window as any).AOVBoostSDK.track("cart_update", {
      cartItems: [],
      cartValue: 75,
      currency: "KES",
    });
  });
  await expect(
    surface(page, "discount_nudge").getByRole("progressbar"),
  ).toHaveAttribute("aria-valuenow", "100");
  await expect(surface(page, "discount_nudge")).toContainText(
    "Cart target reached",
  );
  await expect(surface(page, "discount_nudge")).not.toContainText(
    /applied|earned|unlocked/i,
  );
  expect(cartReads).toHaveLength(readCount);
  expect(await page.locator("#after-facts").boundingBox()).toEqual(before);
  await page.evaluate(() => {
    (window as any).AOVBoostSDK.track("cart_update", {
      cartItems: [],
      cartValue: 75,
      currency: "USD",
    });
  });
  await expect(surface(page, "discount_nudge")).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("a valid fact is suppressed when the app slot has no reserved space", async ({
  page,
  request,
}) => {
  await request.post("/__qa/reset", {
    data: { agentCore: true, factSlots: true, unreservedFacts: true },
  });
  await configure(page, {
    version: 1,
    alerts: [
      { id: "notice-v1", productId, body: "A supplied product notice." },
    ],
  });
  await start(page, "inline_alert");
  await expect(surface(page, "inline_alert")).toHaveCount(0);
});
test("legacy mode ignores the new facts and keeps the original notice payload", async ({
  page,
  request,
}) => {
  await request.post("/__qa/reset", {
    data: { agentCore: false, factSlots: true },
  });
  await configure(page, {
    version: 1,
    alerts: [
      {
        id: "notice-v1",
        productId,
        body: "New managed facts should be ignored.",
      },
    ],
  });
  const agents: string[] = [];
  page.on("request", (request) => {
    if (/\/aovboost-agent-/.test(request.url())) agents.push(request.url());
  });
  await start(page, "inline_alert", "/products/shampoo", {
    body: "Legacy supplied notice.",
  });
  await expect(surface(page, "inline_alert")).toContainText(
    "Legacy supplied notice.",
  );
  await expect(surface(page, "inline_alert")).not.toContainText(
    "New managed facts",
  );
  expect(agents).toEqual([]);
});
