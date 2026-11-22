import { DISPLAY_CHAR, DISPLAY_TEXT_MAX, TIMER_SOUNDS, foldDisplayText, invalidDisplayChars, parseServiceError } from "../services";
import { selectOptions } from "../state";
import type { DisplayMessageOptions, TimerStartOptions, TimerSound } from "../services";
import type { HassEntity, HomeAssistant, TabContext } from "../types";

/**
 * Timers tab model: every decision the Timers tab makes (what is shown, when an action may run,
 * why not, what a service call sends, form state and validation, long-press and double-tap
 * guards), as plain data and action objects. Layouts in ./timers-layouts/ only render it.
 *
 * Build it once per render: `const model = timersModel(ctx)`. Actions capture that render's state,
 * exactly like the event handlers they replace, so never keep a model across renders.
 * See docs/layouts-timers.md.
 */

/** Pending keys used by this tab. Per-item keys append the item id. */
export const TIMERS_KEYS = {
  start: "timers.start",
  cancel: "timers.cancel.",
  extend: "timers.extend.",
  stopAll: "timers.stop_all",
  recent: "timers.recent.",
  forget: "timers.forget.",
  send: "timers.send",
  clear: "timers.clear.",
  clearAll: "timers.clear_all",
  clock: "timers.clock",
  clockWhen: "timers.clock_when",
} as const;

/** Quick timer buttons (minutes), as in the integration's timers package. */
export const QUICK_MINUTES = [1, 5, 10, 15] as const;
/** The remote runs at most this many timers. */
export const MAX_TIMERS = 8;
/** timer_start accepts 1 s .. 12 h; the form asks for whole minutes. */
export const MAX_TIMER_MINUTES = 720;
/** Message duration choices in minutes (display_message accepts 1 s .. 24 h). */
export const MESSAGE_DURATIONS = [1, 5, 15, 30, 60, 120, 240] as const;
/** Repeat count range of a repeated message. */
export const MIN_REPEAT = 1;
export const MAX_REPEAT = 99;
/** Holding a recent chip this long forgets it. */
export const LONG_PRESS_MS = 550;
/** After a long press forgot a chip, a click on that slot within this time belongs to the same gesture. */
export const SUPPRESS_CLICK_MS = 1000;
/** A restarted recent item leaves its slot (it is running now): wait at most this long for that. */
export const RECENT_RESTART_WAIT_MS = 5000;
/**
 * After a forget or restart, ignore the same action on that slot this long: the next item moves
 * into the slot as soon as HA reports the change, often before the call returns, so the second
 * click of a double click would otherwise hit it.
 */
export const RECENT_SLOT_GUARD_MS = 800;
/** ctx.local key of the tab's UI state (shared by every layout, so switching layouts keeps drafts). */
export const TIMERS_LOCAL_KEY = "timers";

/** Timer names use the same characters as display messages (the remote checks both with displayText). */
const TIMER_NAME_CHAR = DISPLAY_CHAR;

/* ------------------------------------------------------------------ */
/* Data from the timers / messages sensors                             */
/* ------------------------------------------------------------------ */

/** One item of sensor timers.attributes.timers (integration v0.13.2). */
export interface TimerItem {
  id: string;
  /** Folded name (upper case, no accents); "" when unnamed. */
  name: string;
  ringing: boolean;
  /** End time in ms epoch; null while ringing. */
  endsAt: number | null;
  /** show_time_left on the bar. */
  countdown: boolean;
  sound: string;
  /** Full length including added time; null on older remotes (no +1 min there). */
  durationS: number | null;
}

/** One item of sensor messages.attributes.messages. */
export interface MessageItem {
  id: string;
  /** = id when named, "" for the unnamed ("default") message. */
  name: string;
  text: string;
  mode: "passes" | "duration" | "forever";
  passesLeft: number | null;
  endsAt: number | null;
  /** Remaining seconds of a held duration message (it has not started yet). */
  durationS: number | null;
  showing: boolean;
  whenOn: boolean;
  held: boolean;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const time = (v: unknown): number | null => {
  if (typeof v !== "string" || !v) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
};

/** The running timers from the timers sensor (ringing first, then soonest end, as the integration sorts them). */
export function timerItems(state: HassEntity | undefined): TimerItem[] {
  const list = state?.attributes.timers;
  if (!Array.isArray(list)) return [];
  const out: TimerItem[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = str(r.id);
    if (!id) continue;
    out.push({
      id,
      name: str(r.name),
      ringing: r.ringing === true,
      endsAt: time(r.ends_at),
      countdown: r.countdown === true,
      sound: str(r.sound) || "off",
      durationS: num(r.duration_s),
    });
  }
  return out;
}

/** The messages from the messages sensor, in the remote's order. */
export function messageItems(state: HassEntity | undefined): MessageItem[] {
  const list = state?.attributes.messages;
  if (!Array.isArray(list)) return [];
  const out: MessageItem[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = str(r.id) || "default";
    const mode = r.mode === "duration" || r.mode === "forever" ? r.mode : "passes";
    out.push({
      id,
      name: str(r.name),
      text: str(r.text),
      mode,
      passesLeft: num(r.passes_left),
      endsAt: time(r.ends_at),
      durationS: num(r.duration_s),
      showing: r.showing === true,
      whenOn: r.when_on === true,
      held: r.held === true,
    });
  }
  return out;
}

/** Characters a timer name may not use (letters, digits, space and - . ' are allowed after folding). */
export function invalidTimerNameChars(name: string): string[] {
  const bad = new Set<string>();
  for (const ch of foldDisplayText(name)) if (!TIMER_NAME_CHAR.test(ch)) bad.add(ch);
  return [...bad];
}

/** Words the integration (lines.py TEXT, en and fr only) puts in the recent buttons' names. */
const RECENT_UNNAMED = new Set(["Timer", "Minuteur"]);
const RECENT_FOREVER = new Set(["until cleared", "jusqu'à effacement"]);
const RECENT_WHEN_ON = new Set(["when the bar is on", "à l'allumage"]);

/**
 * A recent button's name in the card's language. The integration writes it once, in the HA
 * server's language (en or fr): "<text> · 10 min", "Timer · 1 h", "<text> (id) · 3 times · when the
 * bar is on". The user's own text is kept; the known words and lengths are translated.
 */
export function recentLabel(ctx: Pick<TabContext, "t">, kind: "timer" | "message", raw: string): string {
  const parts = raw.split(" · ");
  if (parts.length < 2) return raw;
  return parts
    .map((part, i) => {
      if (i === 0) return kind === "timer" && RECENT_UNNAMED.has(part) ? ctx.t("timers.unnamed") : part;
      let m = part.match(/^(\d+) min$/);
      if (m) return lengthLabel(ctx, Number(m[1]));
      m = part.match(/^(\d+) h$/);
      if (m) return lengthLabel(ctx, Number(m[1]) * 60);
      m = part.match(/^(\d+) (?:times|fois)$/);
      if (m) return ctx.t("timers.repeat_times", { count: Number(m[1]) });
      if (RECENT_FOREVER.has(part)) return ctx.t("timers.msg_forever");
      if (RECENT_WHEN_ON.has(part)) return ctx.t("timers.msg_when_on");
      return part;
    })
    .join(" · ");
}

/** "15 min", "1 h", "1 h 30 min" in the tab's language. */
export function lengthLabel(ctx: Pick<TabContext, "t">, totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  if (m < 60) return ctx.t("timers.len_min", { n: m });
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? ctx.t("timers.len_h_min", { h, m: rest }) : ctx.t("timers.len_h", { n: h });
}

export type MessageMode = "repeat" | "duration" | "forever";
export const MESSAGE_MODES: readonly MessageMode[] = ["repeat", "duration", "forever"];

/** What the compose form would send. Exported for tests. */
export function composeMessage(local: {
  text: string;
  mode: MessageMode;
  repeat: number;
  durationMin: number;
  clearOnKey: boolean;
  whenOn: boolean;
}): DisplayMessageOptions {
  const options: DisplayMessageOptions = { message: local.text.trim() };
  if (local.mode === "repeat") options.repeat = Math.min(MAX_REPEAT, Math.max(MIN_REPEAT, Math.round(local.repeat)));
  else if (local.mode === "duration") options.duration = { minutes: local.durationMin };
  else options.forever = true;
  if (local.clearOnKey) options.clear_on_key = true;
  if (local.whenOn) options.when_on = true;
  return options;
}

/* ------------------------------------------------------------------ */
/* Local UI state                                                      */
/* ------------------------------------------------------------------ */

export interface TimersLocal {
  formOpen: boolean;
  name: string;
  minutes: string;
  sound: TimerSound;
  showLeft: boolean;
  text: string;
  mode: MessageMode;
  repeat: number;
  durationMin: number;
  clearOnKey: boolean;
  whenOn: boolean;
  /** Long-press timer on a recent chip. */
  pressHandle?: ReturnType<typeof setTimeout>;
  /** The recent button whose next click must be ignored (it ended a long press), and when it fired. */
  suppressClick?: { id: string; at: number };
  /** The remote refused when_on (display_when_on_unsupported): hide the option for this session. */
  whenOnUnsupported?: boolean;
  /** "<action>:<slot id>" -> ms epoch until which that action on that slot is ignored. */
  slotGuard: Record<string, number>;
}

export const initTimersLocal = (): TimersLocal => ({
  formOpen: false,
  name: "",
  minutes: "10",
  sound: "unless_tv",
  showLeft: true,
  text: "",
  // Same defaults as the integration's messages package.
  mode: "forever",
  repeat: 3,
  durationMin: 15,
  clearOnKey: true,
  whenOn: false,
  slotGuard: {},
});

/** The tab's local UI state (one per card). */
export const timersLocal = (ctx: TabContext): TimersLocal => ctx.local<TimersLocal>(TIMERS_LOCAL_KEY, initTimersLocal);

/* ------------------------------------------------------------------ */
/* Model types                                                         */
/* ------------------------------------------------------------------ */

/** One thing the user can do, with everything a renderer needs. */
export interface TimersAction {
  /**
   * The pending key of a service action (quick starts share TIMERS_KEYS.start); a stable name for a
   * local-only action (stepper). Not unique per button: use the item id for DOM ids.
   */
  key: string;
  /** Short visible text ("Stop", "+1 min", "5 min"). */
  label: string;
  /** Full accessible name that names the item ("Stop PIZZA"); use it as aria-label (and title). */
  ariaLabel: string;
  icon: string;
  /** False: render the control disabled. */
  enabled: boolean;
  /** The call is on its way (or the bar has not reported the result yet). */
  pending: boolean;
  /** Why it cannot run now (set when enabled is false). */
  reason?: string;
  /** Destructive: show it in the danger colour (stop all / clear all ask for confirmation themselves). */
  danger?: boolean;
  /** Safe to call any time: it re-checks pending, guards and validation itself. */
  run(): void;
}

/** An on/off option (role="switch"). */
export interface TimersToggle {
  on: boolean;
  label: string;
  icon: string;
  /** Extra explanation (title / hint), when there is one. */
  hint?: string;
  toggle(): void;
}

/** One option of a single choice (role="radiogroup"). */
export interface TimersChoice<T extends string | number = string> {
  value: T;
  /** Short visible text. */
  label: string;
  /** Longer text for title. */
  title: string;
  selected: boolean;
  select(): void;
}

export interface TimerView {
  id: string;
  item: TimerItem;
  /** Folded name or the translated "Timer". */
  name: string;
  ringing: boolean;
  /** "Time's up!" while ringing. */
  ringingText?: string;
  /** ms epoch; null while ringing. Feed it to <jbl-bar-countdown .endsAt>. */
  endsAt: number | null;
  /** Full length in seconds for a progress bar; null when the remote does not report it or the timer rings. */
  progressTotal: number | null;
  /** "ends at 20:15", when the end time is known. */
  endsAtLabel?: string;
  sound: { value: TimerSound; icon: string; label: string };
  /** Set when the bar shows the time left. */
  countdownOnBar?: { icon: string; label: string };
  /** Ringing: "Stop" (filled danger button); running: cancel (× icon button). Same pending key. */
  cancel: TimersAction;
  /** "+1 min"; undefined while ringing or on remotes without duration_s. */
  extend?: TimersAction;
}

export interface TimerFormModel {
  open: boolean;
  /** The "Custom" button that opens and closes the form: visible text ("Custom"). */
  toggleLabel: string;
  /** Its accessible name ("Custom timer"); it stays the same open or closed (aria-expanded tells the state). */
  toggleAriaLabel: string;
  /** Its icon: "mdi:tune-variant" while closed, "mdi:close" while open. */
  toggleIcon: string;
  toggle(): void;
  close(): void;
  closeLabel: string;
  /** Input ids are unique within one card (each card has its own shadow root). */
  name: { id: string; label: string; value: string; max: number; set(value: string): void };
  /** The name as the bar shows it ("PIZZA"). */
  folded: string;
  badChars: string[];
  /** The line under the name: a warning (bad characters), the preview, or the rules. */
  nameHint: { text: string; warn: boolean };
  /** Kept as typed (string) until submit, like the classic form; setting it does not re-render. */
  minutes: { id: string; label: string; value: string; min: number; max: number; set(value: string): void };
  soundLabel: string;
  sounds: TimersChoice<TimerSound>[];
  showLeft: TimersToggle;
  /** The submit button (label "Start"). run() = submit(). */
  submit: TimersAction;
  /** Validate and start; resolves true when the timer started (the form then clears and closes itself). */
  submitForm(): Promise<boolean>;
}

export interface StartModel {
  /** Group label of the quick buttons. */
  label: string;
  /** 1, 5, 10, 15 minutes (unnamed, sound "unless_tv"). */
  quick: (TimersAction & { minutes: number })[];
  form: TimerFormModel;
  /** Render ctx.renderError(errorKey) under the start controls: validation errors go there. */
  errorKey: string;
}

export interface RecentChip {
  /** The button entity (a slot: the next item moves into it once this one is forgotten or restarted). */
  id: string;
  /** Translated chip text ("EGGS · 7 min"). */
  label: string;
  /** Restart or forget on its way: show the chip pending, aria-busy. */
  busy: boolean;
  /** Tap: start it again. Ignores the click that ends a long press and double taps. */
  restart: TimersAction;
  /** ×: forget it (never talks to the bar, so it stays enabled while the bar is unreachable). */
  forget: TimersAction;
  /** Bind these to the restart button: they implement long-press and right-click to forget. */
  press: {
    onPointerDown(ev: { button: number }): void;
    /** pointerup, pointerleave, pointercancel. */
    onPointerEnd(): void;
    onContextMenu(ev: Event): void;
  };
}

export interface RecentModel {
  kind: "timer" | "message";
  title: string;
  hint: string;
  icon: string;
  chips: RecentChip[];
  /** Render ctx.renderError(errorKeys) under the chips. */
  errorKeys: string[];
}

export interface TimersSection {
  entity: string;
  title: string;
  /** False when the sensor is unavailable: show `unavailableText`, no start controls, no list. */
  available: boolean;
  unavailableText: string;
  emptyText: string;
  timers: TimerView[];
  /** Only when more than one timer runs. Asks for confirmation. */
  stopAll?: TimersAction;
  /** Only when the sensor is available. */
  start?: StartModel;
  /** Only when recent timers exist (and are shown for this bar). */
  recent?: RecentModel;
}

export type MessageStatus = "held" | "showing" | "waiting";

export interface MessageView {
  id: string;
  item: MessageItem;
  /** The text, or the id when the text is empty. */
  label: string;
  /** "(fridge)" part: the message id when it has one. */
  name: string;
  showing: boolean;
  status: { kind: MessageStatus; text: string };
  icon: string;
  /**
   * How long it stays: "until cleared", "3 passes left", "for 15 min once the bar is on", or
   * "until 20:15" followed by a live countdown to `endsAt` (kind "until"). Empty text: nothing.
   */
  length: { kind: "forever" | "until" | "held_for" | "passes" | "none"; text: string; endsAt?: number };
  /** "when the bar is on", for a message that waits for the bar but is not held right now. */
  whenOnText?: string;
  clear: TimersAction;
}

export interface ComposeModel {
  title: string;
  text: { id: string; label: string; value: string; placeholder: string; max: number; set(value: string): void };
  /** What the display will show (folded, upper case). */
  folded: string;
  /** Preview text: `folded`, or the folded placeholder while empty (`previewEmpty`). */
  preview: string;
  previewEmpty: boolean;
  previewLabel: string;
  counter: { id: string; text: string; warn: boolean };
  badChars: string[];
  tooLong: boolean;
  /** aria-invalid of the text input. */
  invalid: boolean;
  /** Visible warning under the preview, when the text cannot be sent as is. */
  warning?: string;
  /** Text for an aria-live (role="status") region; "" when all is well. */
  liveStatus: string;
  modeLabel: string;
  modes: TimersChoice<MessageMode>[];
  mode: MessageMode;
  /** Mode "repeat": a stepper 1..99; `less` / `more` carry a reason at the limits. */
  repeat: { value: number; label: string; less: TimersAction; more: TimersAction };
  /** Mode "duration": the options of the duration select. */
  duration: { id: string; label: string; options: TimersChoice<number>[]; set(minutes: number): void };
  clearOnKey: TimersToggle;
  /** Undefined once the remote refused when_on (hidden for the session). */
  whenOn?: TimersToggle;
  /** Show this hint while when_on is on. */
  whenOnHint?: string;
  /** The send button. run() = sendForm(). */
  send: TimersAction;
  /** Send; resolves true when sent (the text then clears itself). */
  sendForm(): Promise<boolean>;
  /** Render ctx.renderError(errorKey) next to the send button. */
  errorKey: string;
}

export interface MessagesSection {
  entity: string;
  title: string;
  available: boolean;
  unavailableText: string;
  emptyText: string;
  messages: MessageView[];
  /** Only when there is a message. Asks for confirmation. */
  clearAll?: TimersAction;
  /** Only when the sensor is available. */
  compose?: ComposeModel;
  recent?: RecentModel;
}

export interface ClockSection {
  entity: string;
  title: string;
  /**
   * The display clock switch; `on` already shows the pending value. Disabled while the bar is
   * unreachable or the state is unknown, with the reason (the unreachable reason first).
   */
  toggle: TimersAction & { on: boolean };
  /** "Shows: In standby | Always", on remotes that have the select. */
  when?: {
    label: string;
    /** `reason` is set when the option is disabled (the unreachable reason first). */
    options: (TimersChoice & { pending: boolean; enabled: boolean; checked: boolean; reason?: string })[];
  };
}

export interface TimersModel {
  /** Each block is undefined when its entity does not exist on this remote. */
  timers?: TimersSection;
  messages?: MessagesSection;
  clock?: ClockSection;
}

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

export function timersModel(ctx: TabContext): TimersModel {
  const { entities } = ctx;
  return {
    timers: entities.timers ? timersSection(ctx, entities.timers) : undefined,
    messages: entities.messages ? messagesSection(ctx, entities.messages) : undefined,
    clock: entities.display_clock ? clockSection(ctx, entities.display_clock) : undefined,
  };
}

const unreachable = (ctx: TabContext): string | undefined => (ctx.barUnavailable ? ctx.t("timers.reason_unreachable") : undefined);

/* ---------------- Timers ---------------- */

function timersSection(ctx: TabContext, timersId: string): TimersSection {
  const { t } = ctx;
  const available = ctx.isAvailable(timersId);
  const items = timerItems(ctx.stateOf(timersId));

  const stopAll = async (): Promise<void> => {
    const ok = await ctx.confirm({
      title: t("timers.stop_all_title"),
      message: t("timers.stop_all_message"),
      confirmLabel: t("timers.stop_all"),
      destructive: true,
    });
    if (!ok) return;
    void ctx.call(TIMERS_KEYS.stopAll, () => ctx.services.timerCancel({ all: true }), {
      until: (hass) => timerItems(hass.states[timersId]).length === 0,
    });
  };

  return {
    entity: timersId,
    title: t("timers.timers_title"),
    available,
    unavailableText: t("timers.unavailable"),
    emptyText: t("timers.no_timers"),
    timers: items.map((item) => timerView(ctx, item, timersId)),
    stopAll:
      items.length > 1
        ? {
            key: TIMERS_KEYS.stopAll,
            label: t("timers.stop_all"),
            ariaLabel: t("timers.stop_all"),
            icon: "mdi:stop-circle-outline",
            enabled: !ctx.barUnavailable,
            pending: ctx.isPending(TIMERS_KEYS.stopAll),
            reason: unreachable(ctx),
            danger: true,
            run: () => void stopAll(),
          }
        : undefined,
    start: available ? startModel(ctx, items, timersId) : undefined,
    recent: recentModel(ctx, "timer"),
  };
}

function timerView(ctx: TabContext, item: TimerItem, timersId: string): TimerView {
  const { t } = ctx;
  const name = item.name || t("timers.unnamed");
  const cancelKey = TIMERS_KEYS.cancel + item.id;
  const extendKey = TIMERS_KEYS.extend + item.id;
  const gone = (hass: HomeAssistant): boolean => !timerItems(hass.states[timersId]).some((x) => x.id === item.id);
  const enabled = !ctx.barUnavailable;
  const reason = unreachable(ctx);
  const cancel: TimersAction = {
    key: cancelKey,
    label: item.ringing ? t("timers.stop") : t("timers.cancel_short"),
    ariaLabel: item.ringing ? t("timers.stop_label", { name }) : t("timers.cancel_timer", { name }),
    icon: item.ringing ? "mdi:stop" : "mdi:close",
    enabled,
    pending: ctx.isPending(cancelKey),
    reason,
    run: () => {
      void ctx.call(cancelKey, () => ctx.services.timerCancel({ id: item.id }), { until: gone });
    },
  };
  const sound = (TIMER_SOUNDS.includes(item.sound as TimerSound) ? item.sound : "off") as TimerSound;
  const view: TimerView = {
    id: item.id,
    item,
    name,
    ringing: item.ringing,
    ringingText: item.ringing ? t("timers.ringing") : undefined,
    endsAt: item.endsAt,
    progressTotal: !item.ringing && item.durationS && item.endsAt !== null ? item.durationS : null,
    endsAtLabel: item.endsAt !== null ? t("timers.ends_at", { time: ctx.formatTime(item.endsAt) }) : undefined,
    sound: {
      value: sound,
      icon: item.sound === "always" ? "mdi:volume-high" : item.sound === "unless_tv" ? "mdi:television-off" : "mdi:volume-off",
      label: t(`timers.sound_${sound}`),
    },
    countdownOnBar: item.countdown ? { icon: "mdi:clock-digital", label: t("timers.countdown_on_bar") } : undefined,
    cancel,
  };
  if (!item.ringing && item.durationS !== null) {
    const endsAt = item.endsAt;
    view.extend = {
      key: extendKey,
      label: t("timers.add_minute"),
      ariaLabel: t("timers.add_minute_label", { name }),
      icon: "mdi:plus",
      enabled,
      pending: ctx.isPending(extendKey),
      reason,
      run: () => {
        void ctx.call(extendKey, () => ctx.services.timerExtend({ id: item.id }), {
          value: endsAt,
          until: (hass) => {
            const now = timerItems(hass.states[timersId]).find((x) => x.id === item.id);
            return !now || now.endsAt !== endsAt;
          },
        });
      },
    };
  }
  return view;
}

function startModel(ctx: TabContext, items: TimerItem[], timersId: string): StartModel {
  const { t } = ctx;
  const local = timersLocal(ctx);
  const pendingStart = ctx.pendingValue<string>(TIMERS_KEYS.start);

  const start = (which: string, options: TimerStartOptions): Promise<boolean> => {
    // A second tap while a start is on its way would start a duplicate (the remote refuses it).
    if (ctx.isPending(TIMERS_KEYS.start)) return Promise.resolve(false);
    if (items.length >= MAX_TIMERS) {
      ctx.showError(t("timers.err_too_many", { max: MAX_TIMERS }), TIMERS_KEYS.start);
      return Promise.resolve(false);
    }
    const before = new Set(items.map((x) => x.id));
    return ctx.call(TIMERS_KEYS.start, () => ctx.services.timerStart(options), {
      value: which,
      until: (hass) => timerItems(hass.states[timersId]).some((x) => !before.has(x.id)),
    });
  };

  const quick = (minutes: number): void => {
    if (ctx.isPending(TIMERS_KEYS.start)) return;
    if (items.some((x) => x.name === "")) {
      ctx.showError(t("timers.err_unnamed_running"), TIMERS_KEYS.start);
      return;
    }
    void start(`quick:${minutes}`, { duration: { minutes }, sound: "unless_tv" });
  };

  return {
    label: t("timers.start"),
    quick: QUICK_MINUTES.map((minutes) => ({
      // All starts share one pending key; the pending value ("quick:5") tells which button it was.
      key: TIMERS_KEYS.start,
      minutes,
      label: t("timers.quick_min", { n: minutes }),
      ariaLabel: t("timers.quick_label", { n: minutes }),
      icon: "mdi:timer-play-outline",
      enabled: !ctx.barUnavailable,
      pending: pendingStart === `quick:${minutes}`,
      reason: unreachable(ctx),
      run: () => quick(minutes),
    })),
    form: timerForm(ctx, local, items, start),
    errorKey: TIMERS_KEYS.start,
  };
}

function timerForm(
  ctx: TabContext,
  local: TimersLocal,
  items: TimerItem[],
  start: (which: string, options: TimerStartOptions) => Promise<boolean>,
): TimerFormModel {
  const { t } = ctx;
  const folded = foldDisplayText(local.name);
  const badChars = invalidTimerNameChars(local.name);
  const update = (patch: Partial<TimersLocal>): void => {
    Object.assign(local, patch);
    ctx.requestUpdate();
  };

  const submitForm = async (): Promise<boolean> => {
    if (ctx.isPending(TIMERS_KEYS.start)) return false;
    // Validation errors show in the form (ctx.renderError(TIMERS_KEYS.start) under it).
    const minutes = Number(local.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_TIMER_MINUTES) {
      ctx.showError(t("timers.err_minutes", { max: MAX_TIMER_MINUTES }), TIMERS_KEYS.start);
      return false;
    }
    if (badChars.length) {
      ctx.showError(t("timers.err_name_chars", { chars: badChars.join(" ") }), TIMERS_KEYS.start);
      return false;
    }
    if (items.some((x) => x.name === folded)) {
      ctx.showError(folded ? t("timers.err_name_taken", { name: folded }) : t("timers.err_unnamed_running"), TIMERS_KEYS.start);
      return false;
    }
    const ok = await start("custom", {
      duration: { minutes },
      name: local.name.trim() || undefined,
      sound: local.sound,
      show_time_left: local.showLeft,
    });
    if (ok) update({ name: "", formOpen: false });
    return ok;
  };

  const badText = badChars.length ? t("timers.err_name_chars", { chars: badChars.join(" ") }) : undefined;
  return {
    open: local.formOpen,
    toggleLabel: t("timers.custom"),
    toggleAriaLabel: t("timers.custom_label"),
    toggleIcon: local.formOpen ? "mdi:close" : "mdi:tune-variant",
    toggle: () => update({ formOpen: !local.formOpen }),
    close: () => update({ formOpen: false }),
    closeLabel: t("timers.close_form"),
    name: {
      id: "timers-name",
      label: t("timers.name"),
      value: local.name,
      max: DISPLAY_TEXT_MAX,
      set: (value) => update({ name: value }),
    },
    folded,
    badChars,
    nameHint: badText
      ? { text: badText, warn: true }
      : { text: folded ? t("timers.name_preview", { text: folded }) : t("timers.name_hint"), warn: false },
    minutes: {
      id: "timers-minutes",
      label: t("timers.minutes"),
      value: local.minutes,
      min: 1,
      max: MAX_TIMER_MINUTES,
      set: (value) => {
        local.minutes = value;
      },
    },
    soundLabel: t("timers.sound"),
    sounds: TIMER_SOUNDS.map((sound) => ({
      value: sound,
      label: t(`timers.sound_opt_${sound}`),
      title: t(`timers.sound_${sound}`),
      selected: local.sound === sound,
      select: () => update({ sound }),
    })),
    showLeft: {
      on: local.showLeft,
      label: t("timers.show_time_left"),
      icon: "mdi:clock-digital",
      toggle: () => update({ showLeft: !local.showLeft }),
    },
    submit: {
      key: TIMERS_KEYS.start,
      label: t("timers.start_button"),
      ariaLabel: t("timers.start_button"),
      icon: "mdi:play",
      enabled: !ctx.barUnavailable && badChars.length === 0,
      pending: ctx.pendingValue<string>(TIMERS_KEYS.start) === "custom",
      reason: unreachable(ctx) ?? badText,
      run: () => void submitForm(),
    },
    submitForm,
  };
}

/* ---------------- Recent timers / messages ---------------- */

function recentModel(ctx: TabContext, kind: "timer" | "message"): RecentModel | undefined {
  const { t } = ctx;
  const ids = (kind === "timer" ? ctx.entities.recentTimers : ctx.entities.recentMessages).filter((id) => ctx.isAvailable(id));
  if (!ids.length) return undefined;
  const local = timersLocal(ctx);

  // Recent buttons are slots: once an item is forgotten or restarted (it runs now), the next one
  // moves into the same entity id. Keep the slot pending until it shows another item, so a second
  // click (double click, slow double tap) cannot hit the item that moved in.
  const labelOf = (hass: HomeAssistant, id: string): string | undefined => {
    const st = hass.states[id];
    return !st || st.state === "unavailable" ? undefined : String(st.attributes.friendly_name ?? id);
  };
  const slotBusy = (id: string): boolean => ctx.isPending(TIMERS_KEYS.forget + id) || ctx.isPending(TIMERS_KEYS.recent + id);
  /** False when this action on this slot ran a moment ago (see RECENT_SLOT_GUARD_MS); else arms the guard. */
  const takeSlot = (action: string, id: string): boolean => {
    const now = Date.now();
    const key = `${action}:${id}`;
    if ((local.slotGuard[key] ?? 0) > now) return false;
    local.slotGuard[key] = now + RECENT_SLOT_GUARD_MS;
    return true;
  };
  const forget = (id: string): void => {
    if (slotBusy(id) || !takeSlot("forget", id)) return;
    const label = labelOf(ctx.hass, id);
    void ctx.call(TIMERS_KEYS.forget + id, () => ctx.services.forgetRecent(id), {
      offline: true,
      until: (hass) => labelOf(hass, id) !== label,
    });
  };
  const restart = (id: string): void => {
    const suppress = local.suppressClick;
    if (suppress) {
      local.suppressClick = undefined;
      if (suppress.id === id && Date.now() - suppress.at < SUPPRESS_CLICK_MS) return;
    }
    if (slotBusy(id) || !takeSlot("restart", id)) return;
    const label = labelOf(ctx.hass, id);
    void ctx.call(TIMERS_KEYS.recent + id, () => ctx.services.press(id), {
      until: (hass) => labelOf(hass, id) !== label,
      timeoutMs: RECENT_RESTART_WAIT_MS,
    });
  };
  const cancelPress = (): void => {
    if (local.pressHandle !== undefined) clearTimeout(local.pressHandle);
    local.pressHandle = undefined;
  };
  const startPress = (id: string): void => {
    cancelPress();
    local.pressHandle = setTimeout(() => {
      local.pressHandle = undefined;
      local.suppressClick = { id, at: Date.now() };
      forget(id);
    }, LONG_PRESS_MS);
  };

  return {
    kind,
    title: t(kind === "timer" ? "timers.recent_timers" : "timers.recent_messages"),
    hint: t("timers.recent_hint"),
    icon: kind === "timer" ? "mdi:timer-refresh-outline" : "mdi:message-reply-text-outline",
    chips: ids.map((id) => {
      const label = recentLabel(ctx, kind, String(ctx.stateOf(id)?.attributes.friendly_name ?? id));
      const busy = slotBusy(id);
      return {
        id,
        label,
        busy,
        restart: {
          key: TIMERS_KEYS.recent + id,
          label,
          ariaLabel: t("timers.restart_label", { label }),
          icon: kind === "timer" ? "mdi:timer-refresh-outline" : "mdi:message-reply-text-outline",
          enabled: !ctx.barUnavailable,
          pending: busy,
          reason: unreachable(ctx),
          run: () => restart(id),
        },
        forget: {
          key: TIMERS_KEYS.forget + id,
          label: t("timers.forget_short"),
          ariaLabel: t("timers.forget", { label }),
          icon: "mdi:close",
          enabled: true,
          pending: busy,
          run: () => forget(id),
        },
        press: {
          onPointerDown: (ev) => {
            // A new gesture: a long press that ended without a click no longer counts.
            local.suppressClick = undefined;
            if (ev.button === 0) startPress(id);
          },
          onPointerEnd: cancelPress,
          onContextMenu: (ev) => {
            ev.preventDefault();
            cancelPress();
            forget(id);
          },
        },
      };
    }),
    errorKeys: ids.flatMap((id) => [TIMERS_KEYS.recent + id, TIMERS_KEYS.forget + id]),
  };
}

/* ---------------- Messages ---------------- */

function messagesSection(ctx: TabContext, messagesId: string): MessagesSection {
  const { t, entities } = ctx;
  const available = ctx.isAvailable(messagesId);
  const items = messageItems(ctx.stateOf(messagesId));

  const clearAll = async (): Promise<void> => {
    const ok = await ctx.confirm({
      title: t("timers.clear_all_title"),
      message: t("timers.clear_all_message"),
      confirmLabel: t("timers.clear_all"),
      destructive: true,
    });
    if (!ok) return;
    const button = entities.clear_messages;
    void ctx.call(TIMERS_KEYS.clearAll, () => (button ? ctx.services.press(button) : ctx.services.displayCancel()), {
      until: (hass) => messageItems(hass.states[messagesId]).length === 0,
    });
  };

  return {
    entity: messagesId,
    title: t("timers.messages_title"),
    available,
    unavailableText: t("timers.messages_unavailable"),
    emptyText: t("timers.no_messages"),
    messages: items.map((item) => messageView(ctx, item, messagesId)),
    clearAll: items.length
      ? {
          key: TIMERS_KEYS.clearAll,
          label: t("timers.clear_all"),
          ariaLabel: t("timers.clear_all"),
          icon: "mdi:message-off-outline",
          enabled: !ctx.barUnavailable,
          pending: ctx.isPending(TIMERS_KEYS.clearAll),
          reason: unreachable(ctx),
          danger: true,
          run: () => void clearAll(),
        }
      : undefined,
    compose: available ? composeModel(ctx, messagesId) : undefined,
    recent: recentModel(ctx, "message"),
  };
}

function messageView(ctx: TabContext, item: MessageItem, messagesId: string): MessageView {
  const { t } = ctx;
  const key = TIMERS_KEYS.clear + item.id;
  const status: MessageView["status"] = item.held
    ? { kind: "held", text: t("timers.msg_held") }
    : item.showing
      ? { kind: "showing", text: t("timers.msg_showing") }
      : { kind: "waiting", text: t("timers.msg_waiting") };

  let length: MessageView["length"];
  if (item.mode === "forever") length = { kind: "forever", text: t("timers.msg_forever") };
  else if (item.mode === "duration" && item.endsAt !== null)
    length = { kind: "until", text: t("timers.msg_until", { time: ctx.formatTime(item.endsAt) }), endsAt: item.endsAt };
  else if (item.mode === "duration" && item.durationS !== null)
    length = { kind: "held_for", text: t("timers.msg_held_for", { length: lengthLabel(ctx, item.durationS / 60) }) };
  else if (item.mode === "passes" && item.passesLeft !== null)
    length = { kind: "passes", text: t("timers.msg_passes", { count: item.passesLeft }) };
  else length = { kind: "none", text: "" };

  const label = item.text || item.id;
  return {
    id: item.id,
    item,
    label,
    name: item.name,
    showing: item.showing,
    status,
    icon: item.held ? "mdi:power-sleep" : item.showing ? "mdi:message-text" : "mdi:message-text-clock-outline",
    length,
    whenOnText: item.whenOn && !item.held ? t("timers.msg_when_on") : undefined,
    clear: {
      key,
      label: t("timers.clear_short"),
      ariaLabel: t("timers.clear_message", { text: label }),
      icon: "mdi:close",
      enabled: !ctx.barUnavailable,
      pending: ctx.isPending(key),
      reason: unreachable(ctx),
      run: () => {
        void ctx.call(key, () => ctx.services.displayCancel(item.id), {
          until: (hass) => !messageItems(hass.states[messagesId]).some((x) => x.id === item.id),
        });
      },
    },
  };
}

function composeModel(ctx: TabContext, messagesId: string): ComposeModel {
  const { t } = ctx;
  const local = timersLocal(ctx);
  const trimmed = local.text.trim();
  // Exactly what the remote stores and reports back (upper case, folded, spaces collapsed).
  const folded = foldDisplayText(trimmed);
  const badChars = invalidDisplayChars(trimmed);
  const tooLong = folded.length > DISPLAY_TEXT_MAX;
  const pending = ctx.isPending(TIMERS_KEYS.send);
  const canSend = Boolean(trimmed) && !badChars.length && !tooLong && !ctx.barUnavailable;
  const update = (patch: Partial<TimersLocal>): void => {
    Object.assign(local, patch);
    ctx.requestUpdate();
  };

  const sendForm = async (): Promise<boolean> => {
    // A second tap while the first send is on its way would show the message twice.
    if (!canSend || ctx.isPending(TIMERS_KEYS.send)) return false;
    const options = composeMessage({ ...local, whenOn: local.whenOn && !local.whenOnUnsupported });
    const ok = await ctx.call(TIMERS_KEYS.send, () => ctx.services.displayMessage(options), {
      until: (hass) => messageItems(hass.states[messagesId]).some((x) => x.text === folded),
      onError: (err) => {
        // A remote with the Messages panel but without when_on: hide the option for this session.
        if (parseServiceError(err).translationKey !== "display_when_on_unsupported") return undefined;
        local.whenOnUnsupported = true;
        local.whenOn = false;
        return t("timers.when_on_unsupported");
      },
    });
    if (ok) update({ text: "" });
    return ok;
  };

  const placeholder = t("timers.text_placeholder");
  const badText = badChars.length ? t("timers.msg_bad_chars", { chars: badChars.join(" ") }) : undefined;
  const warning = badText ?? (tooLong ? t("timers.msg_too_long", { n: folded.length, max: DISPLAY_TEXT_MAX }) : undefined);
  const durations = MESSAGE_DURATIONS.includes(local.durationMin as (typeof MESSAGE_DURATIONS)[number])
    ? [...MESSAGE_DURATIONS]
    : [...MESSAGE_DURATIONS, local.durationMin].sort((a, b) => a - b);
  const whenOnShown = !local.whenOnUnsupported;

  return {
    title: t("timers.compose"),
    text: {
      id: "timers-text",
      label: t("timers.text"),
      value: local.text,
      placeholder,
      max: DISPLAY_TEXT_MAX,
      set: (value) => update({ text: value }),
    },
    folded,
    preview: folded || foldDisplayText(placeholder),
    previewEmpty: !folded,
    previewLabel: t("timers.preview_label"),
    counter: {
      id: "timers-text-counter",
      text: t("timers.counter", { n: folded.length, max: DISPLAY_TEXT_MAX }),
      warn: tooLong,
    },
    badChars,
    tooLong,
    invalid: badChars.length > 0 || tooLong,
    warning,
    liveStatus: badText ?? (tooLong ? t("timers.msg_too_long_live", { max: DISPLAY_TEXT_MAX }) : ""),
    modeLabel: t("timers.mode"),
    mode: local.mode,
    modes: MESSAGE_MODES.map((mode) => ({
      value: mode,
      label: t(`timers.mode_${mode}`),
      title: t(`timers.mode_${mode}`),
      selected: local.mode === mode,
      select: () => update({ mode }),
    })),
    repeat: {
      value: local.repeat,
      label: t("timers.repeat_times", { count: local.repeat }),
      less: {
        key: "timers.repeat_less",
        label: t("timers.repeat_less"),
        ariaLabel: t("timers.repeat_less"),
        icon: "mdi:minus",
        enabled: local.repeat > MIN_REPEAT,
        pending: false,
        reason: local.repeat > MIN_REPEAT ? undefined : t("timers.reason_repeat_min"),
        run: () => update({ repeat: Math.max(MIN_REPEAT, local.repeat - 1) }),
      },
      more: {
        key: "timers.repeat_more",
        label: t("timers.repeat_more"),
        ariaLabel: t("timers.repeat_more"),
        icon: "mdi:plus",
        enabled: local.repeat < MAX_REPEAT,
        pending: false,
        reason: local.repeat < MAX_REPEAT ? undefined : t("timers.reason_repeat_max", { max: MAX_REPEAT }),
        run: () => update({ repeat: Math.min(MAX_REPEAT, local.repeat + 1) }),
      },
    },
    duration: {
      id: "timers-duration",
      label: t("timers.duration"),
      options: durations.map((m) => ({
        value: m,
        label: lengthLabel(ctx, m),
        title: lengthLabel(ctx, m),
        selected: m === local.durationMin,
        select: () => update({ durationMin: m }),
      })),
      set: (minutes) => update({ durationMin: minutes }),
    },
    clearOnKey: {
      on: local.clearOnKey,
      label: t("timers.clear_on_key"),
      icon: "mdi:remote",
      toggle: () => update({ clearOnKey: !local.clearOnKey }),
    },
    whenOn: whenOnShown
      ? {
          on: local.whenOn,
          label: t("timers.when_on"),
          icon: "mdi:power",
          hint: t("timers.when_on_hint"),
          toggle: () => update({ whenOn: !local.whenOn }),
        }
      : undefined,
    whenOnHint: local.whenOn && whenOnShown ? t("timers.when_on_hint") : undefined,
    send: {
      key: TIMERS_KEYS.send,
      label: t("timers.send"),
      ariaLabel: t("timers.send"),
      icon: "mdi:send",
      enabled: canSend,
      pending,
      reason: canSend ? undefined : (unreachable(ctx) ?? warning ?? (trimmed ? undefined : t("timers.reason_no_text"))),
      run: () => void sendForm(),
    },
    sendForm,
    errorKey: TIMERS_KEYS.send,
  };
}

/* ---------------- Clock ---------------- */

function clockSection(ctx: TabContext, clockId: string): ClockSection {
  const { t, entities } = ctx;
  const clock = ctx.stateOf(clockId);
  const known = clock?.state === "on" || clock?.state === "off";
  const on = clock?.state === "on";
  const pendingOn = ctx.pendingValue<boolean>(TIMERS_KEYS.clock);

  const whenId = entities.display_clock_when;
  const when = ctx.stateOf(whenId);
  const pendingWhen = ctx.pendingValue<string>(TIMERS_KEYS.clockWhen);
  // A stale state of an unreachable bar cannot be changed: say so before anything else.
  const clockEnabled = known && !ctx.barUnavailable;
  const whenEnabled = ctx.isAvailable(whenId) && !ctx.barUnavailable;
  const whenReason = whenEnabled ? undefined : (unreachable(ctx) ?? t("timers.reason_clock_when_unavailable"));

  return {
    entity: clockId,
    title: t("timers.clock_title"),
    toggle: {
      key: TIMERS_KEYS.clock,
      label: t("timers.clock"),
      ariaLabel: t("timers.clock"),
      icon: "mdi:clock-digital",
      on: pendingOn ?? on,
      enabled: clockEnabled,
      pending: ctx.isPending(TIMERS_KEYS.clock),
      reason: clockEnabled ? undefined : (unreachable(ctx) ?? t("timers.reason_clock_unknown")),
      run: () => {
        if (!clockEnabled || ctx.isPending(TIMERS_KEYS.clock)) return;
        void ctx.call(TIMERS_KEYS.clock, () => ctx.services.setSwitch(clockId, !on), {
          value: !on,
          until: (hass) => hass.states[clockId]?.state === (!on ? "on" : "off"),
        });
      },
    },
    when:
      whenId && when
        ? {
            label: t("timers.clock_when"),
            options: selectOptions(when, ["standby", "always"]).map((option) => ({
              value: option,
              label: t(`timers.clock_${option}`),
              title: t(`timers.clock_${option}`),
              /** Shown as chosen (the pending value wins). */
              selected: (pendingWhen ?? when.state) === option,
              /** aria-checked: the bar's actual state. */
              checked: when.state === option,
              pending: pendingWhen === option,
              enabled: whenEnabled,
              reason: whenReason,
              select: () => {
                if (!whenEnabled) return;
                if (option === when.state && pendingWhen === undefined) return;
                void ctx.call(TIMERS_KEYS.clockWhen, () => ctx.services.selectOption(whenId, option), {
                  value: option,
                  until: (hass) => hass.states[whenId]?.state === option,
                });
              },
            })),
          }
        : undefined,
  };
}
