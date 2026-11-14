import { test, expect, type Page } from "@playwright/test";
const standard = new Set([
  "impression",
  "viewed",
  "interaction",
  "accepted",
  "dismissed",
  "suppressed",
  "would_have_shown",
]);
const upsell = (page: Page) =>
  page.locator("[data-aovboost-widget='upsell_drawer']");
test.beforeEach(async ({ context, request }) => {
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === "http://127.0.0.1:4179")
      await route.continue();
    else throw new Error("External request in local simulation");
  });
  await request.post("/__qa/reset", {
    data: { agentCore: true, measurement: false },
  });
});
async function configure(page: Page, percent: number) {
  await page.addInitScript((percent) => {
    (window as any).__standardSignals = [];
    document.addEventListener("aovboost:event", (event) => {
      const data = (event as CustomEvent).detail;
      if (data.provider_id)
        (window as any).__standardSignals.push({
          type: data.type,
          provider_id: data.provider_id,
        });
    });
    let config: any;
    Object.defineProperty(window, "AOVBoost", {
      configurable: true,
      get: () => config,
      set: (value) => {
        config = { ...value, agent_holdout_percent: percent };
      },
    });
  }, percent);
}
function capture(page: Page) {
  const events: any[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/apps/aovboost/events")) {
      const body = request.postDataJSON();
      events.push(
        ...(body?.events || []).filter(
          (event: any) => standard.has(event.type) && event.provider_id,
        ),
      );
    }
  });
  return events;
}
async function start(page: Page) {
  await page.goto(
    "/products/shampoo?email=private_fixture_email&token=private_fixture_token",
  );
  await page.waitForFunction(() => (window as any).AOVBoostSDK !== undefined);
}
test("frontend holdout mounts nothing, retains the shopper cart and records anonymous counterfactuals", async ({
  page,
  request,
}) => {
  const events = capture(page);
  await configure(page, 100);
  await start(page);
  await page.getByRole("button", { name: "Add Shampoo" }).click();
  await expect
    .poll(
      () =>
        events.filter(
          (event) =>
            event.type === "would_have_shown" &&
            event.provider_id === "cart_upsell",
        ).length,
    )
    .toBeGreaterThan(0);
  await expect(page.locator("[data-aovboost-widget]")).toHaveCount(0);
  const state = await (await request.get("/__qa/state")).json();
  expect(state.cart.item_count).toBe(1);
  expect(
    state.catalogReads.filter(
      (path: string) => path !== "/products/shampoo.js",
    ),
  ).toEqual([]);
  expect(state.nativeRecommendations).toEqual([]);
  expect(state.cart.attributes).toEqual({});
  const shadow = events.find((event) => event.type === "would_have_shown");
  expect(shadow).toMatchObject({
    holdout: true,
    holdout_source: "agent",
    holdout_percent: 100,
    holdout_version: 1,
  });
  expect(
    events.some((event) =>
      ["impression", "viewed", "accepted"].includes(event.type),
    ),
  ).toBe(false);
  expect(JSON.stringify(events)).not.toMatch(
    /private_fixture_email|private_fixture_token|sessionToken|Authorization/,
  );
  await page.reload();
  await page.waitForFunction(() => (window as any).AOVBoostSDK !== undefined);
  await expect(page.locator("[data-aovboost-widget]")).toHaveCount(0);
});
test("standard events join one refreshed acceptance to its offer while preserving legacy tracking", async ({
  page,
}) => {
  const events = capture(page);
  await configure(page, 0);
  await start(page);
  await page.getByRole("button", { name: "Add Shampoo" }).click();
  await expect(upsell(page)).toBeVisible();
  await page.waitForFunction(() =>
    (window as any).__standardSignals.some(
      (event: any) =>
        event.type === "viewed" && event.provider_id === "cart_upsell",
    ),
  );
  await upsell(page)
    .getByRole("button", { name: "Add to cart", exact: true })
    .click();
  await expect
    .poll(
      () =>
        events.filter(
          (event) =>
            event.type === "accepted" && event.provider_id === "cart_upsell",
        ).length,
    )
    .toBe(1);
  const accepted = events.find((event) => event.type === "accepted"),
    impression = events.find(
      (event) =>
        event.type === "impression" && event.offer_id === accepted.offer_id,
    ),
    viewed = events.find(
      (event) =>
        event.type === "viewed" && event.offer_id === accepted.offer_id,
    );
  expect(impression).toBeTruthy();
  expect(viewed).toBeTruthy();
  expect(viewed.ts - impression.ts).toBeGreaterThanOrEqual(1000);
  expect(accepted).toMatchObject({
    cart_source: "aov_upsell",
    trigger_signal: "cart_item_added",
    holdout: false,
    holdout_source: "agent",
    holdout_percent: 0,
  });
  expect(accepted.offerId).toBe(accepted.offer_id);
  expect(accepted.mutation_id).toBeTruthy();
  await page.evaluate(() => {
    (window as any).AOVBoostSDK.track("interaction", {
      provider_id: "cart_upsell",
      email: "private-injected",
      sessionToken: "private-injected",
      cartSnapshot: { token: "private-injected" },
      trigger_signal: "email@example.invalid",
      holdout: true,
    });
  });
  await page.waitForTimeout(5500);
  expect(JSON.stringify(events)).not.toMatch(
    /private-injected|private_fixture_email|private_fixture_token/,
  );
  for (const event of events) {
    expect(event.url).toBe("");
    expect(event.referrer).toBe("");
    expect(event.session_id).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(event.surface_class).toBeTruthy();
    expect(event.ai_healthy).not.toBeUndefined();
    expect(event.holdout).toBe(false);
  }
});
test("a signed server exposed arm stays authoritative over frontend 100 percent", async ({
  page,
  request,
}) => {
  await request.post("/__qa/reset", {
    data: { agentCore: true, measurement: true },
  });
  const events = capture(page);
  await configure(page, 100);
  await start(page);
  await page.getByRole("button", { name: "Add Shampoo" }).click();
  await expect(upsell(page)).toBeVisible();
  await expect
    .poll(() =>
      events.some(
        (event) =>
          event.type === "impression" &&
          event.holdout_source === "server" &&
          event.holdout === false,
      ),
    )
    .toBe(true);
  expect(
    (await (await request.get("/__qa/state")).json()).cart.attributes
      .__aovboost_measurement__,
  ).toBe("synthetic-measurement-link");
});
test("a later server holdout assignment removes an already visible offer", async ({
  page,
}) => {
  await configure(page, 0);
  await start(page);
  await page.getByRole("button", { name: "Add Shampoo" }).click();
  await expect(upsell(page)).toBeVisible();
  await page.evaluate(() => {
    const sdk = (window as any).AOVBoostSDK;
    sdk.applySession({
      shop: sdk.shop,
      sessionId: sdk.sessionId,
      sessionToken: "synthetic-not-a-real-token",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      settings: { chatEnabled: false, upsellEnabled: true },
      measurement: {
        arm: "holdout",
        version: 2,
        percent: 10,
        link: "synthetic-updated-measurement",
      },
    });
  });
  await expect(upsell(page)).toHaveCount(0);
});
test("consent gates assignment initialization and new event transmission", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (
      /\/apps\/aovboost\/(session|config|offer|events|chat)$/.test(
        request.url(),
      )
    )
      requests.push(request.url());
  });
  await page.addInitScript(() => {
    let config: any, shopify: any;
    (window as any).__allowed = false;
    Object.defineProperty(window, "AOVBoost", {
      configurable: true,
      get: () => config,
      set: (value) => {
        config = {
          ...value,
          agent_holdout_percent: 100,
          settings: { ...value?.settings, trackingConsentRequired: true },
        };
      },
    });
    Object.defineProperty(window, "Shopify", {
      configurable: true,
      get: () => shopify,
      set: (value) => {
        shopify = {
          ...value,
          customerPrivacy: {
            analyticsProcessingAllowed: () => (window as any).__allowed,
          },
        };
      },
    });
  });
  await page.goto("/products/shampoo");
  await page.waitForTimeout(250);
  expect(requests).toEqual([]);
  expect(
    await page.evaluate(() => (window as any).AOVBoostSDK),
  ).toBeUndefined();
  await page.evaluate(() => {
    (window as any).__allowed = true;
    document.dispatchEvent(new CustomEvent("visitorConsentCollected"));
  });
  await page.waitForFunction(() => (window as any).AOVBoostSDK !== undefined);
  await page.waitForTimeout(1000);
  const count = requests.filter((url) => url.endsWith("/events")).length;
  await page.evaluate(() => {
    (window as any).__allowed = false;
    (window as any).AOVBoostSDK.track("interaction", { provider_id: "chat" });
  });
  await page.waitForTimeout(250);
  expect(requests.filter((url) => url.endsWith("/events"))).toHaveLength(count);
  await expect(page.locator("[data-aovboost-widget]")).toHaveCount(0);
});
