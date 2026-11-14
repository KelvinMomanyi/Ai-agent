declare const __AOVBOOST_AGENT_CORE_ASSET__: string;
const script = document.currentScript as HTMLScriptElement | null;
const source =
  script?.src ||
  document.querySelector<HTMLScriptElement>("script[src*='aovboost-sdk.js']")
    ?.src;
export function loadAgentCore(): Promise<typeof import("./AgentCore")> {
  if (!source) return Promise.reject(new Error("SDK asset URL unavailable"));
  return import(
    /* @vite-ignore */ new URL(__AOVBOOST_AGENT_CORE_ASSET__, source).href
  );
}
