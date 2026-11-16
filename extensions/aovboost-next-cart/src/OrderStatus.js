// Uses Shopify's sandbox DOM and Polaris web components; no UI framework.
export default async function () {
  const order = shopify.order.value;
  if (!order?.id || order.cancelledAt) return;
  const productIds = [
    ...new Set(shopify.lines.value.map((line) => line.merchandise.product.id)),
  ];
  if (!productIds.length) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    let anonymousId;
    try {
      anonymousId = await shopify.storage.read("aovboost_next_cart_visitor_v1");
    } catch {
      /* Storage is optional. */
    }
    const token = await shopify.sessionToken.get();
    const response = await fetch(
      "https://ai-agent-dusky-nine.vercel.app/api/order-picks",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ productIds, anonymousId }),
        signal: controller.signal,
      },
    );
    if (!response.ok) return;
    const data = await response.json();
    if (
      typeof data.anonymousId === "string" &&
      /^[0-9a-f-]{36}$/i.test(data.anonymousId)
    ) {
      try {
        await shopify.storage.write(
          "aovboost_next_cart_visitor_v1",
          data.anonymousId,
        );
      } catch {
        /* Storage is optional. */
      }
    }
    if (
      !data.product?.title ||
      !/^\/apps\/aovboost\/postadd\?offer=[a-zA-Z0-9_-]+$/.test(data.path || "")
    )
      return;
    const record = async (intent) => {
      const eventController = new AbortController();
      const eventTimeout = setTimeout(() => eventController.abort(), 3000);
      try {
        const eventToken = await shopify.sessionToken.get();
        await fetch("https://ai-agent-dusky-nine.vercel.app/api/order-picks", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${eventToken}`,
          },
          body: JSON.stringify({
            intent,
            anonymousId: data.anonymousId,
            offerId: data.offerId,
          }),
          signal: eventController.signal,
        });
      } catch {
        /* Telemetry cannot break the order page or its link. */
      } finally {
        clearTimeout(eventTimeout);
      }
    };
    const section = document.createElement("s-section");
    section.setAttribute("heading", "For your next cart");
    const text = document.createElement("s-text");
    text.textContent = `${data.product.title}. Add this to a new cart; your completed order stays as placed.`;
    const link = document.createElement("s-link");
    link.setAttribute(
      "href",
      new URL(data.path, shopify.shop.storefrontUrl).href,
    );
    link.textContent = "Choose options for your next cart";
    link.addEventListener("click", () => {
      void record("interaction");
    });
    const stack = document.createElement("s-stack");
    stack.setAttribute("gap", "base");
    stack.append(text, link);
    section.append(stack);
    document.body.append(section);
    void record("impression");
  } catch {
    /* An unavailable recommendation never blocks the order page. */
  } finally {
    clearTimeout(timeout);
  }
}
