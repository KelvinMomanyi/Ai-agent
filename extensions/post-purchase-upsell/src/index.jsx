import React from "react";
import {
  extend,
  render,
  useExtensionInput,
  BlockStack,
  Button,
  CalloutBanner,
  Heading,
  Image,
  Text,
  TextContainer,
  Layout,
  View,
} from "@shopify/post-purchase-ui-extensions-react";

const APP_URL = "https://ai-agent-plum-eight.vercel.app";

export const ShouldRender = extend(
  "Checkout::PostPurchase::ShouldRender",
  async ({ inputData, storage }) => {
    try {
      const purchase = inputData.initialPurchase;
      const data = await apiRequest("/api/post-purchase-offer", inputData.token, {
        referenceId: purchase.referenceId,
        purchasedVariantIds: purchase.lineItems.map((line) => line.product.variant.id),
      });
      const offer = Array.isArray(data.offers) ? data.offers[0] : null;
      if (!offer) return { render: false };

      await storage.update({
        offer,
        referenceId: purchase.referenceId,
        currencyCode: purchase.totalPriceSet.presentmentMoney.currencyCode,
      });
      return { render: true };
    } catch (error) {
      console.error("AOVBoost post-purchase selection failed", error);
      return { render: false };
    }
  },
);

render("Checkout::PostPurchase::Render", () => <PostPurchaseUpsell />);

function PostPurchaseUpsell() {
  const { storage, inputData, calculateChangeset, applyChangeset, done } =
    useExtensionInput();
  const initial = storage.initialData || {};
  const offer = initial.offer;
  const changes = offer?.changes;
  const referenceId = initial.referenceId;
  const currencyCode = initial.currencyCode || "USD";
  const [calculation, setCalculation] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let active = true;
    if (!changes?.length) {
      done();
      return () => {
        active = false;
      };
    }

    calculateChangeset({ changes })
      .then((result) => {
        if (!active) return;
        if (result.status === "processed") setCalculation(result.calculatedPurchase);
        else setError(result.errors?.[0]?.message || "This offer is no longer available.");
      })
      .catch(() => active && setError("This offer could not be calculated."));
    return () => {
      active = false;
    };
  }, [calculateChangeset, changes, done]);

  async function handleAccept() {
    if (!calculation || busy) return;
    setBusy(true);
    setError("");
    try {
      const signed = await apiRequest("/api/post-purchase-sign", inputData.token, {
        referenceId,
        offerId: offer.id,
      });
      const result = await applyChangeset(signed.token);
      if (result.status !== "processed") {
        throw new Error(result.errors?.[0]?.message || "The item could not be added.");
      }
      await apiRequest("/api/post-purchase-convert", inputData.token, {
        referenceId,
        offerId: offer.id,
      });
      await done();
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : "The item could not be added.");
    }
  }

  if (!offer) return null;
  const product = offer.product || {};
  const calculatedLine = calculation?.updatedLineItems?.find(
    (line) => String(line.variantId) === String(offer.changes[0]?.variantId),
  );
  const calculatedPrice = calculatedLine?.totalPriceSet?.presentmentMoney?.amount;
  const price = calculatedPrice || offer.discountedPrice;

  return (
    <BlockStack spacing="loose">
      <CalloutBanner title="One-time post-purchase offer">
        <Text>Add this item to your existing order without re-entering payment details.</Text>
      </CalloutBanner>
      <Layout
        media={[
          { viewportSize: "small", sizes: [1, 0, 1], maxInlineSize: 0.9 },
          { viewportSize: "medium", sizes: [0.4, 0.1, 0.5], maxInlineSize: 0.95 },
          { viewportSize: "large", sizes: [0.4, 0.1, 0.5], maxInlineSize: 0.7 },
        ]}
      >
        <View>
          {product.imageUrl ? (
            <Image
              source={product.imageUrl}
              alt={product.title || "Recommended product"}
              aspectRatio={1}
              fit="cover"
              cornerRadius="base"
            />
          ) : null}
        </View>
        <View />
        <BlockStack spacing="tight">
          <Heading>{product.title || "Recommended product"}</Heading>
          <Text size="large" emphasized>
            {formatMoney(price, currencyCode)}
          </Text>
          {offer.discountPercentage > 0 ? (
            <Text size="small" appearance="success">
              {offer.discountPercentage}% off applied automatically
            </Text>
          ) : null}
          {error ? (
            <TextContainer>
              <Text appearance="critical">{error}</Text>
            </TextContainer>
          ) : null}
          <BlockStack spacing="tight">
            <Button onPress={handleAccept} submit loading={busy} disabled={!calculation}>
              Add to my order — {formatMoney(price, currencyCode)}
            </Button>
            <Button onPress={done} subdued disabled={busy}>
              No thanks
            </Button>
          </BlockStack>
        </BlockStack>
      </Layout>
    </BlockStack>
  );
}

async function apiRequest(path, token, body) {
  const response = await fetch(`${APP_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function formatMoney(value, currencyCode) {
  const amount = Number(value || 0);
  return `${currencyCode} ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}
