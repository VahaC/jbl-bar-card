import type { TabStrings } from "./index";

/** Strings of the "remote" layout of the home tab, looked up as "home_remote.<key>". Keep en, uk and fr in sync. */
export const strings: TabStrings = {
  en: {
    side_left: "L",
    side_right: "R",
    on: "On",
    off: "Off",
    apply: "Turn on",
  },
  uk: {
    side_left: "Л",
    side_right: "П",
    on: "Увімкнено",
    off: "Вимкнено",
    apply: "Увімкнути",
  },
  fr: {
    side_left: "G",
    side_right: "D",
    on: "Activé",
    off: "Désactivé",
    apply: "Activer",
  },
};
