import { DOMAIN } from "./discovery";
import type { CycleLevel, HomeAssistant, HassServiceTarget } from "./types";

/** The remote's volume range: volume_level = volume / VOLUME_MAX. */
export const VOLUME_MAX = 32;
/** Characters the bar's display shows. */
export const DISPLAY_TEXT_MAX = 31;
/** Max length the display_message service accepts. */
export const MESSAGE_INPUT_MAX = 64;

/** media_player supported_features bits used by the card. */
export const FEATURE = {
  PAUSE: 1,
  PREVIOUS_TRACK: 16,
  NEXT_TRACK: 32,
  STOP: 4096,
  PLAY: 16384,
} as const;

export type BarSource = "TV" | "HDMI" | "Bluetooth";
export const BAR_SOURCES: readonly BarSource[] = ["TV", "HDMI", "Bluetooth"];

/** A duration as cv.positive_time_period accepts it. Prefer the object form ("1:30" means 1 h 30 min!). */
export type Duration = { days?: number; hours?: number; minutes?: number; seconds?: number } | number;

export type TimerSound = "off" | "unless_tv" | "always";
export const TIMER_SOUNDS: readonly TimerSound[] = ["off", "unless_tv", "always"];

export interface TimerStartOptions {
  /** 1 s .. 12 h */
  duration: Duration;
  /** Max 64; letters, digits, space and - . ' only; unique among running timers. Empty = unnamed. */
  name?: string;
  show_time_left?: boolean;
  sound?: TimerSound;
  /** 1..30, only used when sound != off */
  sound_volume?: number;
  /** 3 s .. 5 min, only used when sound != off */
  ring_for?: Duration;
  keep_in_recent?: boolean;
}

/** Pick which timer: all > id > name. */
export type TimerSelector = { all: true } | { id: string } | { name: string };

export interface DisplayMessageOptions {
  /** 1..64 characters; the bar shows 31 after upper-casing and accent folding. */
  message: string;
  /** ^[a-z0-9_-]{1,32}$ ; same id replaces the earlier message. */
  id?: string;
  /** At most ONE of repeat / duration / forever. */
  repeat?: number;
  duration?: Duration;
  forever?: boolean;
  clear_on_key?: boolean;
  when_on?: boolean;
  keep_in_recent?: boolean;
}

export const MESSAGE_ID_PATTERN = /^[a-z0-9_-]{1,32}$/;
export const TIMER_ID_PATTERN = /^t[0-9]{1,9}$/;

/** Seconds -> the {hours, minutes, seconds} object the HA duration selector sends. */
export function toDuration(totalSeconds: number): Duration {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return { hours, minutes, seconds };
}

/**
 * The remote's own fold (displayText in jbl-bar-toolkit apps/remote/display_message.go):
 * upper case, then this fixed table, then trim and collapse runs of whitespace. Letters not in
 * the table (Š, Ž, Cyrillic...) are NOT folded: the remote refuses them.
 */
const DISPLAY_FOLD: Record<string, string> = {
  À: "A", Â: "A", Ä: "A", Á: "A", Ã: "A", Å: "A", Æ: "AE",
  Ç: "C", É: "E", È: "E", Ê: "E", Ë: "E",
  Î: "I", Ï: "I", Í: "I", Ì: "I", Ñ: "N",
  Ô: "O", Ö: "O", Ó: "O", Ò: "O", Õ: "O", Ø: "O", Œ: "OE",
  Û: "U", Ü: "U", Ú: "U", Ù: "U", Ÿ: "Y", Ý: "Y", ß: "SS",
  "’": "'", "‘": "'", "–": "-", "—": "-",
};
const DISPLAY_FOLD_PATTERN = new RegExp(`[${Object.keys(DISPLAY_FOLD).join("")}]`, "g");

/** One character the bar's display shows (the remote's displayTextPattern: ^[A-Z0-9 .'-]{1,31}$). */
export const DISPLAY_CHAR = /[A-Z0-9 .'-]/;

/**
 * How the bar's display will show a text, exactly as the remote folds it before checking it:
 * upper case, the remote's fold table, whitespace trimmed and collapsed.
 */
export function foldDisplayText(text: string): string {
  return text
    .toUpperCase()
    .replace(DISPLAY_FOLD_PATTERN, (ch) => DISPLAY_FOLD[ch] ?? ch)
    .trim()
    .split(/\s+/)
    .join(" ");
}

/** Characters the display cannot show after folding (letters A-Z, digits, space and - . ' are allowed). */
export function invalidDisplayChars(text: string): string[] {
  const bad = new Set<string>();
  for (const ch of foldDisplayText(text)) {
    if (!DISPLAY_CHAR.test(ch)) bad.add(ch);
  }
  return [...bad];
}

/** home-assistant-js-websocket's ERR_CONNECTION_LOST. */
export const ERR_CONNECTION_LOST = 3;

/** The parts of a callService rejection the card reads. */
export interface ServiceError {
  message?: string;
  code?: string | number;
  /** Set for HomeAssistantError / ServiceValidationError raised with a translation key. */
  translationDomain?: string;
  translationKey?: string;
  placeholders?: Record<string, string>;
  /** The websocket connection to HA dropped (pending command rejected, or the socket was closed). */
  connectionLost: boolean;
}

/**
 * Read a callService rejection. HA's websocket rejects with the error object
 * ({code, message, translation_domain, translation_key, translation_placeholders}); a lost
 * connection rejects with {type: "result", success: false, error: {code: 3, message}} or with
 * the bare number 3.
 */
export function parseServiceError(err: unknown): ServiceError {
  if (err === ERR_CONNECTION_LOST) return { code: ERR_CONNECTION_LOST, connectionLost: true };
  if (typeof err === "string") return { message: err, connectionLost: false };
  if (!err || typeof err !== "object") return { message: err === undefined ? undefined : String(err), connectionLost: false };
  const outer = err as Record<string, unknown>;
  const inner = outer.error && typeof outer.error === "object" ? (outer.error as Record<string, unknown>) : undefined;
  const pick = (key: string): unknown => outer[key] ?? inner?.[key];
  const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
  const rawCode = pick("code");
  const code = typeof rawCode === "string" || typeof rawCode === "number" ? rawCode : undefined;
  const placeholdersRaw = pick("translation_placeholders");
  const placeholders: Record<string, string> = {};
  if (placeholdersRaw && typeof placeholdersRaw === "object") {
    for (const [k, v] of Object.entries(placeholdersRaw as Record<string, unknown>)) placeholders[k] = String(v);
  }
  return {
    message: str(outer.message) ?? str(inner?.message) ?? str(outer.error),
    code,
    translationDomain: str(pick("translation_domain")),
    translationKey: str(pick("translation_key")),
    placeholders,
    connectionLost: code === ERR_CONNECTION_LOST && (inner !== undefined || outer.type === "result"),
  };
}

/** Raw text of a callService rejection (no translation): message, else code, else String(err). */
export function errorMessage(err: unknown): string {
  const e = parseServiceError(err);
  if (e.connectionLost) return "Connection lost";
  if (e.message) return e.message;
  if (e.code !== undefined) return String(e.code);
  return String(err);
}

/**
 * Typed helpers for every service the card uses. All calls pass notifyOnError=false
 * (the card shows errors itself) and returnResponse=false (no jbl_bar_91 service returns data).
 * Every promise rejects on error: run them through ctx.call().
 */
export class JblServices {
  constructor(
    private readonly hass: HomeAssistant,
    /** The bar's media_player: the target of every jbl_bar_91 service. */
    readonly mediaPlayer: string,
    /** Top of the bar's volume scale (32 on the Bar 9.1, 100 on JBL One bars). */
    readonly volumeMax: number = VOLUME_MAX,
    /** Levels set by stepping a "next level" button (JBL One Atmos), by the sensor used as the role entity. */
    private readonly cycles: Record<string, CycleLevel> = {},
    /** The latest hass, for reading a cycled level between button presses. */
    private readonly latestHass: () => HomeAssistant = () => hass,
  ) {}

  private run(domain: string, service: string, data: Record<string, unknown>, target: HassServiceTarget): Promise<unknown> {
    return this.hass.callService(domain, service, data, target, false, false);
  }

  private bar(domain: string, service: string, data: Record<string, unknown> = {}): Promise<unknown> {
    return this.run(domain, service, data, { entity_id: this.mediaPlayer });
  }

  /* ---- media_player ---- */
  turnOn(): Promise<unknown> {
    return this.bar("media_player", "turn_on");
  }
  turnOff(): Promise<unknown> {
    return this.bar("media_player", "turn_off");
  }
  volumeUp(): Promise<unknown> {
    return this.bar("media_player", "volume_up");
  }
  volumeDown(): Promise<unknown> {
    return this.bar("media_player", "volume_down");
  }
  /** Set the volume on the bar's own 0..32 scale (the integration steps there one action at a time). */
  setVolume(step: number): Promise<unknown> {
    const clamped = Math.min(this.volumeMax, Math.max(0, Math.round(step)));
    return this.bar("media_player", "volume_set", { volume_level: clamped / this.volumeMax });
  }
  mute(muted: boolean): Promise<unknown> {
    return this.bar("media_player", "volume_mute", { is_volume_muted: muted });
  }
  selectSource(source: BarSource): Promise<unknown> {
    return this.bar("media_player", "select_source", { source });
  }
  mediaPlay(): Promise<unknown> {
    return this.bar("media_player", "media_play");
  }
  mediaPause(): Promise<unknown> {
    return this.bar("media_player", "media_pause");
  }
  mediaStop(): Promise<unknown> {
    return this.bar("media_player", "media_stop");
  }
  mediaNext(): Promise<unknown> {
    return this.bar("media_player", "media_next_track");
  }
  mediaPrevious(): Promise<unknown> {
    return this.bar("media_player", "media_previous_track");
  }

  /* ---- generic entity services ---- */
  selectOption(entityId: string, option: string): Promise<unknown> {
    const cycle = this.cycles[entityId];
    if (cycle) return this.stepTo(entityId, cycle, option);
    return this.run("select", "select_option", { option }, { entity_id: entityId });
  }

  /**
   * Reach `option` on a level that only has a "next level" button: press it once per step,
   * waiting for the level sensor to move before the next press (the bar runs one key at a time).
   */
  private async stepTo(sensor: string, cycle: CycleLevel, option: string): Promise<void> {
    const target = cycle.options.indexOf(option);
    if (target < 0) throw new Error(`Unknown level: ${option}`);
    for (let guard = 0; guard < cycle.options.length; guard++) {
      const now = this.latestHass().states[sensor]?.state;
      const index = cycle.options.indexOf(now ?? "");
      if (index === target) return;
      await this.press(cycle.button);
      await this.waitFor(() => this.latestHass().states[sensor]?.state !== now, 6000);
    }
  }

  private waitFor(done: () => boolean, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = (): void => {
        if (done() || Date.now() - started > timeoutMs) resolve();
        else setTimeout(tick, 200);
      };
      tick();
    });
  }
  setNumber(entityId: string, value: number): Promise<unknown> {
    return this.run("number", "set_value", { value }, { entity_id: entityId });
  }
  setSwitch(entityId: string, on: boolean): Promise<unknown> {
    return this.run("switch", on ? "turn_on" : "turn_off", {}, { entity_id: entityId });
  }
  press(entityId: string): Promise<unknown> {
    return this.run("button", "press", {}, { entity_id: entityId });
  }

  /* ---- jbl_bar_91 entity services (target: the media_player) ---- */
  displayMessage(options: DisplayMessageOptions): Promise<unknown> {
    const lengths = [options.repeat !== undefined, options.duration !== undefined, options.forever === true];
    if (lengths.filter(Boolean).length > 1) {
      return Promise.reject(new Error("Choose only one of repeat, duration or until cancelled."));
    }
    const data: Record<string, unknown> = { message: options.message };
    if (options.id) data.id = options.id;
    if (options.repeat !== undefined) data.repeat = options.repeat;
    if (options.duration !== undefined) data.duration = options.duration;
    if (options.forever) data.forever = true;
    if (options.clear_on_key !== undefined) data.clear_on_key = options.clear_on_key;
    if (options.when_on !== undefined) data.when_on = options.when_on;
    if (options.keep_in_recent !== undefined) data.keep_in_recent = options.keep_in_recent;
    return this.bar(DOMAIN, "display_message", data);
  }
  /** Stop one message ("default" = the unnamed one), or every message without an id. */
  displayCancel(id?: string): Promise<unknown> {
    return this.bar(DOMAIN, "display_cancel", id ? { id } : {});
  }
  timerStart(options: TimerStartOptions): Promise<unknown> {
    const data: Record<string, unknown> = { duration: options.duration };
    const name = options.name?.trim();
    if (name) data.name = name;
    if (options.show_time_left !== undefined) data.show_time_left = options.show_time_left;
    data.sound = options.sound ?? "off";
    if (data.sound !== "off") {
      if (options.sound_volume !== undefined) data.sound_volume = options.sound_volume;
      if (options.ring_for !== undefined) data.ring_for = options.ring_for;
    }
    if (options.keep_in_recent !== undefined) data.keep_in_recent = options.keep_in_recent;
    return this.bar(DOMAIN, "timer_start", data);
  }
  timerCancel(which: TimerSelector): Promise<unknown> {
    return this.bar(DOMAIN, "timer_cancel", { ...which });
  }
  /** Add time (default 1 min) to a timer; without a selector, to the next timer to end. */
  timerExtend(which?: { id: string } | { name: string }, duration?: Duration): Promise<unknown> {
    const data: Record<string, unknown> = { ...(which ?? {}) };
    if (duration !== undefined) data.duration = duration;
    return this.bar(DOMAIN, "timer_extend", data);
  }
  /** Drop a recent timer/message: target is button.jbl_recent_timer_N or button.jbl_recent_message_N. */
  forgetRecent(recentButton: string): Promise<unknown> {
    return this.run(DOMAIN, "forget_recent", {}, { entity_id: recentButton });
  }
}
