import { test, expect, type Page } from "@playwright/test";
test.beforeEach(async ({ context, request }) => {
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === "http://127.0.0.1:4179")
      await route.continue();
    else
      throw new Error(
        "Recommendation simulation attempted an external request",
      );
  });
  await request.post("/__qa/reset", { data: { agentCore: true } });
});
async function start(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener("aovboost:event", (event) => {
      const detail = (event as CustomEvent).detail;
      if (
        detail.type === "cart_update" &&
        detail.source === "initial_cart_state"
      )
        (window as any).__initialCart = true;
    });
  });
  await page.goto("/products/shampoo");
  await page.waitForFunction(() => (window as any).__initialCart === true);
}
const upsell = (page: Page) =>
  page.locator("[data-aovboost-widget='upsell_drawer']");
test("shares duplicate confirmed offer requests and verifies a product only once", async ({
  page,
  request,
}) => {
  await request.post("/__qa/reset", {
    data: { agentCore: true, offerDelayMs: 700 },
  });
  await start(page);
  const offerRequest = page.waitForRequest((request) =>
    request.url().endsWith("/apps/aovboost/offer"),
  );
  await page.getByRole("button", { name: "Add Shampoo" }).click();
  const body = (await offerRequest).postDataJSON();
  await page.evaluate(async (payload) => {
    await Promise.all([
      (window as any).AOVBoostSDK.requestOffer("cart_item_added", payload),
      (window as any).AOVBoostSDK.requestOffer("cart_item_added", payload),
    ]);
  }, body.triggerPayload);
  await expect(upsell(page)).toBeVisible();
  const state = await (await request.get("/__qa/state")).json();
  expect(state.offers).toHaveLength(1);
  expect(
    state.catalogReads.filter((url: string) => url.endsWith("conditioner.js")),
  ).toHaveLength(1);
  expect(
    await page.evaluate(
      () =>
        (window as any).AOVBoostSDK.diagnose().recommendations.coalescedOffers,
    ),
  ).toBeGreaterThanOrEqual(2);
});
test("uses native complementary ranking inside the approved pool when AI health is unavailable", async ({
  page,
  request,
}) => {
  await request.post("/__qa/reset", {
    data: { agentCore: true, aiDecision: true },
  });
  await start(page);
  await page.getByRole("button", { name: "Add Shampoo" }).click();
  await expect(upsell(page)).toBeVisible();
  await expect(
    upsell(page).getByText("Selected from this store's available products."),
  ).toBeVisible();
  const state = await (await request.get("/__qa/state")).json();
  expect(state.nativeRecommendations).toEqual([
    { productId: "1", intent: "complementary" },
  ]);
  expect(
    await page.evaluate(
      () => (window as any).AOVBoostSDK.diagnose().recommendations.fallbacks,
    ),
  ).toBe(1);
  await expect(
    upsell(page).getByText("Conditioner", { exact: true }),
  ).toBeVisible();
});
test("discards a late catalog response after the cart is emptied", async ({
  page,
  request,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/products/conditioner.js", async (route) => {
    await gate;
    try {
      await route.fulfill({
        json: { id: 2, variants: [{ id: 102, available: true, price: 1200 }] },
      });
    } catch {
      /* The mutation cancels this consumer. */
    }
  });
  try {
    await start(page);
    const loading = page.waitForRequest((request) =>
      request.url().endsWith("/products/conditioner.js"),
    );
    await page.getByRole("button", { name: "Add Shampoo" }).click();
    await loading;
    await page.evaluate(async () => {
      await fetch("/cart/change.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ line: 1, quantity: 0 }),
      });
    });
    release();
    await expect
      .poll(
        async () =>
          (await (await request.get("/__qa/state")).json()).cart.item_count,
      )
      .toBe(0);
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => (window as any).AOVBoostSDK.diagnose()))
            .widgets.mountedWidgetTypes,
      )
      .toEqual([]);
    await expect(upsell(page)).toHaveCount(0);
  } finally {
    release();
  }
});
test("keeps the legacy request path when the core flag is off", async ({
  page,
  request,
}) => {
  await request.post("/__qa/reset", { data: { aiDecision: true } });
  await start(page);
  await page.getByRole("button", { name: "Add Shampoo" }).click();
  await expect(upsell(page)).toBeVisible();
  const state = await (await request.get("/__qa/state")).json();
  expect(state.nativeRecommendations).toEqual([]);
  expect(
    await page.evaluate(
      () => (window as any).AOVBoostSDK.diagnose().recommendations,
    ),
  ).toBeUndefined();
});
for (const gate of ["holdout", "planDenied", "failOffer"] as const)
  test(`${gate} does not start a recommendation fallback`, async ({
    page,
    request,
  }) => {
    await request.post("/__qa/reset", {
      data: { agentCore: true, aiDecision: true, [gate]: true },
    });
    await start(page);
    const response = page.waitForResponse((response) =>
      response.url().endsWith("/apps/aovboost/offer"),
    );
    await page.getByRole("button", { name: "Add Shampoo" }).click();
    await response;
    await expect(upsell(page)).toHaveCount(0);
    const state = await (await request.get("/__qa/state")).json();
    expect(state.nativeRecommendations).toEqual([]);
    expect(
      state.catalogReads.filter((url: string) =>
        url.endsWith("conditioner.js"),
      ),
    ).toEqual([]);
  });
for (const type of ["bundle", "rec_strip"] as const)
  test(`${type} uses shared verification and its cart add never opens another upsell`, async ({
    page,
    request,
  }) => {
    await request.post("/__qa/reset", {
      data: { agentCore: true, catalogWidget: type },
    });
    await start(page);
    const surface = page.locator(`[data-aovboost-widget='${type}']`);
    await expect(surface).toBeVisible();
    const cartWrite = page.waitForRequest(
      (request) =>
        request.url().endsWith("/cart/add.js") && request.method() === "POST",
    );
    await surface
      .getByRole("button", {
        name: type === "bundle" ? "Add bundle to cart" : "Add to cart",
        exact: true,
      })
      .click();
    expect((await cartWrite).headers()["x-aovboost-source"]).toBe(
      type === "bundle" ? "aov_bundle" : "aov_strip",
    );
    await expect
      .poll(async () =>
        (await (await request.get("/__qa/state")).json()).events.some(
          (event: any) =>
            event.type === "accepted" && event.provider_id === type,
        ),
      )
      .toBe(true);
    const state = await (await request.get("/__qa/state")).json();
    expect(state.cart.item_count).toBe(type === "bundle" ? 2 : 1);
    expect(
      state.offers.filter((offer: any) => offer.trigger === "cart_item_added"),
    ).toHaveLength(0);
    await expect(upsell(page)).toHaveCount(0);
  });
