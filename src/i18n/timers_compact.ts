import type { TabStrings } from "./index";

/** Strings of the "compact" layout of the timers tab, looked up as "timers_compact.<key>". Keep en, uk and fr in sync. */
export const strings: TabStrings = {
  en: {
    tabs_label: "Timers, messages and clock",
    tab_timers: "Timers",
    tab_messages: "Messages",
    tab_clock: "Clock",
    ringing_now: "a timer is ringing",
    list_count: "Active: {count}",
    clock_explain:
      "Shows the time on the front display, like 18 54, when nothing else is on it: messages, timers and the bar's own screens come first.",
    clock_when_explain: "In standby: only while the bar is in standby. Always: also while it is on, in place of the source's name.",
  },
  uk: {
    tabs_label: "Таймери, повідомлення й годинник",
    tab_timers: "Таймери",
    tab_messages: "Повідомлення",
    tab_clock: "Годинник",
    ringing_now: "таймер дзвонить",
    list_count: "Активні: {count}",
    clock_explain:
      "Показує час на дисплеї саундбара, наприклад 18 54, коли на ньому нічого іншого немає: повідомлення, таймери й власні екрани саундбара мають перевагу.",
    clock_when_explain:
      "У режимі очікування: лише поки саундбар у режимі очікування. Завжди: також коли він увімкнений, замість назви джерела.",
  },
  fr: {
    tabs_label: "Minuteurs, messages et horloge",
    tab_timers: "Minuteurs",
    tab_messages: "Messages",
    tab_clock: "Horloge",
    ringing_now: "un minuteur sonne",
    list_count: "Actifs : {count}",
    clock_explain:
      "Affiche l'heure sur l'afficheur, par exemple 18 54, quand rien d'autre n'y apparaît : les messages, les minuteurs et les écrans de la barre de son passent avant.",
    clock_when_explain: "En veille : seulement quand la barre de son est en veille. Toujours : aussi quand elle est allumée, à la place du nom de la source.",
  },
};
