import type { TabStrings } from "./index";

/** Strings of the "cards" layout of the sound tab, looked up as "sound_cards.<key>". Keep en, uk and fr in sync. */
export const strings: TabStrings = {
  en: {
    less: "{name}: lower",
    more: "{name}: higher",
    previous: "{name}: previous option",
    next: "{name}: next option",
    level_of: "Level {value} of {total}",
    sending: "Sending to the soundbar",
    eq_hint: "Drag the points to shape the sound.",
  },
  uk: {
    less: "{name}: менше",
    more: "{name}: більше",
    previous: "{name}: попередній варіант",
    next: "{name}: наступний варіант",
    level_of: "Рівень {value} з {total}",
    sending: "Надсилається на саундбар",
    eq_hint: "Перетягуйте точки, щоб налаштувати звук.",
  },
  fr: {
    less: "{name} : moins",
    more: "{name} : plus",
    previous: "{name} : option précédente",
    next: "{name} : option suivante",
    level_of: "Niveau {value} sur {total}",
    sending: "Envoi à la barre de son",
    eq_hint: "Faites glisser les points pour régler le son.",
  },
};
