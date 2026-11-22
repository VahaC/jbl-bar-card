import type { TabStrings } from "./index";

/** Strings of the "kitchen" layout of the timers tab, looked up as "timers_kitchen.<key>". Keep en, uk and fr in sync. */
export const strings: TabStrings = {
  en: {
    next: "Next up",
    also_running: "Also running",
    idle_hint: "Pick a time below to start one.",
    min: "min",
    display: "Display",
    display_hint: "Messages and clock",
    messages_count_one: "{count} message",
    messages_count_few: "{count} messages",
    messages_count_many: "{count} messages",
    messages_count_other: "{count} messages",
  },
  uk: {
    next: "Найближчий",
    also_running: "Також запущено",
    idle_hint: "Виберіть час нижче, щоб запустити таймер.",
    min: "хв",
    display: "Дисплей",
    display_hint: "Повідомлення й годинник",
    messages_count_one: "{count} повідомлення",
    messages_count_few: "{count} повідомлення",
    messages_count_many: "{count} повідомлень",
    messages_count_other: "{count} повідомлення",
  },
  fr: {
    next: "À suivre",
    also_running: "Également en cours",
    idle_hint: "Choisissez une durée ci-dessous pour en lancer un.",
    min: "min",
    display: "Afficheur",
    display_hint: "Messages et horloge",
    messages_count_one: "{count} message",
    messages_count_few: "{count} messages",
    messages_count_many: "{count} messages",
    messages_count_other: "{count} messages",
  },
};
