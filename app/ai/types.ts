import type { AppSettings } from "@prisma/client";

export type CurrentPageType =
  | "home"
  | "collection"
  | "product"
  | "cart"
  | "checkout"
  | "thankyou"
  | "other";

export interface ShopperSessionSnapshot {
  id: string;
  anonymousId: string;
  journeyStage: string;
  intentScore: number;
  hesitationScore: number;
  viewedProductIds: string[];
  cartProductIds: string[];
  chatEngaged: boolean;
  totalPageViews: number;
  sessionDuration: number;
  context: Record<string, unknown>;
}

export interface OfferCandidate {
  id: string;
  type: string;
  widgetType: string;
  productId?: string;
  title: string;
  score: number;
  affinityScore?: number;
  payload: Record<string, unknown>;
}

export interface DecisionInput {
  shop: string;
  session: ShopperSessionSnapshot;
  currentProductId?: string;
  currentPageType: CurrentPageType;
  cartProductIds: string[];
  recentlyDismissedWidgets: string[];
  settings: AppSettings;
  candidates: OfferCandidate[];
}

export interface OfferDecision {
  widgetType: string | null;
  payload: Record<string, unknown>;
  reasoning: string;
  confidence: number;
  aiProvider: "gemini" | "groq" | "mistral" | "deepseek" | "heuristic";
}

export type WidgetCopy =
  | {
      greeting: string;
      assistantIntro: string;
      ctaAccept: string;
      ctaDecline: string;
    }
  | {
      headline: string;
      itemList: string[];
      totalSavings: string;
      ctaText: string;
    }
  | {
      headline: string;
      productName: string;
      whyThisGoes: string;
      ctaText: string;
      dismissText: string;
    }
  | {
      progressLabel: string;
      rewardDescription: string;
      ctaText: string;
    }
  | {
      headline: string;
      offerLine: string;
      ctaText: string;
      dismissText: string;
    }
  | {
      headline: string;
      productName: string;
      oneLineReason: string;
      ctaText: string;
    }
  | Record<string, unknown>;
