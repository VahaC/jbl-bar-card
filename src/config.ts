import { makeTranslate, normalizeLang } from "./i18n";
import { TAB_IDS, TAB_LAYOUTS } from "./types";
import type { JblBarCardConfig, NormalizedConfig, TabId, TabLayouts, Translate } from "./types";

export const CARD_TAG = "jbl-bar-card";
export const EDITOR_TAG = "jbl-bar-card-editor";

const isTab = (value: unknown): value is TabId => typeof value === "string" && (TAB_IDS as string[]).includes(value);

/**
 * The language for config errors. setConfig gets no hass, so read it from the HA frontend
 * (<home-assistant>.hass), else from <html lang>.
 */
export function pageTranslate(): Translate {
  let language: string | undefined;
  try {
    const root = document.querySelector("home-assistant") as { hass?: { locale?: { language?: string }; language?: string } } | null;
    language = root?.hass?.locale?.language ?? root?.hass?.language ?? document.documentElement.lang;
  } catch {
    language = undefined;
  }
  return makeTranslate(normalizeLang(language));
}

/** Validate a user config and fill in defaults. Throws an Error HA shows as an error card (in `t`'s language). */
export function normalizeConfig(config: JblBarCardConfig, t: Translate = makeTranslate("en")): NormalizedConfig {
  const allowed = TAB_IDS.join(", ");
  if (!config || typeof config !== "object") throw new Error(t("config.invalid"));
  if (config.entity !== undefined && config.entity !== null) {
    if (typeof config.entity !== "string" || !config.entity.startsWith("media_player.")) {
      throw new Error(t("config.entity", { value: String(config.entity) }));
    }
  }
  let tabs: TabId[] = [...TAB_IDS];
  if (config.tabs !== undefined) {
    if (!Array.isArray(config.tabs)) throw new Error(t("config.tabs_list", { allowed }));
    const unknown = config.tabs.filter((tab) => !isTab(tab));
    if (unknown.length) throw new Error(t("config.unknown_tab", { value: unknown.join(", "), allowed }));
    // Keep the card's own order; drop duplicates.
    tabs = TAB_IDS.filter((tab) => config.tabs!.includes(tab));
    if (!tabs.length) tabs = ["home"];
  }
  if (config.default_tab !== undefined && !isTab(config.default_tab)) {
    throw new Error(t("config.unknown_default_tab", { value: String(config.default_tab), allowed }));
  }
  const defaultTab = config.default_tab && tabs.includes(config.default_tab) ? config.default_tab : tabs[0];
  const layouts = normalizeLayouts(config.layouts, t);
  return {
    type: config.type,
    entity: config.entity || undefined,
    name: typeof config.name === "string" && config.name.trim() ? config.name.trim() : undefined,
    tabs,
    default_tab: defaultTab,
    compact: config.compact === true,
    recent: config.recent === true,
    layouts,
  };
}

/** Each tab's layout: the configured one, else the tab's first (default) layout. */
export function normalizeLayouts(raw: JblBarCardConfig["layouts"], t: Translate = makeTranslate("en")): TabLayouts {
  const out = Object.fromEntries(TAB_IDS.map((tab) => [tab, TAB_LAYOUTS[tab][0]])) as TabLayouts;
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error(t("config.layouts_map"));
  for (const [tab, value] of Object.entries(raw)) {
    if (!isTab(tab)) {
      throw new Error(t("config.unknown_tab", { value: tab, allowed: TAB_IDS.join(", ") }));
    }
    if (value === undefined || value === null || value === "") continue;
    const allowed: readonly string[] = TAB_LAYOUTS[tab];
    if (typeof value !== "string" || !allowed.includes(value)) {
      throw new Error(t("config.unknown_layout", { tab, value: String(value), allowed: allowed.join(", ") }));
    }
    (out as Record<TabId, string>)[tab] = value;
  }
  return out;
}
