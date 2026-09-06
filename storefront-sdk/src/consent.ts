type ConsentConfig = { settings?: { trackingConsentRequired?: boolean } };
type PrivacyApi = {
  analyticsProcessingAllowed?: () => boolean;
  userCanBeTracked?: () => boolean;
};

export function hasTrackingConsent(config: ConsentConfig) {
  if (config.settings?.trackingConsentRequired !== true) return true;
  const privacy = (
    window as Window & { Shopify?: { customerPrivacy?: PrivacyApi } }
  ).Shopify?.customerPrivacy;
  try {
    if (typeof privacy?.analyticsProcessingAllowed === "function")
      return privacy.analyticsProcessingAllowed() === true;
    if (typeof privacy?.userCanBeTracked === "function")
      return privacy.userCanBeTracked() === true;
  } catch {
    return false;
  }
  return false;
}

export function waitForTrackingConsent(config: ConsentConfig) {
  return new Promise<void>((resolve) => {
    const names = [
      "visitorConsentCollected",
      "shopify:customer_privacy:consent_collected",
      "aovboost:consent-granted",
    ];
    const complete = () => {
      if (!hasTrackingConsent(config)) return;
      for (const surface of [window, document])
        for (const name of names) surface.removeEventListener(name, complete);
      resolve();
    };
    for (const surface of [window, document])
      for (const name of names) surface.addEventListener(name, complete);
    complete();
  });
}
