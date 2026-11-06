import {
  MIN_TEXT_CONTRAST,
  type ThemeAppearance,
} from "../../../shared/themeCompatibility";
function rgb(value: string): number[] | null {
  if (/^#[\da-f]{6}$/i.test(value))
    return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
  const parts =
    /^rgba?\(\s*(\d+(?:\.\d+)?)[, ]+\s*(\d+(?:\.\d+)?)[, ]+\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(
      value,
    );
  if (!parts || (parts[4] && Number(parts[4]) !== 1)) return null;
  const channels = parts.slice(1, 4).map(Number);
  return channels.every((n) => n >= 0 && n <= 255) ? channels : null;
}
export function contrast(a: string, b: string) {
  const luminance = (v: number[]) =>
    v
      .map((c) => {
        const n = c / 255;
        return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const x = rgb(a),
    y = rgb(b);
  if (!x || !y) return 0;
  const l = luminance(x),
    r = luminance(y);
  return (Math.max(l, r) + 0.05) / (Math.min(l, r) + 0.05);
}
export function adaptAppearance(host: HTMLElement, overrides: ThemeAppearance) {
  const body = getComputedStyle(document.body);
  const button = document.querySelector<HTMLElement>(
    "button[name='checkout'], button[name='add'], .product-form__submit",
  );
  const primary = button ? getComputedStyle(button) : body;
  const background = rgb(body.backgroundColor)
    ? body.backgroundColor
    : "#ffffff";
  const ink =
    contrast(body.color, background) >= MIN_TEXT_CONTRAST
      ? body.color
      : "#171717";
  const safeBackground =
    contrast(ink, background) >= MIN_TEXT_CONTRAST ? background : "#ffffff";
  const accent = overrides.accentColor || primary.backgroundColor;
  const action =
    contrast(accent, primary.color) >= MIN_TEXT_CONTRAST
      ? accent
      : contrast(accent, "#ffffff") >= MIN_TEXT_CONTRAST
        ? accent
        : "#171717";
  const actionText =
    contrast(action, primary.color) >= MIN_TEXT_CONTRAST
      ? primary.color
      : "#ffffff";
  const link = document.querySelector("a[href]");
  const linkColor = link ? getComputedStyle(link).color : ink;
  const variables: Record<string, string> = {
    "--aovboost-ink": ink,
    "--aovboost-surface": safeBackground,
    "--aovboost-muted": ink,
    "--aovboost-accent":
      contrast(action, safeBackground) >= MIN_TEXT_CONTRAST ? action : ink,
    "--aovboost-action": action,
    "--aovboost-action-text": actionText,
    "--aovboost-radius":
      overrides.radius != null
        ? `${overrides.radius}px`
        : primary.borderRadius || "8px",
    "--aovboost-link":
      contrast(linkColor, safeBackground) >= MIN_TEXT_CONTRAST
        ? linkColor
        : ink,
    "--aovboost-font":
      overrides.font === "system"
        ? "system-ui, sans-serif"
        : body.fontFamily || "system-ui, sans-serif",
  };
  for (const [key, value] of Object.entries(variables))
    host.style.setProperty(key, value);
  host.style.fontFamily = "var(--aovboost-font)";
  host.style.fontSize = `${Math.max(14, Math.min(20, parseFloat(body.fontSize) || 16))}px`;
  host.style.direction = body.direction === "rtl" ? "rtl" : "ltr";
  host.style.colorScheme = body.colorScheme || "normal";
}
