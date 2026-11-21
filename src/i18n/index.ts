import { en } from "./en";
import { uk } from "./uk";
import { fr } from "./fr";
import { strings as home } from "./home";
import { strings as sound } from "./sound";
import { strings as timers } from "./timers";
import { strings as system } from "./system";
import type { HomeAssistant, Translate } from "../types";

export type Lang = "en" | "uk" | "fr";
export const LANGS: readonly Lang[] = ["en", "uk", "fr"];

/** A flat dictionary: key -> text with {placeholders}. Plural forms use key_one / key_few / key_many / key_other. */
export type Dict = Record<string, string>;

/**
 * Strings of one tab. Keys are written without the tab prefix and looked up as "<tab>.<key>".
 * English is the reference; a key missing in uk/fr falls back to English.
 */
export interface TabStrings {
  en: Dict;
  uk: Dict;
  fr: Dict;
}

export const CORE: Record<Lang, Dict> = { en, uk, fr };
export const TAB_STRINGS: Record<string, TabStrings> = { home, sound, timers, system };

const cache = new Map<Lang, Dict>();

/** The merged dictionary of a language (core + every tab module, prefixed). */
export function dictionary(lang: Lang): Dict {
  const hit = cache.get(lang);
  if (hit) return hit;
  const dict: Dict = { ...CORE[lang] };
  for (const [tab, mod] of Object.entries(TAB_STRINGS)) {
    for (const [key, value] of Object.entries(mod[lang])) dict[`${tab}.${key}`] = value;
  }
  cache.set(lang, dict);
  return dict;
}

/** "uk", "uk-UA" -> "uk"; "fr-CA" -> "fr"; anything else -> "en". */
export function normalizeLang(language: string | undefined | null): Lang {
  const base = (language ?? "").toLowerCase().split(/[-_]/)[0];
  return (LANGS as readonly string[]).includes(base) ? (base as Lang) : "en";
}

export function langOf(hass: Pick<HomeAssistant, "locale" | "language"> | undefined): Lang {
  return normalizeLang(hass?.locale?.language ?? hass?.language);
}

const pluralRules = new Map<Lang, Intl.PluralRules>();
function pluralCategory(lang: Lang, count: number): string {
  let rules = pluralRules.get(lang);
  if (!rules) {
    rules = new Intl.PluralRules(lang);
    pluralRules.set(lang, rules);
  }
  return rules.select(count);
}

function lookup(lang: Lang, key: string, count: number | undefined): string | undefined {
  const dict = dictionary(lang);
  if (count !== undefined) {
    const form = dict[`${key}_${pluralCategory(lang, count)}`] ?? dict[`${key}_other`];
    if (form !== undefined) return form;
  }
  return dict[key];
}

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const count = typeof vars?.count === "number" ? vars.count : undefined;
  let text = lookup(lang, key, count);
  if (text === undefined && lang !== "en") text = lookup("en", key, count);
  if (text === undefined) return key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function makeTranslate(lang: Lang): Translate {
  return (key, vars) => translate(lang, key, vars);
}
