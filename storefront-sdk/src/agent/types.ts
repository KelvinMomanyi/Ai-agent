import type { StorefrontSettings } from "../sessionManager";
import type { OfferDecision, PlacementOutcome } from "../widgets/widgetManager";
import type { WidgetPayload, WidgetProduct } from "../widgets/BaseWidget";
import type { RecommendationScope } from "./RecommendationService";
import type { CartSource } from "./flag";
import type { SessionState } from "./SessionStore";

export type SignalName =
  | "page_view"
  | "product_view"
  | "cart_change"
  | "cart_add_confirmed"
  | "threshold_progress"
  | "price_hesitation"
  | "exit_intent_desktop"
  | "exit_intent_mobile"
  | "idle"
  | "chat_open"
  | "chat_close"
  | "chat_message"
  | "checkout_start"
  | "offer_dismissed"
  | "offer_accepted"
  | "health_change"
  | "offer_ready";
export type Signal = {
  name: SignalName;
  data: Readonly<Record<string, unknown>>;
  ts: number;
};
export type SurfaceClass =
  "ambient" | "contextual" | "interruptive" | "conversational";
export type UnmountReason =
  | "dismissed"
  | "accepted"
  | "superseded"
  | "expired"
  | "navigation"
  | "suppressed";
export type AgentContext = {
  readonly page: Readonly<{
    type: string;
    productId?: string;
    collectionId?: string;
    productTitle?: string;
    productHandle?: string;
    variantId?: string;
  }>;
  readonly cart: Readonly<{
    items: ReadonlyArray<
      Readonly<{ productId: string; variantId: string; quantity: number }>
    >;
    subtotal: number;
    currency: string;
    lastChangeSource: CartSource;
    known?: boolean;
  }>;
  readonly session: Readonly<SessionState>;
  readonly device: Readonly<{
    isMobile: boolean;
    prefersReducedMotion: boolean;
  }>;
  readonly agent: Readonly<{
    aiHealthy: boolean;
    chatEnabled: boolean;
    holdout: boolean;
    assignment?: import("./Holdout").AgentAssignment;
  }>;
  readonly config: Readonly<StorefrontSettings>;
};
export type SurfaceApi = { closed: () => void };
export interface OfferProvider {
  attribution?(): { offer_id?: unknown; trigger_signal?: string };
  dismissalKey?(ctx: AgentContext): string;
  id: string;
  surfaceClass: SurfaceClass;
  slot: string;
  signals: readonly SignalName[];
  isEligible(ctx: AgentContext): { ok: boolean; reason: string };
  score(ctx: AgentContext): number;
  mount(
    ctx: AgentContext,
    api: SurfaceApi,
  ): Promise<PlacementOutcome> | PlacementOutcome;
  unmount(reason: UnmountReason): void;
  element?(): HTMLElement | null;
  consume?(): void;
}
export interface WidgetCoordinator {
  getDismissedWidgets?(): string[];
  offer(decision: OfferDecision, trigger: string): PlacementOutcome;
  setHoldout(value: boolean): void;
  navigation(): void;
}
export interface WidgetBridge {
  readonly agentExperience?: boolean;
  getRecommendationProducts?(payload: WidgetPayload): WidgetProduct[];
  getRecommendationScope?(): RecommendationScope;
  mountProvider(decision: OfferDecision): Promise<PlacementOutcome>;
  unmountProvider(type: string): void;
  getProviderElement(type: string): HTMLElement | null;
}
