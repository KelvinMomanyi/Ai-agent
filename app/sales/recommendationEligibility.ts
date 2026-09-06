import type { CatalogCacheProduct } from "../models/catalogCache.server";
import type { MerchantSalesSettings, ShopperProfile } from "./types";

/** Shared hard constraints. Multiple values within one option are alternatives. */
export function eligibleVariants(
  product: CatalogCacheProduct,
  profile: ShopperProfile,
) {
  return product.variants.filter((variant) => {
    const price = Number(variant.price);
    if (!variant.availableForSale || !Number.isFinite(price) || price < 0)
      return false;
    if (profile.budgetMax !== null && price > profile.budgetMax) return false;
    if (profile.budgetMin !== null && price < profile.budgetMin) return false;
    return [
      { names: ["color", "colour"], values: profile.preferredColors },
      { names: ["size"], values: profile.preferredSizes },
    ].every(
      ({ names, values }) =>
        !values.length ||
        variant.selectedOptions.some(
          (option) =>
            names.some((name) => option.name.toLowerCase().includes(name)) &&
            values.some(
              (value) => value.toLowerCase() === option.value.toLowerCase(),
            ),
        ),
    );
  });
}

export function merchantAllowsProduct(
  product: CatalogCacheProduct,
  settings: MerchantSalesSettings,
) {
  return (
    product.availableForSale &&
    !settings.excludedProductIds.includes(product.id) &&
    !product.collectionIds?.some((id) =>
      settings.excludedCollectionIds.includes(id),
    )
  );
}

export function budgetCurrencyMatches(
  profile: ShopperProfile,
  currencyCode?: string,
) {
  return (
    !profile.budgetCurrency ||
    !currencyCode ||
    profile.budgetCurrency === currencyCode
  );
}
