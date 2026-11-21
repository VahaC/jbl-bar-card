import { DOMAIN } from "./discovery";
import { parseServiceError } from "./services";
import type { HomeAssistant, Translate } from "./types";

/**
 * The text the card shows for a failed service call, in the card's language:
 * 1. a lost HA connection -> "error.connection_lost";
 * 2. a jbl_bar_91 error with a translation key -> the card's own "svc.<key>" text (en/uk/fr);
 * 3. another integration's translated error -> HA's localize, when it knows the key;
 * 4. else HA's message (built in English by the backend), then the error code.
 */
export function serviceErrorText(err: unknown, t: Translate, hass?: Pick<HomeAssistant, "localize">): string {
  const e = parseServiceError(err);
  if (e.connectionLost) return t("error.connection_lost");
  if (e.translationKey && (!e.translationDomain || e.translationDomain === DOMAIN)) {
    const key = `svc.${e.translationKey}`;
    const text = t(key, e.placeholders);
    if (text !== key) return text;
  }
  if (e.translationKey && e.translationDomain && typeof hass?.localize === "function") {
    try {
      const text = hass.localize(`component.${e.translationDomain}.exceptions.${e.translationKey}.message`, e.placeholders);
      if (text) return text;
    } catch {
      // fall through to the raw message
    }
  }
  if (e.message) return e.message;
  if (e.code !== undefined) return String(e.code);
  return String(err);
}
