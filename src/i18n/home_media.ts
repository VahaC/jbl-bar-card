import type { TabStrings } from "./index";

/** Strings of the "media" layout of the home tab, looked up as "home_media.<key>". Keep en, uk and fr in sync. */
export const strings: TabStrings = {
  en: {
    standby: "Standby",
    rear_left_short: "L",
    rear_right_short: "R",
  },
  uk: {
    standby: "Режим очікування",
    rear_left_short: "Л",
    rear_right_short: "П",
  },
  fr: {
    standby: "En veille",
    rear_left_short: "G",
    rear_right_short: "D",
  },
};
