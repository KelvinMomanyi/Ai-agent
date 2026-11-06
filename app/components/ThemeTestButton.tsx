import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Button, Banner, BlockStack } from "@shopify/polaris";
export function validThemeTestUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(url.hostname) &&
      url.pathname.startsWith("/products/") &&
      Boolean(url.searchParams.get("aovboost_preview"))
    );
  } catch {
    return false;
  }
}
export function ThemeTestButton() {
  const test = useFetcher<{ previewUrl?: string; error?: string }>();
  const popup = useRef<Window | null>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (test.state !== "idle" || !test.data) return;
    const child = popup.current;
    popup.current = null;
    if (validThemeTestUrl(test.data.previewUrl)) {
      if (child && !child.closed) child.location.replace(test.data.previewUrl);
      else setBlocked(true);
    } else child?.close();
  }, [test.state, test.data]);
  const start = () => {
    if (test.state !== "idle") return;
    try {
      popup.current = window.open("about:blank", "_blank");
    } catch {
      popup.current = null;
    }
    setBlocked(!popup.current);
    if (popup.current) {
      popup.current.opener = null;
      popup.current.document.title = "Opening AOVBoost theme test";
    }
    test.submit(
      { intent: "preview" },
      { method: "post", action: "/app/theme" },
    );
  };
  return (
    <BlockStack gap="200">
      <Button onClick={start} loading={test.state !== "idle"}>
        Test on my store
      </Button>
      {blocked &&
      test.state === "idle" &&
      validThemeTestUrl(test.data?.previewUrl) ? (
        <Button url={test.data.previewUrl} target="_blank" external>
          Open store test
        </Button>
      ) : null}
      {test.data?.error ? (
        <Banner tone="warning">{test.data.error}</Banner>
      ) : null}
    </BlockStack>
  );
}
