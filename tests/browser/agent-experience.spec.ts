import { test, expect, type Page } from "@playwright/test";
const dock = (page: Page) => page.locator("[data-aovboost-widget='chat']");
const chat = (page: Page) =>
  page.locator("[data-aovboost-widget='chat_window']");
const toast = (page: Page) => page.locator("[data-aovboost-widget='toast']");
const exit = (page: Page) =>
  page.locator("[data-aovboost-widget='exit_intent']");
const stream = (delta: string, extra: Record<string, unknown> = {}) =>
  `data: ${JSON.stringify({ delta, ...extra })}\n\ndata: [DONE]\n\n`;
test.beforeEach(async ({ context, request }) => {
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === "http://127.0.0.1:4179")
      await route.continue();
    else throw new Error("External request in local simulation");
  });
  await request.post("/__qa/reset", {
    data: { agentCore: true, chatEnabled: true },
  });
});
async function start(page: Page) {
  await page.route("**/apps/aovboost/offer", async (route) => {
    const data = route.request().postDataJSON();
    const widgetType =
      data.trigger === "price_hesitation"
        ? "toast"
        : data.trigger === "exit_intent"
          ? "exit_intent"
          : "chat";
    await route.fulfill({
      json: { widgetType, payload: { offerId: `experience-${widgetType}` } },
    });
  });
  await page.goto("/products/shampoo");
  await expect(
    dock(page).getByRole("button", { name: "Open assistant", exact: true }),
  ).toBeVisible();
}
test("quiet launcher loads conversation on gesture, hands off product context and retains the session conversation privately", async ({
  page,
}) => {
  const assets: string[] = [],
    requests: any[] = [],
    errors: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("ChatConversation")) assets.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/apps/aovboost/chat", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { ok: true } });
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      contentType: "text/event-stream",
      body: stream("Shampoo is the product you're viewing."),
    });
  });
  await start(page);
  expect(assets).toHaveLength(0);
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent("aovboost:open-chat", {
        detail: { userInitiated: true, trigger: "launcher" },
      }),
    ),
  );
  expect(assets).toHaveLength(0);
  await expect(chat(page)).toHaveCount(0);
  await expect(toast(page)).toHaveCount(0);
  await expect(exit(page)).toHaveCount(0);
  await dock(page)
    .getByRole("button", { name: "Open assistant", exact: true })
    .click();
  await expect(chat(page).getByRole("dialog")).toBeVisible();
  await expect(chat(page)).toContainText(
    "What would you like to know about Shampoo?",
  );
  expect(assets).toHaveLength(1);
  await chat(page)
    .getByRole("textbox", { name: "Chat message" })
    .fill("private-synthetic-conversation");
  await chat(page).getByRole("button", { name: "Send", exact: true }).click();
  await expect(chat(page)).toContainText(
    "Shampoo is the product you're viewing.",
  );
  expect(requests[0].storefrontContext).toMatchObject({
    productId: "gid://shopify/Product/1",
    variantId: "gid://shopify/ProductVariant/101",
  });
  expect(requests[0].cartContext.status).toBe("loaded");
  const saved = await page.evaluate(() =>
    JSON.stringify({ ...sessionStorage, ...localStorage }),
  );
  expect(saved).not.toContain("private-synthetic-conversation");
  await chat(page).getByRole("button", { name: "Close assistant" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    chat(page).getByRole("button", { name: "Send", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(chat(page)).toBeHidden();
  await expect(
    dock(page).getByRole("button", { name: "Open assistant", exact: true }),
  ).toBeFocused();
  await dock(page)
    .getByRole("button", { name: "Open assistant", exact: true })
    .click();
  await expect(chat(page)).toContainText("private-synthetic-conversation");
  expect(assets).toHaveLength(1);
  expect(errors).toEqual([]);
});
test("real product dwell shows one desktop toast; focus pauses expiry and CTA opens the same conversation", async ({
  page,
  isMobile,
}) => {
  test.skip(
    isMobile,
    "Toast remains explicitly desktop-only; mobile uses the launcher and exit bottom sheet.",
  );
  await page.clock.install();
  await start(page);
  await page.clock.fastForward(20_100);
  await expect(toast(page)).toBeVisible();
  await expect(toast(page)).toContainText("Shampoo");
  const cta = toast(page).getByRole("button", { name: "Ask the assistant" });
  await cta.focus();
  await page.clock.fastForward(15_000);
  await expect(toast(page)).toBeVisible();
  await cta.click();
  await expect(toast(page)).toHaveCount(0);
  await expect(chat(page)).toContainText(
    "What would you like to know about Shampoo?",
  );
});
test("engaged exit intent shows once, with a mobile bottom sheet and a real cart CTA", async ({
  page,
  request,
  isMobile,
}) => {
  await request.post("/__qa/reset", {
    data: { agentCore: true, chatEnabled: true, restored: true },
  });
  await start(page);
  if (isMobile) {
    await page.addStyleTag({ content: "body{min-height:3000px}" });
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(60);
    await page.evaluate(() => window.scrollTo(0, 0));
  } else
    await page.evaluate(() =>
      document.dispatchEvent(new MouseEvent("mouseleave", { clientY: 0 })),
    );
  await expect(exit(page).getByRole("dialog")).toBeVisible();
  await expect(
    exit(page).getByRole("link", { name: "Review cart" }),
  ).toHaveAttribute("href", "/cart");
  if (isMobile) {
    const box = await exit(page).getByRole("dialog").boundingBox();
    expect(
      Math.abs(box!.y + box!.height - page.viewportSize()!.height),
    ).toBeLessThan(2);
  }
  await page.keyboard.press("Escape");
  await expect(exit(page)).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).AOVBoostSDK.trigger("exit_intent", { immediate: true });
  });
  await page.waitForTimeout(400);
  await expect(exit(page)).toHaveCount(0);
});
test("active chat and checkout suppress new exit offers", async ({ page }) => {
  await start(page);
  await dock(page)
    .getByRole("button", { name: "Open assistant", exact: true })
    .click();
  await expect(chat(page).getByRole("dialog")).toBeVisible();
  await page.evaluate(() => {
    const sdk = (window as any).AOVBoostSDK;
    sdk.track("page_view", {});
    sdk.trigger("exit_intent", { immediate: true });
  });
  await page.waitForTimeout(400);
  await expect(exit(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const sdk = (window as any).AOVBoostSDK;
    sdk.track("checkout_clicked", {});
    sdk.requestOffer("exit_intent", { immediate: true });
  });
  await page.waitForTimeout(400);
  await expect(exit(page)).toHaveCount(0);
});
test("a failed reply remains visible and retryable while the circuit records the failure", async ({
  page,
}) => {
  let posts = 0;
  await page.route("**/apps/aovboost/chat", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { ok: true } });
    ++posts;
    if (posts === 1)
      return route.fulfill({
        status: 503,
        json: { error: "Synthetic AI outage" },
      });
    return route.fulfill({
      contentType: "text/event-stream",
      body: stream("The assistant is connected again."),
    });
  });
  await start(page);
  await dock(page)
    .getByRole("button", { name: "Open assistant", exact: true })
    .click();
  await chat(page)
    .getByRole("button", { name: "Tell me about this product", exact: true })
    .click();
  await expect(
    chat(page).getByRole("button", { name: "Retry message" }),
  ).toBeVisible();
  await expect(
    chat(page).getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  expect(posts).toBe(1);
  await chat(page).getByRole("button", { name: "Retry message" }).click();
  await expect(chat(page)).toContainText("The assistant is connected again.");
  expect(posts).toBe(2);
});
async function productReply(page: Page) {
  await page.route("**/apps/aovboost/chat", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { ok: true } });
    return route.fulfill({
      contentType: "text/event-stream",
      body: stream("Here is Conditioner.", {
        productCards: [
          {
            productId: "gid://shopify/Product/2",
            title: "Conditioner",
            handle: "conditioner",
            variantId: "gid://shopify/ProductVariant/102",
            price: "12.00",
            availableForSale: true,
            variants: [
              {
                id: "gid://shopify/ProductVariant/102",
                title: "Default",
                price: "12.00",
              },
            ],
          },
        ],
      }),
    });
  });
  await start(page);
  await dock(page)
    .getByRole("button", { name: "Open assistant", exact: true })
    .click();
  await chat(page)
    .getByRole("button", { name: "Tell me about this product", exact: true })
    .click();
  await expect(
    chat(page).getByRole("button", { name: "Add to cart", exact: true }),
  ).toBeVisible();
}
test("chat product cards add and undo without triggering cart upsell", async ({
  page,
  request,
}) => {
  await productReply(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/cart\/(add|change)\.js$/.test(request.url())
    )
      writes.push(request.url());
  });
  await chat(page)
    .getByRole("button", { name: "Add to cart", exact: true })
    .click();
  await expect(
    chat(page).getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();
  expect(
    (await (await request.get("/__qa/state")).json()).cart.item_count,
  ).toBe(1);
  await chat(page).getByRole("button", { name: "Undo", exact: true }).click();
  await expect(chat(page)).toContainText("Cart action undone.");
  await expect(
    chat(page).getByRole("button", { name: "Add to cart", exact: true }),
  ).toBeEnabled();
  expect(
    (await (await request.get("/__qa/state")).json()).cart.item_count,
  ).toBe(0);
  expect(writes).toHaveLength(2);
  await expect(
    page.locator("[data-aovboost-widget='upsell_drawer']"),
  ).toHaveCount(0);
});
test("undo refuses to change a cart that was edited elsewhere", async ({
  page,
  request,
}) => {
  await productReply(page);
  await chat(page)
    .getByRole("button", { name: "Add to cart", exact: true })
    .click();
  await expect(
    chat(page).getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();
  await request.post("/cart/add.js", { data: { id: 101, quantity: 1 } });
  await chat(page).getByRole("button", { name: "Undo", exact: true }).click();
  await expect(chat(page)).toContainText("Your cart changed.");
  expect(
    (await (await request.get("/__qa/state")).json()).cart.item_count,
  ).toBe(2);
});
test("lazy UI load failure offers an explicit page reload and recovers on the next gesture", async ({
  page,
}) => {
  await page.route("**/*ChatConversation*.js", (route) => route.abort());
  await start(page);
  await dock(page)
    .getByRole("button", { name: "Open assistant", exact: true })
    .click();
  await expect(dock(page)).toContainText("Reload the page to try again.");
  await page.unroute("**/*ChatConversation*.js");
  await dock(page).getByRole("button", { name: "Reload page" }).click();
  await dock(page)
    .getByRole("button", { name: "Open assistant", exact: true })
    .click();
  await expect(chat(page).getByRole("dialog")).toBeVisible();
});
test("two toast dismissals silence later interruptive offers in this session", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Toast is explicitly desktop-only.");
  await page.clock.install();
  await start(page);
  await page.clock.fastForward(20_100);
  await expect(toast(page)).toBeVisible();
  await toast(page)
    .getByRole("button", { name: "Dismiss notification" })
    .click();
  await expect(toast(page)).toHaveCount(0);
  await page.clock.fastForward(600_001);
  await page.evaluate(() =>
    (window as any).AOVBoostSDK.requestOffer("price_hesitation", {}),
  );
  await expect(toast(page)).toBeVisible();
  await toast(page)
    .getByRole("button", { name: "Dismiss notification" })
    .click();
  await page.clock.fastForward(600_001);
  await page.evaluate(() => {
    const sdk = (window as any).AOVBoostSDK;
    sdk.track("page_view", {});
    sdk.trigger("exit_intent", { immediate: true });
  });
  await page.waitForTimeout(400);
  await expect(exit(page)).toHaveCount(0);
  await expect(toast(page)).toHaveCount(0);
});
test("exit CTA hands the current product to chat without a blank conversation", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    const sdk = (window as any).AOVBoostSDK;
    sdk.track("page_view", {});
    // Match EventBus.trackPageView: a page view is followed by product metadata.
    sdk.track("product_viewed", {
      productId: "gid://shopify/Product/1",
      title: "Shampoo",
      handle: "shampoo",
    });
    sdk.trigger("exit_intent", { immediate: true });
  });
  await expect(exit(page).getByRole("dialog")).toBeVisible();
  await exit(page).getByRole("button", { name: "Ask the assistant" }).click();
  await expect(exit(page)).toHaveCount(0);
  await expect(chat(page)).toContainText(
    "What would you like to know about Shampoo?",
  );
});
test("blocked storage, reduced motion and a delayed lazy load leave the page stable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    for (const name of ["sessionStorage", "localStorage"])
      Object.defineProperty(window, name, {
        get() {
          throw new Error("Synthetic blocked storage");
        },
      });
    (window as any).__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if (!(entry as any).hadRecentInput)
          (window as any).__shifts.push((entry as any).value);
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/*ChatConversation*.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.continue();
  });
  await start(page);
  const before = await page.locator("main").boundingBox();
  const clsBefore = await page.evaluate(() =>
    (window as any).__shifts.reduce(
      (sum: number, value: number) => sum + value,
      0,
    ),
  );
  await dock(page)
    .getByRole("button", { name: "Open assistant", exact: true })
    .click();
  await expect(chat(page).getByRole("dialog")).toBeVisible();
  expect(await page.locator("main").boundingBox()).toEqual(before);
  expect(
    await page.evaluate(() =>
      (window as any).__shifts.reduce(
        (sum: number, value: number) => sum + value,
        0,
      ),
    ),
  ).toBe(clsBefore);
  expect(
    await chat(page).evaluate(
      (node) =>
        Array.from(node.shadowRoot!.querySelectorAll("*"))
          .flatMap((element) => element.getAnimations())
          .filter((animation) => animation.playState === "running").length,
    ),
  ).toBe(0);
  expect(errors).toEqual([]);
});
