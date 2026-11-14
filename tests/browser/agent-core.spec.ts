import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ context, request }) => {
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === "http://127.0.0.1:4179")
      await route.continue();
    else throw new Error("Local simulation attempted an external request");
  });
  await request.post("/__qa/reset", { data: { agentCore: true } });
});
async function start(page: Page, suffix = "") {
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
  await page.goto(`/products/shampoo${suffix}`);
  await page.waitForFunction(() => (window as any).__initialCart === true);
}
const surface = (page: Page) =>
  page.locator("[data-aovboost-widget='upsell_drawer']");
test("flagged shopper add shows once, accepted add is tagged and does not recurse", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  await expect(surface(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Add Shampoo" }).click();
  await expect(surface(page)).toBeVisible();
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
        (event: any) =>
          event.type === "accepted" && event.provider_id === "cart_upsell",
      ),
    )
    .toBe(true);
  const state = await (await request.get("/__qa/state")).json();
  expect(state.offers).toHaveLength(1);
  expect(
    state.events
      .filter((event: any) => event.type === "add_to_cart")
      .map((event: any) => event.cartSource),
  ).toEqual(["shopper", "aov_upsell"]);
  expect(errors).toEqual([]);
});
test("flagged Velour refresh preserves editable notes and updates totals after one accepted POST", async ({
  page,
  request,
}) => {
  await request.post("/__qa/reset", {
    data: { agentCore: true, mode: "velour" },
  });
  await start(page);
  await page.getByRole("button", { name: "Add Shampoo" }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(surface(page)).toBeVisible();
  await page
    .getByRole("textbox", { name: "Order notes" })
    .fill("Keep local instructions");
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/cart/add.js"))
      writes.push(request.url());
  });
  await surface(page)
    .getByRole("button", { name: "Add to cart", exact: true })
    .click();
  await expect(page.locator(".cart-subtotal__value")).toHaveText("$32.00");
  await expect(page.getByRole("textbox", { name: "Order notes" })).toHaveValue(
    "Keep local instructions",
  );
  await expect(page.locator("[data-cart-count]")).toHaveText("2");
  await expect(
    page.getByRole("spinbutton", { name: "Quantity for Conditioner" }),
  ).toHaveValue("1");
  expect(writes).toHaveLength(1);
});
test("debug records real cart candidates and checkout suppresses the mounted provider", async ({
  page,
}) => {
  await start(page, "?aov_debug=1");
  await page.getByRole("button", { name: "Add Shampoo" }).click();
  await expect(surface(page)).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).__AOVBOOST_DEBUG__
        .decisions()
        .some((decision: any) => decision.accepted.includes("cart_upsell")),
    ),
  ).toBe(true);
  await page.evaluate(() =>
    (window as any).AOVBoostSDK.track("checkout_clicked", {}),
  );
  await expect(surface(page)).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).__AOVBOOST_DEBUG__
          .decisions()
          .at(-1)
          .candidates.find((candidate: any) => candidate.id === "cart_upsell")
          .reason,
    ),
  ).toBe("checkout");
});
test("blocked session storage preserves flagged cart behavior with debug off and no console errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["error", "debug"].includes(message.type()))
      errors.push(message.text());
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new Error("Synthetic blocked storage");
      },
    });
  });
  await start(page);
  await page.getByRole("button", { name: "Add Shampoo" }).click();
  await expect(surface(page)).toBeVisible();
  await surface(page)
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(surface(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("flag off makes no core asset or health probe requests", async ({
  page,
  request,
}) => {
  await request.post("/__qa/reset", { data: {} });
  const unexpected: string[] = [];
  page.on("request", (request) => {
    if (/agent-core-|\/chat(?:\?|$)/.test(request.url()))
      unexpected.push(request.url());
  });
  await start(page);
  await page.getByRole("button", { name: "Add Shampoo" }).click();
  await expect(surface(page)).toBeVisible();
  expect(unexpected).toEqual([]);
});
test("flagged reduced-motion cart closes with Escape and returns focus", async ({
  page,
  request,
}) => {
  await request.post("/__qa/reset", {
    data: { agentCore: true, mode: "floating" },
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await start(page);
  const add = page.getByRole("button", { name: "Add Shampoo" });
  await add.click();
  await expect(surface(page)).toBeVisible();
  expect(
    await surface(page)
      .locator(".drawer")
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");
  await surface(page)
    .getByRole("button", { name: "Close", exact: true })
    .focus();
  await page.keyboard.press("Escape");
  await expect(surface(page)).toHaveCount(0);
  await expect(add).toBeFocused();
});
test("blocked assistant endpoint hides chat and dependent toast while cart recommendations work", async ({
  page,
  request,
}) => {
  await request.post("/__qa/reset", {
    data: { agentCore: true, chatEnabled: true },
  });
  await page.route("**/apps/aovboost/chat", (route) => route.abort());
  await start(page);
  await page.waitForFunction(() => {
    const sdk = (window as any).AOVBoostSDK;
    return sdk
      ?.diagnose()
      .recentDecisions.some((decision: any) => decision.widgetType === "chat");
  });
  await expect(
    page.locator(
      "[data-aovboost-widget='chat'],[data-aovboost-widget='toast']",
    ),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Add Shampoo" }).click();
  await expect(surface(page)).toBeVisible();
});
