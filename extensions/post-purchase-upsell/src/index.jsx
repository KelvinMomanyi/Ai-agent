import {
    extend,
    render,
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

// This runs BEFORE the post-purchase page is shown.
// Use it to decide whether to show an upsell offer.
export const ShouldRender = extend(
    "Checkout::PostPurchase::ShouldRender",
    async ({ inputData, storage }) => {
        // Call our AI upsell API to get a suggestion based on what was just purchased
        try {
            const lineItems = inputData.initialPurchase.lineItems;
            const cartItems = lineItems.map((item) => ({
                title: item.title,
                quantity: item.quantity,
                variant_id: item.variant?.id,
                product_title: item.title,
            }));

            // Store the cart context so the Render phase can use it
            await storage.update({ cartItems: JSON.stringify(cartItems) });

            // Show the post-purchase page
            return { render: true };
        } catch (error) {
            console.error("ShouldRender error:", error);
            return { render: false };
        }
    }
);

// This renders the actual post-purchase upsell UI
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

                // Call the upsell API
                const response = await fetch(
                    `${inputData.shop.storefrontUrl}/apps/upsell`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ cartItems }),
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
            // Extract numeric variant ID
            const variantId = upsellData.id.includes("/")
                ? upsellData.id.split("/").pop()
                : upsellData.id;

            const token = inputData.token;

            // Calculate what changes would look like
            const changeset = await calculateChangeset({
                changes: [
                    {
                        type: "add_variant",
                        variantId: parseInt(variantId, 10),
                        quantity: 1,
                        discount: upsellData.discount?.percentage ? {
                            value: upsellData.discount.percentage,
                            valueType: "percentage",
                            title: upsellData.discount.text || "AI Upsell Discount",
                        } : undefined,
                    },
                ],
            });

            // Apply the one-click purchase
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
                    <Text size="medium">Finding the perfect add-on for your order...</Text>
                </TextContainer>
            </BlockStack>
        );
    }

    if (!upsellData) {
        // No upsell available, silently complete
        done();
        return null;
    }

    return (
        <BlockStack spacing="loose">
            <CalloutBanner title="🎁 Exclusive One-Time Offer">
                <Text>
                    This special deal is only available right now — add it to your order
                    with one click!
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
                    {upsellData.image && (
                        <Image
                            source={upsellData.image}
                            alt={upsellData.title}
                            aspectRatio={1}
                            fit="cover"
                            cornerRadius="base"
                        />
                    )}
                </View>

                <View />

                <BlockStack spacing="tight">
                    <Heading>{upsellData.title}</Heading>
                    <Text size="large" emphasized>
                        ${upsellData.price}
                    </Text>
                    {upsellData.discount?.percentage && (
                        <Text size="small" appearance="success">
                            🔥 {upsellData.discount.percentage}% OFF applied automatically!
                        </Text>
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
                            {accepted ? "Adding..." : `Add to Order — $${upsellData.price}`}
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
