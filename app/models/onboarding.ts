export const PAIRINGS_SETUP_ENABLED = true;
export const STOREFRONT_VERIFICATION_DAYS = 14;
export const STOREFRONT_CONNECTION_EVENT = "storefront_session_authenticated";
export const THEME_EMBED_HANDLE = "aovboost";

export type SetupState =
  | "complete"
  | "pending"
  | "blocked"
  | "in_progress"
  | "empty"
  | "failed"
  | "upcoming";
export type SetupStep = {
  id: "sync" | "pairings" | "preview" | "embed" | "verify";
  label: string;
  state: SetupState;
  detail: string;
};

export function themeEmbedEditorUrl(shop: string, apiKey: string) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop) || !apiKey)
    return null;
  const url = new URL(`https://${shop}/admin/themes/current/editor`);
  url.searchParams.set("context", "apps");
  url.searchParams.set("activateAppId", `${apiKey}/${THEME_EMBED_HANDLE}`);
  return url.toString();
}

export function computeSetupChecklist(input: {
  actionableProductCount: number;
  storedProductCount?: number;
  syncProgress: { status?: string; emptyCatalog?: boolean } | null;
  previewedAt: Date | null;
  lastStorefrontActivityAt: Date | null;
  now?: Date;
  pairingsEnabled?: boolean;
  approvedPairingCount?: number;
  themeStatus?: string;
  themeVerifiedAt?: Date | null;
}): SetupStep[] {
  const now = input.now || new Date();
  const active = Boolean(
    input.syncProgress?.status &&
    !["complete", "failed"].includes(input.syncProgress.status),
  );
  const empty =
    input.syncProgress?.emptyCatalog === true &&
    !input.storedProductCount &&
    input.actionableProductCount === 0;
  const failed = input.syncProgress?.status === "failed";
  const ready = input.actionableProductCount > 0 && !active && !failed;
  const unavailable =
    !active &&
    !failed &&
    !empty &&
    !ready &&
    (input.syncProgress?.status === "complete" ||
      Number(input.storedProductCount || 0) > 0);
  const canPreview = ready && input.actionableProductCount > 1;
  const recent = input.lastStorefrontActivityAt;
  const connected = Boolean(
    recent &&
    recent <= now &&
    recent.getTime() >=
      now.getTime() - STOREFRONT_VERIFICATION_DAYS * 86_400_000,
  );
  const verified =
    input.themeStatus === "verified" &&
    Boolean(
      input.themeVerifiedAt &&
      input.themeVerifiedAt <= now &&
      input.themeVerifiedAt.getTime() >=
        now.getTime() - STOREFRONT_VERIFICATION_DAYS * 86400000,
    );
  const steps: SetupStep[] = [
    {
      id: "sync",
      label: "Sync products",
      state: failed
        ? "failed"
        : active
          ? "in_progress"
          : empty
            ? "empty"
            : ready
              ? "complete"
              : unavailable
                ? "blocked"
                : "pending",
      detail: failed
        ? "Sync needs attention. Retry from Product catalog."
        : active
          ? "Keep Home open to continue. Closing the app pauses sync; reopening resumes saved progress."
          : empty
            ? "Your last sync found no active products. Add products in Shopify, then resync."
            : ready
              ? "Your synced catalog has available product variants."
              : unavailable
                ? "No available variants can be recommended yet. Check product status and availability in Shopify, then resync."
                : "Your first product sync starts automatically when you open the app.",
    },
  ];
  if (input.pairingsEnabled ?? PAIRINGS_SETUP_ENABLED)
    steps.push({
      id: "pairings",
      label: "Review autopilot pairings (optional)",
      state: input.approvedPairingCount
        ? "complete"
        : canPreview
          ? "pending"
          : "blocked",
      detail: input.approvedPairingCount
        ? "Your store has at least one approved or autopilot pairing."
        : "Autopilot can prepare safe pairings. Review flagged suggestions or choose an add-on yourself; review is optional.",
    });
  steps.push(
    {
      id: "preview",
      label: "Preview an offer",
      state: input.previewedAt
        ? "complete"
        : canPreview
          ? "pending"
          : "blocked",
      detail: input.previewedAt
        ? "You reviewed a preview using your synced catalog."
        : canPreview
          ? "Review a read-only recommendation with your real products."
          : "Sync at least two available products to preview an add-on.",
    },
    {
      id: "embed",
      label: "Enable theme embed",
      state: connected ? "complete" : "pending",
      detail: connected
        ? "AOVBoost has connected from your storefront recently."
        : "Open the theme editor with AOVBoost selected, turn it on and save your theme.",
    },
    {
      id: "verify",
      label: "Verify it appeared",
      state: verified ? "complete" : "pending",
      detail: verified
        ? "Your current detected theme has passed display checks across multiple storefront sessions."
        : "Test placement on your store. Verification completes after multiple storefront sessions confirm actual displays.",
    },
  );
  return steps;
}
