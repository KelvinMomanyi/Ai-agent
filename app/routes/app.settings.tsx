import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
    Page,
    Layout,
    Text,
    Card,
    Button,
    BlockStack,
    TextField,
    FormLayout,
    Box,
    Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    let config = await prisma.shopConfig.findUnique({
        where: { shopDomain: shop },
    });

    if (!config) {
        // Return default values if no config exists yet
        return json({
            config: {
                discountPercentage: 10,
                offerStrategy: "Focus on high-value complementary items with a gentle discount sweetener.",
                minProductPrice: 20.0,
            },
        });
    }

    return json({ config });
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();

    const discountPercentage = parseInt(formData.get("discountPercentage") as string);
    const offerStrategy = formData.get("offerStrategy") as string;
    const minProductPrice = parseFloat(formData.get("minProductPrice") as string);

    try {
        const config = await prisma.shopConfig.upsert({
            where: { shopDomain: shop },
            update: {
                discountPercentage,
                offerStrategy,
                minProductPrice,
            },
            create: {
                shopDomain: shop,
                discountPercentage,
                offerStrategy,
                minProductPrice,
            },
        });

        return json({ success: true, config });
    } catch (error) {
        console.error("Error saving settings:", error);
        return json({ success: false, error: "Failed to save settings" });
    }
};

export default function Settings() {
    const { config } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const submit = useSubmit();

    const [formState, setFormState] = useState({
        discountPercentage: config.discountPercentage.toString(),
        offerStrategy: config.offerStrategy,
        minProductPrice: config.minProductPrice.toString(),
    });

    const isSaving =
        navigation.state === "submitting" || navigation.state === "loading";

    const handleSave = () => {
        submit(formState, { method: "post" });
    };

    return (
        <Page
            title="Upsell Settings"
            backAction={{ content: "Dashboard", url: "/app" }}
            primaryAction={{
                content: "Save settings",
                onAction: handleSave,
                loading: isSaving,
            }}
        >
            <Layout>
                {actionData?.success && (
                    <Layout.Section>
                        <Banner tone="success">Settings saved successfully!</Banner>
                    </Layout.Section>
                )}

                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text as="h2" variant="headingMd">
                                Discount Configuration
                            </Text>
                            <Text as="p" variant="bodyMd" tone="subdued">
                                Customize how the AI generates discounts for your upsell offers.
                            </Text>

                            <FormLayout>
                                <TextField
                                    label="Discount Percentage"
                                    type="number"
                                    value={formState.discountPercentage}
                                    onChange={(value) => setFormState({ ...formState, discountPercentage: value })}
                                    suffix="%"
                                    helpText="The AI will use this percentage for smart rewards (e.g., 5, 10, or 15)."
                                    autoComplete="off"
                                />

                                <TextField
                                    label="Minimum Product Price"
                                    type="number"
                                    value={formState.minProductPrice}
                                    onChange={(value) => setFormState({ ...formState, minProductPrice: value })}
                                    prefix="$"
                                    helpText="Only products above this price will be eligible for an AI-generated discount."
                                    autoComplete="off"
                                />

                                <TextField
                                    label="AI Offer Strategy"
                                    value={formState.offerStrategy}
                                    onChange={(value) => setFormState({ ...formState, offerStrategy: value })}
                                    multiline={4}
                                    helpText="Tell the AI how to pitch your products. Be specific about your brand's tone and primary goals."
                                    autoComplete="off"
                                />
                            </FormLayout>
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
