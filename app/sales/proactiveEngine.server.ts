import { withCommerceTransaction } from "../models/commerceTransaction.server";
import { proactiveBlockReason } from "./proactiveEngine";
import { normalizeSalesState } from "./salesStateMachine";
import type { MerchantSalesSettings } from "./types";

export function reserveProactiveMessage(
  shop: string,
  sessionId: string,
  settings: MerchantSalesSettings,
  messageType: string | null,
) {
  return withCommerceTransaction(`session:${shop}`, sessionId, async (tx) => {
    const session = await tx.shopperSession.findFirst({
      where: { id: sessionId, shop },
    });
    if (!session) return false;
    const context =
      session.context &&
      typeof session.context === "object" &&
      !Array.isArray(session.context)
        ? session.context
        : {};
    const blocked = proactiveBlockReason({
      salesState: normalizeSalesState(session.salesState),
      promptCount: Number(context.proactivePromptCount || 0),
      lastPromptAt: context.lastProactivePromptAt
        ? Date.parse(String(context.lastProactivePromptAt))
        : null,
      dismissed: context.proactiveDismissed === true,
      settings,
    });
    // The caller already checked the contextual trigger; recheck mutable permission
    // and limits under the same lock used by behavioral session updates.
    if (blocked) return false;
    await tx.shopperSession.update({
      where: { id: sessionId },
      data: {
        context: {
          ...context,
          proactivePromptCount: Number(context.proactivePromptCount || 0) + 1,
          lastProactivePromptAt: new Date().toISOString(),
          lastProactiveMessageType: messageType,
        },
      },
    });
    return true;
  });
}
