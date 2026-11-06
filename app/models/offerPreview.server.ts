import prisma from "../db.server";
import {
  getCatalogProductsByIds,
  getRecommendationCatalog,
} from "./catalogCache.server";
import {
  enforceCatalogBackedDecision,
  filterCatalogProducts,
  catalogProductToWidgetProduct,
} from "./catalogGuard.server";
import { selectPairingRecommendations } from "./pairingRecommendations.server";

export async function getAdminOfferPreview(
  shop: string,
  sourceProductId?: string,
) {
  const [settings, catalog] = await Promise.all([
    prisma.appSettings.findUnique({
      where: { shop },
      select: {
        blockedProductIds: true,
        excludedCollectionIds: true,
        maxProductRecommendations: true,
        preferredProductIds: true,
        upsellPriorityProductIds: true,
        pairingMode: true,
        pairingStrictness: true,
        pairingSensitiveKeywords: true,
      },
    }),
    getRecommendationCatalog({ shop, sourceProductId }),
  ]);
  const blocked = settings?.blockedProductIds || [];
  const excludedCollections = new Set(settings?.excludedCollectionIds || []);
  const eligible = (products: typeof catalog.products) =>
    filterCatalogProducts(products, blocked).filter(
      (product) =>
        !(product.collectionIds || []).some((id) =>
          excludedCollections.has(id),
        ),
    );
  const products = eligible(catalog.products);
  const source = sourceProductId
    ? products.find((product) => product.id === sourceProductId)
    : products[0];
  const sources = products.slice(0, 50).map(({ id, title }) => ({ id, title }));
  if (!source) return { sources, source: null, products: [] };
  const fresh = eligible(await getCatalogProductsByIds(shop, [source.id]));
  const freshSource = fresh.find(({ id }) => id === source.id);
  if (!freshSource) return { sources, source: null, products: [] };
  const selected = await selectPairingRecommendations({
    shop,
    sourceProductId: source.id,
    settings: {
      pairingMode: settings?.pairingMode,
      pairingStrictness: settings?.pairingStrictness,
      pairingSensitiveKeywords: settings?.pairingSensitiveKeywords,
      blockedProductIds: blocked,
      excludedCollectionIds: settings?.excludedCollectionIds || [],
      preferredProductIds: settings?.preferredProductIds || [],
      upsellPriorityProductIds: settings?.upsellPriorityProductIds || [],
    },
    limit: Math.min(2, Math.max(1, settings?.maxProductRecommendations || 2)),
  });
  const decision = await enforceCatalogBackedDecision({
    shop,
    excludedProductIds: [...blocked, source.id],
    decision: {
      widgetType: "upsell_drawer",
      aiProvider: "heuristic",
      confidence: 1,
      reasoning: "Admin catalog preview only.",
      payload: {
        products: selected.map(({ product, reason }) => ({
          productId: product.id,
          reason,
        })),
      },
    },
  });
  const cards = Array.isArray(decision.payload.products)
    ? decision.payload.products
    : [];
  return {
    sources,
    source: previewProduct(catalogProductToWidgetProduct(freshSource)),
    products: cards.map((item) => {
      const record = item as {
        product: ReturnType<typeof catalogProductToWidgetProduct>;
        reason: string;
      };
      return { ...previewProduct(record.product), reason: record.reason };
    }),
  };
}

function previewProduct(
  product: ReturnType<typeof catalogProductToWidgetProduct>,
) {
  // Explicit admin card shape; no raw inventory, costs or variant internals.
  return {
    id: product.id,
    title: product.title,
    price: product.price,
    imageUrl: product.imageUrl,
    handle: product.handle,
  };
}
