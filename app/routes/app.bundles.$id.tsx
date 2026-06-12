import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useActionData, useLoaderData } from "@remix-run/react";
import { Banner, BlockStack, Layout, Page } from "@shopify/polaris";
import { BundleForm } from "../components/bundles/BundleForm";
import prisma from "../db.server";
import {
  getBundle,
  saveBundle,
  type BundleInput,
} from "../models/bundle.server";
import { authenticate } from "../shopify.server";

type BundleItemInput = {
  productId: string;
  quantity: number;
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const id = params.id || "new";
  const [bundle, products] = await Promise.all([
    id === "new" ? Promise.resolve(null) : getBundle(session.shop, id),
    prisma.product.findMany({
      where: { shop: session.shop },
      orderBy: { title: "asc" },
      take: 250,
    }),
  ]);

  if (id !== "new" && !bundle) {
    throw new Response("Bundle not found", { status: 404 });
  }

  return json({
    id,
    bundle: bundle
      ? {
          id: bundle.id,
          name: bundle.name,
          description: bundle.description || "",
          discountType: bundle.discountType as "none" | "percentage" | "fixed",
          discountValue: bundle.discountValue.toString(),
          triggerProductIds: bundle.triggerProductIds,
          isActive: bundle.isActive,
          priority: bundle.priority,
          items: bundle.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
        }
      : {
          name: "",
          description: "",
          discountType: "none" as const,
          discountValue: "0",
          triggerProductIds: [] as string[],
          isActive: true,
          priority: 0,
          items: [] as BundleItemInput[],
        },
    products: products.map((product) => ({
      id: product.id,
      title: product.title,
    })),
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const input = parseBundleInput(formData);
  const errors = validateBundle(input);

  if (Object.keys(errors).length > 0) {
    return json({ errors }, { status: 400 });
  }

  try {
    await saveBundle(session.shop, params.id || "new", input);
  } catch (error) {
    return json(
      {
        errors: {
          items:
            error instanceof Error
              ? error.message
              : "Bundle products must exist in this store.",
        },
      },
      { status: 400 },
    );
  }

  return redirect("/app/bundles");
};

export default function BundleEditor() {
  const { id, bundle, products } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <Page
      title={id === "new" ? "Create bundle" : "Edit bundle"}
      backAction={{ content: "Bundles", url: "/app/bundles" }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {actionData?.errors ? (
              <Banner tone="critical">
                Fix the highlighted fields before saving.
              </Banner>
            ) : null}
            <BundleForm
              bundle={bundle}
              products={products}
              errors={actionData?.errors || {}}
            />
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function parseBundleInput(formData: FormData): BundleInput {
  const items = parseJson<BundleItemInput[]>(formData.get("items"), []);
  const triggerProductIds = parseJson<string[]>(
    formData.get("triggerProductIds"),
    [],
  );

  return {
    name: String(formData.get("name") || "").trim(),
    description: String(formData.get("description") || "").trim(),
    discountType: normalizeDiscountType(formData.get("discountType")),
    discountValue: String(formData.get("discountValue") || "0"),
    triggerProductIds: triggerProductIds.map(String).filter(Boolean),
    isActive: String(formData.get("isActive")) === "true",
    priority: clampNumber(
      parseInt(String(formData.get("priority") || "0"), 10),
      0,
      100,
    ),
    items: items
      .map((item) => ({
        productId: String(item.productId || ""),
        quantity: Math.max(Number(item.quantity || 1), 1),
      }))
      .filter((item) => item.productId),
  };
}

function validateBundle(input: BundleInput) {
  const errors: Record<string, string> = {};
  if (!input.name) errors.name = "Bundle name is required";
  if (input.items.length === 0) errors.items = "Add at least one bundle item";
  if (input.triggerProductIds.length === 0) {
    errors.triggerProductIds = "Add at least one trigger product";
  }
  return errors;
}

function normalizeDiscountType(value: FormDataEntryValue | null) {
  if (value === "percentage" || value === "fixed" || value === "none") {
    return value;
  }
  return "none";
}

function parseJson<T>(value: FormDataEntryValue | null, fallback: T): T {
  try {
    return JSON.parse(String(value || "")) as T;
  } catch {
    return fallback;
  }
}

function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}
