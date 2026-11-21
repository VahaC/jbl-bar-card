import { isBlankState } from "./state";
import type { FrontendLocaleData } from "./types";

/**
 * The Intl locale and options for HA's number_format setting, as HA's own frontend maps it:
 * comma_decimal -> en-US, decimal_comma -> de, space_comma -> fr, system -> the browser's,
 * none -> the language without grouping, language (default) -> the language.
 */
export function numberFormatLocale(
  locale: Pick<FrontendLocaleData, "language" | "number_format"> | string | undefined,
): { locale: string | undefined; options: Intl.NumberFormatOptions } {
  if (typeof locale === "string" || locale === undefined) return { locale: locale ?? "en", options: {} };
  switch (locale.number_format) {
    case "comma_decimal":
      return { locale: "en-US", options: {} };
    case "decimal_comma":
      return { locale: "de", options: {} };
    case "space_comma":
      return { locale: "fr", options: {} };
    case "system":
      return { locale: undefined, options: {} };
    case "none":
      return { locale: locale.language, options: { useGrouping: false } };
    default:
      return { locale: locale.language, options: {} };
  }
}

/** Number formatting that follows HA's language and number_format setting (or a bare language). */
export function formatNumber(
  locale: Pick<FrontendLocaleData, "language" | "number_format"> | string | undefined,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  const resolved = numberFormatLocale(locale);
  try {
    return new Intl.NumberFormat(resolved.locale, { ...resolved.options, ...options }).format(value);
  } catch {
    return String(value);
  }
}

/**
 * "HH:MM" honouring hass.locale.time_format ("12" | "24" | "language" | "system") and
 * hass.locale.time_zone: "server" shows the time in the HA server's zone (hass.config.time_zone),
 * anything else in the browser's zone.
 */
export function formatTime(
  locale: FrontendLocaleData | undefined,
  date: Date | string | number,
  serverTimeZone?: string,
): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const format = locale?.time_format;
  const hour12 = format === "12" ? true : format === "24" ? false : undefined;
  const timeZone = locale?.time_zone === "server" && serverTimeZone ? serverTimeZone : undefined;
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12 };
  try {
    return new Intl.DateTimeFormat(locale?.language ?? "en", { ...options, timeZone }).format(d);
  } catch {
    try {
      // An unknown zone name: fall back to the browser's zone.
      return new Intl.DateTimeFormat(locale?.language ?? "en", options).format(d);
    } catch {
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
  }
}

/** Countdown text: "0:07", "7:05", "1:05:30". Negative values show as 0:00. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Numeric state of an entity, or undefined for unknown/unavailable/non-numeric. */
export function numericState(state: string | undefined): number | undefined {
  if (isBlankState(state)) return undefined;
  const n = Number(state);
  return Number.isFinite(n) ? n : undefined;
}
