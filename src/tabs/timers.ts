import type { TemplateResult } from "lit";
import type { TabContext } from "../types";
import { timersModel } from "./timers-model";
import { classicStyles, renderClassic } from "./timers-layouts/classic";
import { compactStyles, renderCompact } from "./timers-layouts/compact";
import { kitchenStyles, renderKitchen } from "./timers-layouts/kitchen";

/**
 * Timers tab: running timers with a live countdown, quick and custom timers, recent timers,
 * messages on the bar's display (list, compose, recent) and the display clock.
 *
 * Every decision lives in ./timers-model (timersModel(ctx)); the layouts in ./timers-layouts/
 * only render it. The layout comes from the card config: layouts: { timers: classic|kitchen|compact }.
 * See docs/layouts-timers.md.
 */

export function renderTimersTab(ctx: TabContext): TemplateResult {
  const model = timersModel(ctx);
  switch (ctx.config.layouts.timers) {
    case "kitchen":
      return renderKitchen(ctx, model);
    case "compact":
      return renderCompact(ctx, model);
    default:
      return renderClassic(ctx, model);
  }
}

/** Styles of every timers layout (the card includes them all; Lit flattens the nested array). */
export const timersStyles = [classicStyles, kitchenStyles, compactStyles];

// The data helpers and constants have always been importable from this module.
export {
  LONG_PRESS_MS,
  MAX_TIMERS,
  MAX_TIMER_MINUTES,
  MESSAGE_DURATIONS,
  QUICK_MINUTES,
  RECENT_SLOT_GUARD_MS,
  SUPPRESS_CLICK_MS,
  TIMERS_KEYS,
  composeMessage,
  invalidTimerNameChars,
  lengthLabel,
  messageItems,
  recentLabel,
  timerItems,
  timersModel,
} from "./timers-model";
export type { MessageItem, TimerItem, TimersModel } from "./timers-model";
export { COUNTDOWN_TAG, JblBarCountdown } from "../countdown";
