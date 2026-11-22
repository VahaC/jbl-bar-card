import type { TabStrings } from "./index";

/**
 * strings of System variant C ("Health dashboard"), looked up as "system_health.<key>".
 * Plurals: every language has _one/_few/_many/_other so the key sets match.
 */
export const strings: TabStrings = {
  en: {
    all_good: "All good",
    all_good_sub: "Nothing needs your attention right now.",
    attention_one: "{count} thing needs attention",
    attention_few: "{count} things need attention",
    attention_many: "{count} things need attention",
    attention_other: "{count} things need attention",
    offline_sub: "The soundbar is unreachable, so these values may be out of date.",
    actions_offline: "Actions come back when the soundbar is reachable again.",
    diagnostics: "Diagnostics",
  },
  uk: {
    all_good: "Усе гаразд",
    all_good_sub: "Зараз нічого не потребує вашої уваги.",
    attention_one: "Потребує уваги: {count}",
    attention_few: "Потребує уваги: {count}",
    attention_many: "Потребує уваги: {count}",
    attention_other: "Потребує уваги: {count}",
    offline_sub: "Саундбар не на зв'язку, тож ці дані можуть бути застарілими.",
    actions_offline: "Дії знову стануть доступні, щойно саундбар повернеться на зв'язок.",
    diagnostics: "Діагностика",
  },
  fr: {
    all_good: "Tout va bien",
    all_good_sub: "Rien ne demande votre attention pour l'instant.",
    attention_one: "{count} point à vérifier",
    attention_few: "{count} points à vérifier",
    attention_many: "{count} points à vérifier",
    attention_other: "{count} points à vérifier",
    offline_sub: "La barre de son est injoignable : ces valeurs ne sont peut-être plus à jour.",
    actions_offline: "Les actions reviendront dès que la barre de son sera de nouveau joignable.",
    diagnostics: "Diagnostic",
  },
};
