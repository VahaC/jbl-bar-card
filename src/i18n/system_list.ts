import type { TabStrings } from "./index";

/**
 * strings of System variant B ("Compact list"), looked up as "system_list.<key>".
 * Short labels for the compact pill buttons (the full action label stays the accessible name),
 * the charging title of the battery row and the single "offline" row.
 */
export const strings: TabStrings = {
  en: {
    add: "Add",
    use_bt: "Use BT",
    pair: "Pair",
    start: "Start",
    step2: "Step 2",
    retry: "Retry",
    charging_title: "Rear speakers charging",
    offline_title: "Soundbar offline",
    offline_note: "Actions come back when it reconnects.",
  },
  uk: {
    add: "Додати",
    use_bt: "На Bluetooth",
    pair: "Сполучити",
    start: "Почати",
    step2: "Крок 2",
    retry: "Повторити",
    charging_title: "Задні колонки заряджаються",
    offline_title: "Саундбар не на зв'язку",
    offline_note: "Дії стануть доступні, щойно він знову підключиться.",
  },
  fr: {
    add: "Ajouter",
    use_bt: "Passer en BT",
    pair: "Appairer",
    start: "Lancer",
    step2: "Étape 2",
    retry: "Réessayer",
    charging_title: "Enceintes arrière en charge",
    offline_title: "Barre de son injoignable",
    offline_note: "Les actions reviendront dès sa reconnexion.",
  },
};
