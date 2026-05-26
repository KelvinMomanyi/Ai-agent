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

export const ShouldRender = extend(
    "Checkout::PostPurchase::ShouldRender",
    async ({ inputData, storage }) => {
        try {
            const lineItems = inputData.initialPurchase.lineItems;
            const cartItems = lineItems.map((item) => ({
                title: item.title,
                quantity: item.quantity,
                variant_id: item.variant?.id,
                product_title: item.title,
            }));

            await storage.update({ cartItems: JSON.stringify(cartItems) });
            return { render: true };
        } catch (error) {
            console.error("ShouldRender error:", error);
            return { render: false };
        }
    }
);

render("Checkout::PostPurchase::Render", () => <PostPurchaseUpsell />);

function PostPurchaseUpsell() {
    const [loading, setLoading] = React.useState(true);
    const [upsellData, setUpsellData] = React.useState(null);
    const [accepted, setAccepted] = React.useState(false);
    const [declining, setDeclining] = React.useState(false);

    const { storage, inputData, calculateChangeset, applyChangeset, done } =
        useExtensionInput();

    React.useEffect(() => {
        async function fetchUpsell() {
            try {
                const storedData = await storage.initialData;
                const cartItems = JSON.parse(storedData.cartItems || "[]");

                const response = await fetch(
                    `${inputData.shop.storefrontUrl}/apps/upsell`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            cartItems,
                            behaviorContext: {
                                pageType: "post_purchase",
                                trafficSource: "checkout",
                                itemCount: cartItems.length,
                            },
                        }),
                    }
                );

                if (response.ok) {
                    const data = await response.json();
                    if (data.suggestion) {
                        let parsed = data.suggestion;
                        if (typeof parsed === "string") {
                            const jsonMatch = parsed.match(/\{[\s\S]*\}/);
                            if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
                        }
                        setUpsellData(parsed);
                    }
                }
            } catch (err) {
                console.error("Post-purchase upsell fetch error:", err);
            } finally {
                setLoading(false);
            }
        }

        fetchUpsell();
    }, []);

    async function handleAccept() {
        setAccepted(true);

        if (!upsellData?.id) {
            done();
            return;
        }

        try {
            const token = inputData.token;
            const offerItems = getOfferItems(upsellData);
            const changeset = await calculateChangeset({
                changes: offerItems.map((item) => {
                    const variantId = item.id.includes("/")
                        ? item.id.split("/").pop()
                        : item.id;

                    return {
                        type: "add_variant",
                        variantId: parseInt(variantId, 10),
                        quantity: 1,
                        discount: upsellData.discount?.percentage
                            ? {
                                value: upsellData.discount.percentage,
                                valueType: "percentage",
                                title: upsellData.discount.text || "AI Revenue Engine Discount",
                            }
                            : undefined,
                    };
                }),
            });

            await applyChangeset(token, changeset);
            done();
        } catch (err) {
            console.error("Accept upsell error:", err);
            done();
        }
    }

    function handleDecline() {
        setDeclining(true);
        done();
    }

    if (loading) {
        return (
            <BlockStack spacing="loose" alignment="center">
                <TextContainer>
                    <Text size="medium">Building a relevant post-purchase offer...</Text>
                </TextContainer>
            </BlockStack>
        );
    }

    if (!upsellData) {
        done();
        return null;
    }

    const offerItems = getOfferItems(upsellData);
    const primaryItem = offerItems[0];
    const offerPrice = upsellData.bundle?.discountedTotal || upsellData.price;

    return (
        <BlockStack spacing="loose">
            <CalloutBanner title={upsellData.modeLabel || "AI Revenue Engine Offer"}>
                <Text>
                    This offer was selected for your order context and can be added with one click.
                </Text>
            </CalloutBanner>

            <Layout
                media={[
                    { viewportSize: "small", sizes: [1, 0, 1], maxInlineSize: 0.9 },
                    { viewportSize: "medium", sizes: [0.4, 0.1, 0.5], maxInlineSize: 0.95 },
                    { viewportSize: "large", sizes: [0.4, 0.1, 0.5], maxInlineSize: 0.7 },
                ]}
            >
                <View>
                    {primaryItem?.image && (
                        <Image
                            source={primaryItem.image}
                            alt={primaryItem.title}
                            aspectRatio={1}
                            fit="cover"
                            cornerRadius="base"
                        />
                    )}
                </View>

                <View />

                <BlockStack spacing="tight">
                    <Heading>{upsellData.bundle?.title || upsellData.title}</Heading>
                    <Text size="large" emphasized>
                        ${offerPrice}
                    </Text>
                    {upsellData.discount?.percentage && (
                        <Text size="small" appearance="success">
                            {upsellData.discount.percentage}% off applied automatically.
                        </Text>
                    )}
                    {offerItems.length > 1 && (
                        <TextContainer>
                            <Text>{offerItems.map((item) => item.title).join(" + ")}</Text>
                        </TextContainer>
                    )}
                    <TextContainer>
                        <Text>{upsellData.message}</Text>
                    </TextContainer>

                    <BlockStack spacing="tight">
                        <Button
                            onPress={handleAccept}
                            submit
                            loading={accepted}
                            disabled={declining}
                        >
                            {accepted ? "Adding..." : `Add to order - $${offerPrice}`}
                        </Button>
                        <Button
                            onPress={handleDecline}
                            subdued
                            loading={declining}
                            disabled={accepted}
                        >
                            No thanks, complete my order
                        </Button>
                    </BlockStack>
                </BlockStack>
            </Layout>
        </BlockStack>
    );
}

function getOfferItems(offer) {
    if (offer?.bundle?.items?.length) return offer.bundle.items;

    return [
        {
            id: offer.id,
            title: offer.title,
            price: offer.price,
            image: offer.image,
        },
    ];
}
