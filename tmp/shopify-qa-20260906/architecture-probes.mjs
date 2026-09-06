// Read-only regression probes against the actual TypeScript source.
// No storefront, provider, database, or other network calls are made.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const nativeRequire = createRequire(import.meta.url);
const cache = new Map();
let purchased = false;
const databaseStub = {
  recommendationOutcome: {
    updateMany: async () => {
      const count = purchased ? 0 : 1;
      purchased = true;
      return { count };
    },
  },
  shopperSession: { updateMany: async () => ({ count: 1 }) },
};

function loadSource(relativePath) {
  const filename = path.resolve(root, relativePath);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  let source = readFileSync(filename, 'utf8');
  if (relativePath.replaceAll('\\', '/').endsWith('eventBus.ts')) {
    source += '\nexport { getCartPayload };\n';
  }
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const localRequire = (specifier) => {
    if (specifier.endsWith('/db.server')) {
      return { __esModule: true, default: databaseStub };
    }
    if (!specifier.startsWith('.')) return nativeRequire(specifier);
    const base = path.resolve(path.dirname(filename), specifier);
    const resolved = [base, base + '.ts', base + '.tsx'].find(existsSync);
    if (!resolved) throw new Error('Unresolved source dependency: ' + specifier);
    return loadSource(path.relative(root, resolved));
  };
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: localRequire,
    console,
    FormData,
    URLSearchParams,
  }, { filename });
  return module.exports;
}

const profileModule = loadSource('app/sales/shopperProfile.ts');
const sessionModule = loadSource('app/models/session.server.ts');
const recommendationModule = loadSource('app/sales/recommendationEngine.ts');
const proactiveModule = loadSource('app/sales/proactiveEngine.ts');
const settingsModule = loadSource('app/sales/settings.ts');
const eventsModule = loadSource('storefront-sdk/src/eventBus.ts');
const outcomesModule = loadSource('app/models/recommendationOutcome.server.ts');
const settings = settingsModule.toMerchantSalesSettings({
  chatEnabled: true, bundlesEnabled: true,
});
const results = [];
function check(name, actual, expected) {
  results.push({ name, passed: JSON.stringify(actual) === JSON.stringify(expected), expected, actual });
}

const budgetOnly = profileModule.extractProfileUpdates('My budget is under 100.');
check('Budget number must not become a size', budgetOnly.preferredSizes || [], []);
const sizeAndBudget = profileModule.extractProfileUpdates('I need size 43 with a budget under 5000.');
check('Size before budget must not replace budget', sizeAndBudget.budgetMax, 5000);
const blackProfile = profileModule.mergeShopperProfile(null, { preferredColors: ['black'] });
const correctedProfile = profileModule.mergeShopperProfile(
  blackProfile, profileModule.extractProfileUpdates('Actually blue instead of black.'),
);
check('Preference correction should replace the previous color', correctedProfile.preferredColors, ['blue']);

const now = Date.now();
const currentContext = { proactivePromptCount: 2, lastProactivePromptAt: now - 1000 };
const existing = { context: currentContext, viewedProductIds: [], cartProductIds: [] };
const updated = sessionModule.computeSessionState(existing, [{ type: 'page_view', url: '/products/example' }]);
check('Session recomputation must preserve proactive prompt limit', updated.context.proactivePromptCount ?? null, 2);
const proactiveInput = {
  triggerType: 'long_product_dwell', pageType: 'product', dwellSeconds: 30,
  scrollDepth: 50, intentScore: 40, hesitationScore: 0, salesState: 'INTEREST',
  dismissed: false, now, settings,
};
const afterDecision = proactiveModule.evaluateProactiveMessage({
  ...proactiveInput,
  promptCount: Number(updated.context.proactivePromptCount || 0),
  lastPromptAt: updated.context.lastProactivePromptAt,
});
check('Proactive prompt must remain denied after an ordinary event', afterDecision.allowed, false);
check('JSON cart removal must retain zero quantity', eventsModule.getCartPayload(JSON.stringify({ id: '123', quantity: 0 })).quantity, 0);

const product = {
  id: 'product-1', title: 'Running Shoes', description: 'Running Shoes',
  vendor: '', productType: '', category: '', tags: [], searchText: 'Running Shoes',
  collectionIds: [], availableForSale: true, price: '50', inventory: 100,
  orderCount: 200, variants: [{ id: 'variant-1', availableForSale: true, selectedOptions: [] }],
};
const profile = profileModule.emptyShopperProfile();
const irrelevant = recommendationModule.rankProductRecommendations({
  products: [product], query: 'refrigerator', profile, settings,
});
check('Unrelated catalog item should not be a product match', irrelevant.map((entry) => entry.product.id), []);
const rejected = recommendationModule.rankProductRecommendations({
  products: [product], query: 'running shoes', profile, settings,
  rejectedProductIds: [product.id],
});
check('Explicitly rejected recommendation should not be repeated', rejected.map((entry) => entry.product.id), []);

const attributionInput = {
  shop: 'example.myshopify.com', sessionIds: ['session-1'], orderId: 'order-1',
  orderValue: 50,
  lineItems: [{ productId: product.id, variantId: 'variant-1', quantity: 1, price: 50, totalDiscount: 0 }],
};
const firstDelivery = await outcomesModule.markPurchasedRecommendationOutcomes(attributionInput);
const duplicateDelivery = await outcomesModule.markPurchasedRecommendationOutcomes(attributionInput);
check('Order-attribution return value should be stable on webhook redelivery', duplicateDelivery, firstDelivery);
console.log(JSON.stringify({
  scope: 'Actual source; database dependency stubbed; no network calls',
  total: results.length,
  failed: results.filter((result) => !result.passed).length,
  results,
}, null, 2));
process.exitCode = results.some((result) => !result.passed) ? 1 : 0;
