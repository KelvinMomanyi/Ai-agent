import {
  safeThemeIdentity,
  type ThemeIdentity,
} from "../../../shared/themeCompatibility";
export function readThemeIdentity(): ThemeIdentity {
  const value = (window as any).Shopify?.theme || {};
  return safeThemeIdentity({
    themeId: value.id,
    themeName: value.name,
    schemaName: value.schema_name,
    themeStoreId: value.theme_store_id,
    role: value.role,
  });
}
export const PREVIEW_STORAGE_KEY = "aovboost_theme_preview_v1";
export function themePreviewToken(): string | null {
  const token = new URL(window.location.href).searchParams.get(
    "aovboost_preview",
  );
  if (token && token.length < 2000) return token;
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(PREVIEW_STORAGE_KEY) || "null",
    );
    return saved?.expires > Date.now() && typeof saved.token === "string"
      ? saved.token
      : null;
  } catch {
    return null;
  }
}
