import { test, expect } from "@playwright/test";

test.beforeEach(async ({ context, request }) => {
  // A local simulation may never follow a product, checkout, image or API URL out.
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:4179") await route.continue();
    else
      throw new Error(`Simulation attempted external request: ${url.origin}`);
  });
  await request.post("/__qa/reset", { data: {} });
});

test.afterEach(async ({ request }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus)
    await testInfo.attach("synthetic-fixture-state", {
      body: await (await request.get("/__qa/state")).body(),
      contentType: "application/json",
    });
});

async function start(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    (window as any).__qaInitialCartRead = false;
    document.addEventListener("aovboost:event", (event) => {
      const detail = (event as CustomEvent).detail;
      if (
        detail?.type === "cart_update" &&
        detail.source === "initial_cart_state"
      )
        (window as any).__qaInitialCartRead = true;
    });
  });
  await page.goto("/products/shampoo");
  await page.waitForFunction(() => Boolean((window as any).AOVBoostSDK));
  // A native form continuation requires a verified pre-add cart baseline.
  await page.waitForFunction(
    () => (window as any).__qaInitialCartRead === true,
  );
}
const surface = (page: import("@playwright/test").Page) =>
  page.locator("[data-aovboost-widget='upsell_drawer']");

test("confirms one add, verifies a drawer card, accepts once without another offer", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  await expect(surface(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Add Shampoo" }).click();
  await expect(surface(page)).toBeVisible();
  await expect(
    surface(page).getByText("Conditioner", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await request.get("/__qa/state")).json()).events.filter(
          (event: any) => event.type === "widget_impression",
        ).length,
      { timeout: 10_000 },
    )
    .toBe(1);
  const state = await (await request.get("/__qa/state")).json();
  expect(state.offers).toHaveLength(1);
  expect(
    state.events.find((event: any) => event.type === "widget_impression"),
  ).toMatchObject({ verified: true, strategy: "native_drawer" });
  const screenshot = testInfo.outputPath("verified-cart-offer.png");
  await page.screenshot({ path: screenshot });
  await testInfo.attach("verified-cart-offer", {
    path: screenshot,
    contentType: "image/png",
  });
  await expect(page.locator("[role='dialog']")).toHaveCount(1);
  await surface(page)
    .getByRole("button", { name: "Add to cart", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await request.get("/__qa/state")).json()).cart.item_count,
    )
    .toBe(2);
  await expect
    .poll(async () =>
      (await (await request.get("/__qa/state")).json()).events.some(
        (event: any) => event.type === "recommendation_added",
      ),
    )
    .toBe(true);
  expect((await (await request.get("/__qa/state")).json()).offers).toHaveLength(
    1,
  );
  expect(errors).toEqual([]);
});

test("reloading a restored cart stays quiet", async ({ page, request }) => {
  await request.post("/__qa/reset", { data: { restored: true } });
  await start(page);
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).AOVBoostSDK));
  // Wait past the cart-observation and verified-display windows.
  await page.waitForTimeout(2500);
  await expect(surface(page)).toHaveCount(0);
  expect((await (await request.get("/__qa/state")).json()).offers).toHaveLength(
    0,
  );
});

test("waits for a native popup to close before using the floating fallback", async ({
  page,
  request,
}) => {
  await request.post("/__qa/reset", { data: { mode: "popup" } });
  await start(page);
  await page.getByRole("button", { name: "Add Shampoo" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(surface(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Close cart notification" }).click();
  await expect(surface(page)).toBeVisible();
  await expect
    .poll(async () =>
      (await (await request.get("/__qa/state")).json()).events.some(
        (event: any) =>
          event.type === "widget_impression" &&
          event.strategy === "floating_card",
      ),
    )
    .toBe(true);
});

test("native form redirect mounts inline on cart and the next reload stays quiet", async ({
  page,
  request,
}) => {
  await request.post("/__qa/reset", { data: { mode: "redirect" } });
  await start(page);
  await page.getByRole("button", { name: "Add Shampoo" }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(surface(page)).toBeVisible();
  await expect
    .poll(async () =>
      (await (await request.get("/__qa/state")).json()).events.some(
        (event: any) =>
          event.type === "widget_impression" && event.strategy === "cart_page",
      ),
    )
    .toBe(true);
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).AOVBoostSDK));
  await page.waitForTimeout(2500);
  await expect(surface(page)).toHaveCount(0);
  expect((await (await request.get("/__qa/state")).json()).offers).toHaveLength(
    1,
  );
});

test("Escape dismisses a floating card and returns keyboard focus", async ({
  page,
  request,
}) => {
  await request.post("/__qa/reset", { data: { mode: "floating" } });
  await start(page);
  const add = page.getByRole("button", { name: "Add Shampoo" });
  await add.click();
  await expect(surface(page)).toBeVisible();
  await surface(page)
    .getByRole("button", { name: "Close", exact: true })
    .focus();
  await page.keyboard.press("Escape");
  await expect(surface(page)).toHaveCount(0);
  await expect(add).toBeFocused();
});

test("holdout has no offer while retaining cart measurement linkage", async ({
  page,
  request,
}) => {
  await request.post("/__qa/reset", { data: { holdout: true } });
  await start(page);
  await page.getByRole("button", { name: "Add Shampoo" }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get("/__qa/state")).json()).cart.attributes
          .__aovboost_measurement__,
    )
    .toBe("synthetic-measurement-link");
  await page.waitForTimeout(2500);
  await expect(surface(page)).toHaveCount(0);
  const state = await (await request.get("/__qa/state")).json();
  expect(state.cart.item_count).toBe(1);
  expect(
    state.events.some((event: any) => event.type === "widget_impression"),
  ).toBe(false);
});

test("an offer API outage leaves the original cart add working", async ({
  page,
  request,
}) => {
  await request.post("/__qa/reset", { data: { failOffer: true } });
  await start(page);
  await page.getByRole("button", { name: "Add Shampoo" }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get("/__qa/state")).json()).offers.length,
    )
    .toBe(1);
  await page.waitForTimeout(2000);
  await expect(surface(page)).toHaveCount(0);
  expect(
    (await (await request.get("/__qa/state")).json()).cart.item_count,
  ).toBe(1);
});

test("a product that is unavailable in the current storefront is not rendered", async ({
  page,
  request,
}) => {
  await request.post("/__qa/reset", { data: { soldOut: true } });
  await start(page);
  await page.getByRole("button", { name: "Add Shampoo" }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get("/__qa/state")).json()).offers.length,
    )
    .toBe(1);
  await page.waitForTimeout(2000);
  await expect(surface(page)).toHaveCount(0);
  expect(
    (await (await request.get("/__qa/state")).json()).cart.item_count,
  ).toBe(1);
});
