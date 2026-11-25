import { numericState } from "../format";
import { isBlankState, numAttr, selectOptions, textAttr } from "../state";
import type { TabContext } from "../types";

/**
 * Data model of the Sound tab: every decision the tab makes (what is shown, what may change now
 * and why not, what is pending, which value goes to the bar and when) lives here, so a layout
 * only renders. See docs/layouts-sound.md.
 *
 * Slow controls are debounced and sent one at a time: the user can click or drag several times,
 * only the last value is sent, and a value chosen while an earlier one is still on its way is
 * sent after it (the integration runs one command at a time anyway).
 */

/** Pending keys used by this tab. */
export const SOUND_KEYS = {
  bass: "sound.bass",
  center: "sound.center",
  atmos: "sound.atmos",
  rear: "sound.rear",
  broadcast: "sound.broadcast",
  sleep_timer: "sound.sleep_timer",
  audioSync: "sound.audio_sync",
  preset: "sound.eq_preset",
  bassOffset: "sound.bass_offset",
} as const;

/** Pending key of one Front EQ band (0 = 125 Hz ... 4 = 8 kHz). */
export function bandKey(index: number): string {
  return `sound.eq_band.${index}`;
}

/**
 * Debounce delays in ms (how long the card waits for more input before sending).
 * Constant configuration, not card state; tests set them to 0.
 */
export const SOUND_TIMING = {
  levelMs: 350,
  audioSyncMs: 900,
  eqMs: 400,
  bassOffsetMs: 400,
};

/** Center level gain per option index ("0" = original ... "5" = +12 dB). */
export const CENTER_DB: readonly number[] = [0, 2.4, 4.8, 7.2, 9.6, 12];

export type LevelRole = "bass" | "center" | "atmos" | "rear" | "broadcast" | "sleep_timer";
export const LEVEL_ROLES: readonly LevelRole[] = ["bass", "center", "atmos", "rear", "broadcast", "sleep_timer"];

const LEVEL_OPTIONS: Record<LevelRole, readonly string[]> = {
  bass: ["1", "2", "3", "4", "5"],
  center: ["0", "1", "2", "3", "4", "5"],
  atmos: ["low", "mid", "high"],
  rear: ["low", "mid", "high", "muted"],
  // JBL One bars: speaker broadcast (multi-room) and the sleep timer in minutes.
  broadcast: ["off", "mono", "stereo"],
  sleep_timer: ["0", "15", "30", "45", "60", "90", "120"],
};

export const EQ_PRESETS: readonly string[] = [
  "original",
  "less_bass",
  "clear_dialogue",
  "softer_treble",
  "warm",
  "bright",
  "vocal_focus",
];

/** Colour of a status badge ("neutral" = the plain badge). */
export type SoundTone = "ok" | "info" | "warn" | "err" | "neutral";

/** Front EQ / bass offset status -> tone. "off", "ready" and anything unknown are neutral. */
const STATUS_TONE: Record<string, SoundTone> = {
  active: "ok",
  waiting: "warn",
  reset_needed: "err",
  updating: "info",
};

/* ------------------------------------------------------------------ */
/* Model types                                                         */
/* ------------------------------------------------------------------ */

/** One thing the user can press, with everything a renderer needs. */
export interface SoundAction {
  /** Pending key of the control it belongs to (also a stable id for the DOM). */
  key: string;
  label: string;
  icon: string;
  /** False: render it disabled. */
  enabled: boolean;
  /** The command is on its way or the bar is working on it. */
  pending: boolean;
  /** Why it cannot run now, when the model knows. */
  reason?: string;
  run(): void;
}

export interface SoundBadge {
  /** Raw status ("active", "reset_needed"...). */
  value: string;
  /** Translated text. */
  label: string;
  tone: SoundTone;
}

/**
 * What kind of reason a disabled control has, so a layout can group or filter them:
 * - "blocked": a condition of this control only (rear speakers docked, audio sync needs TV/HDMI);
 * - "busy": something else is on its way (a preset being applied, EQ bands being sent);
 * - "unreachable": the soundbar does not answer;
 * - "standby": the soundbar is off and does not report the setting;
 * - "unavailable": the soundbar is on but does not report the setting now.
 */
export type SoundReasonKind = "blocked" | "busy" | "unreachable" | "standby" | "unavailable";

export interface SoundLevelOption {
  /** The select option sent to HA ("3", "mid"...). */
  value: string;
  /** Text for the button ("4" for center "3", "Mid"...). */
  label: string;
  /** `label`, shortened where it is too long for a narrow strip ("Серед." for "Середньо"). */
  shortLabel: string;
  /** The bar reports this option now. */
  active: boolean;
  /** The user chose it and it is not confirmed yet. */
  pending: boolean;
}

/** A level select (bass, center, atmos, rear) shown as a row of choices. */
export interface SoundLevel {
  role: LevelRole;
  key: string;
  entity: string;
  label: string;
  options: SoundLevelOption[];
  /** Option the bar reports (undefined when unknown). */
  current?: string;
  /** Option to show as selected: the drag preview, else the pending target, else the current one. */
  shown?: string;
  /** Index of `shown` in `options`, -1 when unknown (for sliders over the levels). */
  shownIndex: number;
  /** Extra value text next to the title (center: "+2.4 dB" / "Original"); follows `shown`. */
  extra?: string;
  enabled: boolean;
  /** A chosen option is waiting to be sent or confirmed. */
  pending: boolean;
  /** The user is dragging a slider over the levels (a preview, not sent yet). */
  dragging: boolean;
  /** Why the level cannot change now; set only when `enabled` is false. */
  reason?: string;
  reasonKind?: SoundReasonKind;
  /** Pick an option: debounced (SOUND_TIMING.levelMs), the latest choice wins. */
  choose(option: string): void;
  /** Show `option` while a slider is dragged, without sending. Ignored while disabled. */
  preview(option: string): void;
  /** Drag ended: drop the preview and choose `option`. */
  commit(option: string): void;
  /** Drag cancelled: drop the preview, send nothing. */
  cancel(): void;
}

/** A +/- number control (audio sync, bass offset). */
export interface SoundStepper {
  key: string;
  entity: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Value the bar reports (undefined when unknown or unavailable). */
  current?: number;
  /** Value to show: the drag preview, else the queued or pending target, else the current one. */
  value?: number;
  /** Formatted `value` ("40 ms", "+0.5 dB") or the "unknown" dash. */
  valueText: string;
  /** `value` as a number only ("40", "+0.5") or the "unknown" dash. */
  shortText: string;
  /** False: the value is unknown or the entity is unavailable; render the control disabled. */
  enabled: boolean;
  /** Why the control is disabled; set only when `enabled` is false. */
  reason?: string;
  reasonKind?: SoundReasonKind;
  /** A value is queued or on its way. */
  pending: boolean;
  /** The user is dragging a slider (a preview, not sent yet). */
  dragging: boolean;
  /**
   * Set only for controls that refuse input while a value is on its way (audio sync): true then.
   * Render the buttons with aria-disabled (still focusable), not disabled; clicks are ignored.
   */
  locked?: boolean;
  hint?: string;
  less: SoundAction;
  more: SoundAction;
  /** Snap `value` to the step grid and range, then send it debounced. Ignored when locked or unchanged. */
  set(value: number): void;
  /** Show `value` (snapped) while a slider is dragged, without sending. Ignored while disabled or locked. */
  preview(value: number): void;
  /** Drag ended: drop the preview and `set(value)`. */
  commit(value: number): void;
  /** Drag cancelled: drop the preview, send nothing. */
  cancel(): void;
}

export interface SoundBassOffset extends SoundStepper {
  status?: SoundBadge;
  /** Error text the bar reports. */
  error?: string;
}

export interface SoundPresetOption {
  value: string;
  label: string;
  /** This option is the one to show as selected. */
  selected: boolean;
}

export interface SoundPreset {
  key: string;
  entity: string;
  label: string;
  options: SoundPresetOption[];
  current?: string;
  /** Option to show: the pending target, else the current one; undefined = no preset matches. */
  shown?: string;
  /** Text for the empty choice when `shown` is undefined ("Custom", or the dash when unavailable). */
  placeholder?: string;
  enabled: boolean;
  /** Why the preset cannot change; set only when `enabled` is false. */
  reason?: string;
  reasonKind?: SoundReasonKind;
  /** The preset is being applied. */
  pending: boolean;
  /** A preset or a band is on its way: changes are ignored (render aria-busy). */
  busy: boolean;
  /** Why changes are ignored while `busy` (the preset is applying, or bands are being sent). */
  busyReason?: string;
  /**
   * Apply a preset. Returns false when the choice was ignored (busy, unknown option or no change):
   * a native <select> must then be put back to `shown`.
   */
  select(option: string): boolean;
  /** Offered when the EQ reports reset_needed: applies the "original" preset. */
  reset?: SoundAction;
}

export interface SoundBand {
  index: number;
  key: string;
  entity: string;
  /** Band name ("125 Hz"). */
  label: string;
  /** Accessible name of its slider ("Front EQ 125 Hz"). */
  ariaLabel: string;
  min: number;
  max: number;
  step: number;
  current?: number;
  /** Value to show: drag preview, queued, pending, else current. */
  value?: number;
  /** Slider position: `value`, else `max`. */
  position: number;
  /** "-1.5" (number only) or the "unknown" dash. */
  shortText: string;
  /** "-1.5 dB" (for aria-valuetext) or the "unknown" dash. */
  valueText: string;
  /** The user is dragging it (a preview, not sent yet). */
  dragging: boolean;
  pending: boolean;
  /** False while the band is unavailable or a preset is being applied. */
  enabled: boolean;
  /** Why the band cannot move ("applying preset", unreachable...); set only when `enabled` is false. */
  reason?: string;
  reasonKind?: SoundReasonKind;
  /** Show `value` while dragging, without sending (slider input event). */
  preview(value: number): void;
  /** Drag ended: snap and send debounced (SOUND_TIMING.eqMs), bands one after another. */
  commit(value: number): void;
  /** Drag cancelled (pointercancel, lost capture): drop the preview, send nothing. */
  cancel(): void;
}

export interface SoundEq {
  title: string;
  status?: SoundBadge;
  /** Why the EQ is waiting or needs a reset. */
  reason?: string;
  preset?: SoundPreset;
  /** Only the bands whose entity exists. */
  bands: SoundBand[];
  /** The one reason when every band is disabled for the same reason (one line for the whole EQ). */
  bandsReason?: string;
  bandsReasonKind?: SoundReasonKind;
  /** A preset is being applied or a band is queued or on its way (one spinner for the EQ). */
  pending: boolean;
}

export interface SoundModel {
  /** Bass, center, atmos, rear: only those whose entity exists, in this order. */
  levels: SoundLevel[];
  audioSync?: SoundStepper;
  /** Undefined when there is no preset, EQ status or band entity. */
  eq?: SoundEq;
  /** Bass offset, shown inside the EQ block when there is one, else on its own. */
  bassOffset?: SoundBassOffset;
  /** Nothing at all to show: render `emptyText`. */
  empty: boolean;
  emptyText: string;
}

/* ------------------------------------------------------------------ */
/* Debounced, one-at-a-time sending                                    */
/* ------------------------------------------------------------------ */

interface SendQueue<T> {
  /** The latest TabContext this tab rendered with (a captured ctx would hold a stale hass). */
  ctx?: TabContext;
  /** Chosen by the user, not sent yet. */
  want?: T;
  /** Being sent right now. */
  inflight?: T;
  timer?: ReturnType<typeof setTimeout>;
}

type Sender<T> = (latest: () => TabContext, value: T) => Promise<unknown>;

function sendQueue<T>(ctx: TabContext, key: string): SendQueue<T> {
  const queue = ctx.local<SendQueue<T>>(`${key}.queue`, () => ({}));
  queue.ctx = ctx;
  return queue;
}

/** Remember `value` and send it once no new value came for `delayMs`; the latest value wins. */
function schedule<T>(queue: SendQueue<T>, value: T, delayMs: number, send: Sender<T>): void {
  queue.want = value;
  if (queue.timer !== undefined) clearTimeout(queue.timer);
  queue.timer = setTimeout(() => {
    queue.timer = undefined;
    void flush(queue, send);
  }, delayMs);
  queue.ctx?.requestUpdate();
}

async function flush<T>(queue: SendQueue<T>, send: Sender<T>): Promise<void> {
  if (queue.inflight !== undefined || queue.want === undefined || !queue.ctx) return;
  const value = queue.want;
  queue.want = undefined;
  queue.inflight = value;
  try {
    await send(() => queue.ctx!, value);
  } finally {
    queue.inflight = undefined;
    queue.ctx?.requestUpdate();
  }
  // A value chosen while this one was on its way: send it now unless its timer is still running.
  if (queue.want !== undefined && queue.timer === undefined) await flush(queue, send);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Translation, or `fallback` when the key has no text (t() returns the key itself then). */
function tOr(ctx: TabContext, key: string, fallback: string): string {
  const text = ctx.t(key);
  return text === key ? fallback : text;
}

/** "warm" -> "Warm", "less_bass" -> "Less bass" (for options the card has no translation for). */
export function humanize(option: string): string {
  const text = option.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Snap to the entity's step grid and clamp to its range. */
export function snapToStep(value: number, min: number, max: number, step: number): number {
  const snapped = step > 0 ? Math.round((value - min) / step) * step + min : value;
  const clamped = Math.min(max, Math.max(min, snapped));
  return Math.round(clamped * 100) / 100;
}

function formatDb(ctx: TabContext, value: number, signed: boolean): string {
  const number = ctx.formatNumber(value, {
    maximumFractionDigits: 1,
    signDisplay: signed ? "exceptZero" : "auto",
  });
  return ctx.t("sound.db", { value: number });
}

function badge(ctx: TabContext, status: string): SoundBadge {
  return { value: status, label: tOr(ctx, `sound.status.${status}`, humanize(status)), tone: STATUS_TONE[status] ?? "neutral" };
}

interface Reason {
  reason: string;
  reasonKind: SoundReasonKind;
}

const reasonOf = (ctx: TabContext, kind: SoundReasonKind, key: string): Reason => ({ reason: ctx.t(key), reasonKind: kind });

/**
 * Why a control whose entity is unavailable (or whose value is unknown) cannot change: the bar is
 * unreachable, off, or simply does not report the setting now.
 */
function offReason(ctx: TabContext): Reason {
  if (ctx.barUnavailable) return reasonOf(ctx, "unreachable", "sound.reason_unreachable");
  if (!ctx.barOn) return reasonOf(ctx, "standby", "sound.reason_standby");
  return reasonOf(ctx, "unavailable", "sound.reason_unavailable");
}

/** A value shown while a slider is dragged (not sent), kept per control between renders. */
interface Drag<T> {
  value?: T;
}

const dragOf = <T>(ctx: TabContext, key: string): Drag<T> => ctx.local<Drag<T>>(`${key}.drag`, () => ({}));

/** `value` without its sign when it is 0, "+0.5" / "-1" otherwise. */
const signedNumber = (ctx: TabContext, value: number): string =>
  ctx.formatNumber(value, { maximumFractionDigits: 1, signDisplay: "exceptZero" });

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

/** Build the Sound tab model. Call it once per render; its closures use this render's ctx. */
export function soundModel(ctx: TabContext): SoundModel {
  const levels = LEVEL_ROLES.map((role) => levelModel(ctx, role)).filter((l): l is SoundLevel => l !== undefined);
  const audioSync = audioSyncModel(ctx);
  const bassOffset = bassOffsetModel(ctx);
  const eq = eqModel(ctx);
  return {
    levels,
    audioSync,
    eq,
    bassOffset,
    empty: !levels.length && !audioSync && !eq && !bassOffset,
    emptyText: ctx.t("sound.empty"),
  };
}

/* ---------------- Level selects ---------------- */

function levelLabel(ctx: TabContext, role: LevelRole, option: string): string {
  switch (role) {
    case "bass":
      return option;
    case "center": {
      const index = Number(option);
      return Number.isInteger(index) ? String(index + 1) : option;
    }
    case "atmos":
    case "rear":
    case "broadcast":
      return tOr(ctx, `sound.${role}_${option}`, humanize(option));
    case "sleep_timer":
      return option === "0" ? ctx.t("sound.sleep_timer_off") : option;
  }
}

/** Short text of a level option for a narrow strip: "sound.<role>_<option>_short", else the label. */
function levelShortLabel(ctx: TabContext, role: LevelRole, option: string, label: string): string {
  return role === "atmos" || role === "rear" ? tOr(ctx, `sound.${role}_${option}_short`, label) : label;
}

/** Why the rear level cannot change now (the remote refuses while the rears are docked or unknown). */
function rearBlockedReason(ctx: TabContext): Reason | undefined {
  const dockedId = ctx.entities.rear_docked;
  if (!dockedId || ctx.barUnavailable) return undefined;
  const docked = ctx.stateOf(dockedId)?.state;
  if (docked === "off") return undefined;
  return reasonOf(ctx, "blocked", docked === "on" ? "sound.rear_docked_hint" : "sound.rear_unknown_hint");
}

function levelModel(ctx: TabContext, role: LevelRole): SoundLevel | undefined {
  const id = ctx.entities[role];
  if (!id) return undefined;
  const st = ctx.stateOf(id);
  // A level that the bar only steps with a "next level" button (JBL One Atmos) reads its options
  // from the cycle; a select reads them from the entity.
  const cycle = ctx.entities.cycles?.[id];
  const options = cycle ? cycle.options : selectOptions(st, LEVEL_OPTIONS[role]);
  /** The option's translation suffix: the cycle's label, JBL One's "medium" = "mid", else the option. */
  const labelKey = (option: string): string => cycle?.labels[option] ?? (option === "medium" ? "mid" : option);
  const current = st && options.includes(st.state) ? st.state : undefined;
  const key = SOUND_KEYS[role];
  const queue = sendQueue<string>(ctx, key);
  const drag = dragOf<string>(ctx, key);
  const target = queue.want ?? ctx.pendingValue<string>(key);
  /** What the bar will end up with: the pending target, else the current option. */
  const settled = target ?? current;
  const blocked = role === "rear" ? rearBlockedReason(ctx) : undefined;
  const available = ctx.isAvailable(id);
  const enabled = available && blocked === undefined;
  const why = enabled ? undefined : (blocked ?? offReason(ctx));
  // A preview left over from a drag the control can no longer finish is dropped.
  if (!enabled) drag.value = undefined;
  const shown = drag.value ?? settled;

  const send: Sender<string> = (latest, option) => {
    const c = latest();
    if (option === c.stateOf(id)?.state && !c.isPending(key)) return Promise.resolve();
    return c.call(key, () => c.services.selectOption(id, option), {
      value: option,
      until: (hass) => hass.states[id]?.state === option,
      // The integration cycles "<level>_next" with read-back, one action per step.
      timeoutMs: 45000,
    });
  };

  let extra: string | undefined;
  if (role === "center" && shown !== undefined) {
    const db = CENTER_DB[options.indexOf(shown)];
    if (db !== undefined) extra = db === 0 ? ctx.t("sound.center_original") : formatDb(ctx, db, true);
  }

  const choose = (option: string): void => {
    if (option === settled) return;
    schedule(queue, option, SOUND_TIMING.levelMs, send);
  };

  return {
    role,
    key,
    entity: id,
    label: ctx.t(`sound.${role}`),
    options: options.map((option) => {
      const label = levelLabel(ctx, role, labelKey(option));
      return {
        value: option,
        label,
        shortLabel: levelShortLabel(ctx, role, labelKey(option), label),
        active: option === current,
        pending: target === option && option !== current,
      };
    }),
    current,
    shown,
    shownIndex: shown === undefined ? -1 : options.indexOf(shown),
    extra,
    enabled,
    pending: target !== undefined && target !== current,
    dragging: drag.value !== undefined,
    reason: why?.reason,
    reasonKind: why?.reasonKind,
    choose,
    preview: (option) => {
      if (!enabled || !options.includes(option)) return;
      // Dragged back onto the settled option: no preview (a range input fires no change then).
      const next = option === settled ? undefined : option;
      if (next === drag.value) return;
      drag.value = next;
      ctx.requestUpdate();
    },
    commit: (option) => {
      const had = drag.value !== undefined;
      drag.value = undefined;
      if (enabled && options.includes(option) && option !== settled) choose(option);
      else if (had) ctx.requestUpdate();
    },
    cancel: () => {
      if (drag.value === undefined) return;
      drag.value = undefined;
      ctx.requestUpdate();
    },
  };
}

/* ---------------- Audio sync ---------------- */

function audioSyncModel(ctx: TabContext): SoundStepper | undefined {
  const id = ctx.entities.audio_sync;
  if (!id) return undefined;
  const st = ctx.stateOf(id);
  const available = ctx.isAvailable(id);
  const min = numAttr(st, "min", 0);
  const max = numAttr(st, "max", 250);
  const step = numAttr(st, "step", 10);
  const key = SOUND_KEYS.audioSync;
  const queue = sendQueue<number>(ctx, key);
  const sending = ctx.isPending(key);
  const current = available ? numericState(st?.state) : undefined;
  const settled = queue.want ?? ctx.pendingValue<number>(key) ?? current;
  const enabled = available && settled !== undefined;
  const drag = dragOf<number>(ctx, key);
  if (!enabled || sending) drag.value = undefined;
  const shown = drag.value ?? settled;

  const send: Sender<number> = (latest, value) => {
    const c = latest();
    if (value === numericState(c.stateOf(id)?.state) && !c.isPending(key)) return Promise.resolve();
    return c.call(key, () => c.services.setNumber(id, value), {
      value,
      until: (hass) => numericState(hass.states[id]?.state) === value,
      // One re-sync session on the bar: up to 75 s per request, plus the busy wait.
      timeoutMs: 90000,
    });
  };
  const set = (value: number): void => {
    // Do not send another value while the bar is still re-syncing (it can take tens of seconds).
    if (settled === undefined || ctx.isPending(key)) return;
    const target = snapToStep(value, min, max, step);
    if (target === settled) return;
    schedule(queue, target, SOUND_TIMING.audioSyncMs, send);
  };

  let hint: string | undefined;
  if (!available && !ctx.barUnavailable) hint = ctx.t(ctx.barOn ? "sound.audio_sync_source_hint" : "sound.audio_sync_standby_hint");
  else if (sending) hint = ctx.t("sound.audio_sync_slow");
  let why: Reason | undefined;
  if (!enabled) {
    if (ctx.barUnavailable) why = reasonOf(ctx, "unreachable", "sound.reason_unreachable");
    else if (!ctx.barOn) why = reasonOf(ctx, "standby", "sound.audio_sync_standby_hint");
    else why = reasonOf(ctx, "blocked", "sound.audio_sync_source_hint");
  }
  const pending = sending || queue.want !== undefined;

  return {
    key,
    entity: id,
    label: ctx.t("sound.audio_sync"),
    min,
    max,
    step,
    current,
    value: shown,
    valueText: shown === undefined ? ctx.t("common.unknown") : ctx.t("sound.ms", { value: ctx.formatNumber(shown) }),
    shortText: shown === undefined ? ctx.t("common.unknown") : ctx.formatNumber(shown),
    enabled,
    reason: why?.reason,
    reasonKind: why?.reasonKind,
    pending,
    dragging: drag.value !== undefined,
    locked: sending,
    hint,
    less: {
      key,
      label: ctx.t("sound.audio_sync_less"),
      icon: "mdi:minus",
      enabled: available && settled !== undefined && settled > min,
      pending,
      reason: why?.reason,
      run: () => {
        if (settled !== undefined) set(settled - step);
      },
    },
    more: {
      key,
      label: ctx.t("sound.audio_sync_more"),
      icon: "mdi:plus",
      enabled: available && settled !== undefined && settled < max,
      pending,
      reason: why?.reason,
      run: () => {
        if (settled !== undefined) set(settled + step);
      },
    },
    set,
    ...stepperDrag(ctx, drag, enabled && !sending, settled, min, max, step, set),
  };
}

/** preview / commit / cancel of a stepper dragged as a slider. */
function stepperDrag(
  ctx: TabContext,
  drag: Drag<number>,
  canDrag: boolean,
  settled: number | undefined,
  min: number,
  max: number,
  step: number,
  set: (value: number) => void,
): Pick<SoundStepper, "preview" | "commit" | "cancel"> {
  return {
    preview: (raw) => {
      if (!canDrag) return;
      const value = snapToStep(raw, min, max, step);
      // Dragged back onto the settled value: no preview (a range input fires no change then).
      const next = value === settled ? undefined : value;
      if (next === drag.value) return;
      drag.value = next;
      ctx.requestUpdate();
    },
    commit: (value) => {
      const had = drag.value !== undefined;
      drag.value = undefined;
      if (had) ctx.requestUpdate();
      set(value);
    },
    cancel: () => {
      if (drag.value === undefined) return;
      drag.value = undefined;
      ctx.requestUpdate();
    },
  };
}

/* ---------------- Front EQ ---------------- */

function eqStatus(ctx: TabContext): { status?: string; reason?: string } {
  const sensor = ctx.stateOf(ctx.entities.front_eq_status);
  const preset = ctx.stateOf(ctx.entities.eq_preset);
  let status: string | undefined;
  if (sensor && !isBlankState(sensor.state)) {
    status = sensor.state;
  } else {
    const raw = textAttr(preset, "status");
    status = raw === "reset_required" ? "reset_needed" : raw;
  }
  return { status, reason: textAttr(sensor, "reason") ?? textAttr(preset, "error") };
}

function eqModel(ctx: TabContext): SoundEq | undefined {
  const { entities } = ctx;
  const hasBands = entities.eqBands.some(Boolean);
  if (!entities.eq_preset && !entities.front_eq_status && !hasBands) return undefined;
  const { status, reason } = eqStatus(ctx);
  const bands = hasBands ? bandsModel(ctx) : [];
  // One line for the whole EQ when every band is held back for the same reason.
  const first = bands[0];
  const shared = first?.reason !== undefined && bands.every((band) => !band.enabled && band.reason === first.reason) ? first : undefined;
  return {
    title: ctx.t("sound.eq"),
    status: status ? badge(ctx, status) : undefined,
    reason,
    preset: presetModel(ctx, status),
    bands,
    bandsReason: shared?.reason,
    bandsReasonKind: shared?.reasonKind,
    pending: ctx.isPending(SOUND_KEYS.preset) || bandsBusy(ctx),
  };
}

function selectPreset(ctx: TabContext, id: string, option: string): void {
  void ctx.call(SOUND_KEYS.preset, () => ctx.services.selectOption(id, option), {
    value: option,
    until: (hass) => hass.states[id]?.state === option,
    timeoutMs: 30000,
  });
}

const BANDS_QUEUE = "sound.eq_bands";

function bandsBusy(ctx: TabContext): boolean {
  const queue = sendQueue<Record<number, number>>(ctx, BANDS_QUEUE);
  return queue.want !== undefined || queue.inflight !== undefined || ctx.entities.eqBands.some((_, i) => ctx.isPending(bandKey(i)));
}

function presetModel(ctx: TabContext, status: string | undefined): SoundPreset | undefined {
  const id = ctx.entities.eq_preset;
  if (!id) return undefined;
  const st = ctx.stateOf(id);
  const available = ctx.isAvailable(id);
  const options = selectOptions(st, EQ_PRESETS);
  const current = st && options.includes(st.state) ? st.state : undefined;
  const pending = ctx.isPending(SOUND_KEYS.preset);
  const shown = ctx.pendingValue<string>(SOUND_KEYS.preset) ?? current;
  const bandsSending = bandsBusy(ctx);
  const busy = pending || bandsSending;
  const why = available ? undefined : offReason(ctx);
  const applying = pending ? ctx.t("sound.reason_preset_applying") : undefined;

  return {
    key: SOUND_KEYS.preset,
    entity: id,
    label: ctx.t("sound.eq_preset"),
    options: options.map((option) => ({
      value: option,
      label: tOr(ctx, `sound.preset_${option}`, humanize(option)),
      selected: option === shown,
    })),
    current,
    shown,
    placeholder: shown === undefined ? (available ? ctx.t("sound.eq_custom") : ctx.t("common.unknown")) : undefined,
    enabled: available,
    reason: why?.reason,
    reasonKind: why?.reasonKind,
    pending,
    busy,
    busyReason: applying ?? (bandsSending ? ctx.t("sound.reason_bands_sending") : undefined),
    // While a preset is applying (up to 30 s) the control ignores changes: an arrow key on a
    // closed select fires change on every press in Chromium on Windows.
    select: (option) => {
      if (busy || !options.includes(option) || option === shown) return false;
      selectPreset(ctx, id, option);
      return true;
    },
    reset:
      status === "reset_needed" && options.includes("original")
        ? {
            key: SOUND_KEYS.preset,
            label: ctx.t("sound.eq_reset"),
            icon: "mdi:restore",
            enabled: available && !pending,
            pending,
            reason: why?.reason ?? applying,
            run: () => selectPreset(ctx, id, "original"),
          }
        : undefined,
  };
}

interface EqLocal {
  /** Band values while their slider is being dragged (not sent yet). */
  drag: Record<number, number>;
}

function bandsModel(ctx: TabContext): SoundBand[] {
  const local = ctx.local<EqLocal>("sound.eq", () => ({ drag: {} }));
  const queue = sendQueue<Record<number, number>>(ctx, BANDS_QUEUE);
  const presetPending = ctx.isPending(SOUND_KEYS.preset);

  // Each band sends the FULL curve built from the current one: send bands one after another.
  const send: Sender<Record<number, number>> = async (latest, wanted) => {
    for (const [index, value] of Object.entries(wanted)) {
      const c = latest();
      const i = Number(index);
      const id = c.entities.eqBands[i];
      if (!id) continue;
      if (value === numericState(c.stateOf(id)?.state) && !c.isPending(bandKey(i))) continue;
      await c.call(bandKey(i), () => c.services.setNumber(id, value), {
        value,
        until: (hass) => numericState(hass.states[id]?.state) === value,
        timeoutMs: 30000,
      });
    }
  };

  const bands: SoundBand[] = [];
  ctx.entities.eqBands.forEach((id, i) => {
    if (!id) return;
    const st = ctx.stateOf(id);
    const available = ctx.isAvailable(id);
    const min = numAttr(st, "min", -6);
    const max = numAttr(st, "max", 0);
    const step = numAttr(st, "step", 0.5);
    const current = available ? numericState(st?.state) : undefined;
    const key = bandKey(i);
    const queued = queue.want?.[i] ?? queue.inflight?.[i];
    const enabled = available && !presetPending;
    let why: Reason | undefined;
    if (presetPending) why = reasonOf(ctx, "busy", "sound.reason_preset_applying");
    else if (!available) why = offReason(ctx);
    // A drag the band can no longer finish is dropped (the bar went away, a preset started).
    if (!enabled) delete local.drag[i];
    const shown = local.drag[i] ?? queued ?? ctx.pendingValue<number>(key) ?? current;
    const label = ctx.entities.eqBandLabels?.[i] ?? ctx.t(`sound.band_${i}`);
    const unknown = ctx.t("common.unknown");

    bands.push({
      index: i,
      key,
      entity: id,
      label,
      ariaLabel: ctx.t("sound.eq_band_label", { band: label }),
      min,
      max,
      step,
      current,
      value: shown,
      position: shown ?? max,
      shortText: shown === undefined ? unknown : ctx.formatNumber(shown, { maximumFractionDigits: 1 }),
      valueText: shown === undefined ? unknown : formatDb(ctx, shown, false),
      dragging: local.drag[i] !== undefined,
      pending: queued !== undefined || ctx.isPending(key),
      enabled,
      reason: why?.reason,
      reasonKind: why?.reasonKind,
      preview: (value) => {
        if (!enabled) return;
        local.drag[i] = value;
        ctx.requestUpdate();
      },
      commit: (raw) => {
        const value = snapToStep(raw, min, max, step);
        delete local.drag[i];
        if (value === current && queued === undefined && !ctx.isPending(key)) {
          ctx.requestUpdate();
          return;
        }
        schedule(queue, { ...(queue.want ?? {}), [i]: value }, SOUND_TIMING.eqMs, send);
      },
      cancel: () => {
        if (local.drag[i] === undefined) return;
        delete local.drag[i];
        ctx.requestUpdate();
      },
    });
  });
  return bands;
}

/* ---------------- Bass offset ---------------- */

function bassOffsetModel(ctx: TabContext): SoundBassOffset | undefined {
  const id = ctx.entities.bass_offset;
  if (!id) return undefined;
  const st = ctx.stateOf(id);
  const available = ctx.isAvailable(id);
  const min = numAttr(st, "min", -3);
  const max = numAttr(st, "max", 3);
  const step = numAttr(st, "step", 0.5);
  const key = SOUND_KEYS.bassOffset;
  const queue = sendQueue<number>(ctx, key);
  const current = available ? numericState(st?.state) : undefined;
  const settled = queue.want ?? ctx.pendingValue<number>(key) ?? current;
  const enabled = available && settled !== undefined;
  const why = enabled ? undefined : offReason(ctx);
  const drag = dragOf<number>(ctx, key);
  if (!enabled) drag.value = undefined;
  const shown = drag.value ?? settled;
  const pending = queue.want !== undefined || ctx.isPending(key);
  const status = textAttr(st, "status");

  const send: Sender<number> = (latest, value) => {
    const c = latest();
    if (value === numericState(c.stateOf(id)?.state) && !c.isPending(key)) return Promise.resolve();
    return c.call(key, () => c.services.setNumber(id, value), {
      value,
      until: (hass) => numericState(hass.states[id]?.state) === value,
    });
  };
  const set = (value: number): void => {
    if (settled === undefined) return;
    const target = snapToStep(value, min, max, step);
    if (target === settled) return;
    schedule(queue, target, SOUND_TIMING.bassOffsetMs, send);
  };

  return {
    key,
    entity: id,
    label: ctx.t("sound.bass_offset"),
    min,
    max,
    step,
    current,
    value: shown,
    valueText: shown === undefined ? ctx.t("common.unknown") : formatDb(ctx, shown, true),
    shortText: shown === undefined ? ctx.t("common.unknown") : signedNumber(ctx, shown),
    enabled,
    reason: why?.reason,
    reasonKind: why?.reasonKind,
    pending,
    dragging: drag.value !== undefined,
    less: {
      key,
      label: ctx.t("sound.bass_offset_less"),
      icon: "mdi:minus",
      enabled: available && settled !== undefined && settled > min,
      pending,
      reason: why?.reason,
      run: () => {
        if (settled !== undefined) set(settled - step);
      },
    },
    more: {
      key,
      label: ctx.t("sound.bass_offset_more"),
      icon: "mdi:plus",
      enabled: available && settled !== undefined && settled < max,
      pending,
      reason: why?.reason,
      run: () => {
        if (settled !== undefined) set(settled + step);
      },
    },
    set,
    ...stepperDrag(ctx, drag, enabled, settled, min, max, step, set),
    status: status ? badge(ctx, status) : undefined,
    error: textAttr(st, "error"),
  };
}
