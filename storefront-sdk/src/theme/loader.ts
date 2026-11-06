declare const __AOVBOOST_THEME_ENGINE_ASSET__: string;
const script = document.currentScript as HTMLScriptElement | null;
const source =
  script?.src ||
  document.querySelector<HTMLScriptElement>("script[src*='aovboost-sdk.js']")
    ?.src;
let pending: Promise<typeof import("./engine")> | undefined;
export function loadThemeEngine(): Promise<typeof import("./engine")> {
  if (!pending) {
    if (!source) return Promise.reject(new Error("SDK asset URL unavailable"));
    const url = new URL(__AOVBOOST_THEME_ENGINE_ASSET__, source);
    pending = import(/* @vite-ignore */ url.href).catch((error) => {
      pending = undefined;
      throw error;
    });
  }
  return pending;
}
