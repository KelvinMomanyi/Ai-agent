import { AGENT_LIMITS } from "./constants";
export type DecisionLog = {
  signal: string;
  ts: number;
  candidates: Array<{ id: string; score: number; reason: string }>;
  accepted: string[];
};
declare global {
  interface Window {
    __AOVBOOST_DEBUG__?: boolean | { decisions: () => DecisionLog[] };
  }
}
export function aovDebug(tag: string, payload: unknown): void {
  if (window.__AOVBOOST_DEBUG__) console.debug(`[aovboost:${tag}]`, payload);
}
export class Debug {
  private log: DecisionLog[] = [];
  private enabled = false;
  private api?: { decisions: () => DecisionLog[] };
  constructor() {
    const query = new URLSearchParams(location.search).get("aov_debug");
    this.enabled = query === "1" || window.__AOVBOOST_DEBUG__ === true;
    try {
      if (query === "0") sessionStorage.removeItem("aovboost_agent_debug");
      else if (this.enabled)
        sessionStorage.setItem("aovboost_agent_debug", "1");
      this.enabled =
        query !== "0" &&
        (this.enabled ||
          sessionStorage.getItem("aovboost_agent_debug") === "1");
    } catch {
      /* Debug works in memory when storage is blocked. */
    }
    if (this.enabled) {
      this.api = { decisions: () => JSON.parse(JSON.stringify(this.log)) };
      window.__AOVBOOST_DEBUG__ = this.api;
    } else window.__AOVBOOST_DEBUG__ = false;
  }
  decision(entry: DecisionLog): void {
    if (!this.enabled) return;
    this.log.push(entry);
    this.log = this.log.slice(-AGENT_LIMITS.DEBUG_CAPACITY);
    aovDebug("decision", entry);
  }
  destroy(): void {
    if (window.__AOVBOOST_DEBUG__ === this.api)
      window.__AOVBOOST_DEBUG__ = false;
  }
}
