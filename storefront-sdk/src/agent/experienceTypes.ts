import type { BaseWidget, WidgetPayload } from "../widgets/BaseWidget";
import type { ChatWidget, Message } from "../widgets/ChatWidget";
import type { AgentVoice, ChatHandoff } from "./AgentVoice";
import type { cartUrl, mutateShopifyCart } from "../shopifyCart";
export type ConversationMemory = { messages: Message[]; handoffKey?: string };
export type Experience = {
  voice: AgentVoice;
  memory: ConversationMemory;
  handoff: (trigger: string) => ChatHandoff;
  healthy: () => boolean;
  retry: () => Promise<boolean>;
};
export type WidgetDependencies = {
  BaseWidget: typeof BaseWidget;
  ChatWidget: typeof ChatWidget;
  text: (value: unknown, fallback?: string) => string;
  cartUrl: typeof cartUrl;
  mutateShopifyCart: typeof mutateShopifyCart;
};
export type Conversation = BaseWidget & {
  open: (handoff: ChatHandoff) => void;
  close: () => void;
};
export type ExperienceFactory = (
  dependencies: WidgetDependencies,
) => BaseWidget;
export type ConversationFactory = (
  dependencies: WidgetDependencies,
  payload: WidgetPayload,
  experience: Experience,
  close: () => void,
) => Conversation;
