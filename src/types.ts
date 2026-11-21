import type { CSSResult, TemplateResult, nothing } from "lit";
import type { JblServices } from "./services";

/* ------------------------------------------------------------------ */
/* Minimal Home Assistant typings (no maintained npm package exists).  */
/* ------------------------------------------------------------------ */

export interface HassContext {
  id: string;
  parent_id?: string | null;
  user_id?: string | null;
}

export interface HassEntityAttributes {
  friendly_name?: string;
  icon?: string;
  [key: string]: unknown;
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: HassEntityAttributes;
  last_changed: string;
  last_updated: string;
  context?: HassContext;
}

export type HassEntities = Record<string, HassEntity>;

/** `hass.entities` entry (entity_registry/list_for_display). Disabled entities are left out. */
export interface EntityRegistryDisplayEntry {
  entity_id: string;
  name?: string | null;
  icon?: string;
  device_id?: string;
  area_id?: string;
  labels?: string[];
  hidden?: boolean;
  entity_category?: "config" | "diagnostic";
  translation_key?: string;
  platform?: string;
  display_precision?: number;
  has_entity_name?: boolean;
}

export interface DeviceRegistryEntry {
  id: string;
  name: string | null;
  name_by_user: string | null;
  manufacturer?: string | null;
  model?: string | null;
  sw_version?: string | null;
  configuration_url?: string | null;
  area_id?: string | null;
}

export interface HassServiceTarget {
  entity_id?: string | string[];
  device_id?: string | string[];
  area_id?: string | string[];
}

export interface FrontendLocaleData {
  language: string;
  number_format?: string;
  time_format?: string;
  date_format?: string;
  time_zone?: string;
  first_weekday?: string;
}

export interface HassThemes {
  default_theme?: string;
  default_dark_theme?: string | null;
  themes?: Record<string, unknown>;
  darkMode: boolean;
  theme?: string;
}

export interface HomeAssistant {
  states: HassEntities;
  entities: Record<string, EntityRegistryDisplayEntry>;
  devices: Record<string, DeviceRegistryEntry>;
  locale: FrontendLocaleData;
  language?: string;
  themes: HassThemes | null;
  config?: { time_zone?: string; language?: string; [key: string]: unknown };
  callService(
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: HassServiceTarget,
    notifyOnError?: boolean,
    returnResponse?: boolean,
  ): Promise<unknown>;
  callWS<T>(msg: { type: string; [key: string]: unknown }): Promise<T>;
  formatEntityState?(stateObj: HassEntity, state?: string): string;
  /** HA's translator ("component.<domain>.exceptions.<key>.message"); returns "" when unknown. */
  localize?(key: string, values?: Record<string, string | number>): string;
}

/* ------------------------------------------------------------------ */
/* Card configuration                                                  */
/* ------------------------------------------------------------------ */

export type TabId = "home" | "sound" | "timers" | "system";
export const TAB_IDS: readonly TabId[] = ["home", "sound", "timers", "system"];

/** The YAML config as the user writes it. Only `type` is required (the bar is found if `entity` is left out). */
export interface JblBarCardConfig {
  type: string;
  entity?: string;
  name?: string;
  tabs?: TabId[];
  default_tab?: TabId;
  compact?: boolean;
  /**
   * Show the recent timers/messages even when several JBL bars exist. Their buttons
   * (button.jbl_recent_*) are not tied to a device and belong to the first bar HA loaded.
   */
  recent?: boolean;
}

/** The config after validation and defaults. */
export interface NormalizedConfig {
  type: string;
  entity?: string;
  name?: string;
  tabs: TabId[];
  default_tab: TabId;
  compact: boolean;
  recent: boolean;
}

/* ------------------------------------------------------------------ */
/* Discovered entities                                                 */
/* ------------------------------------------------------------------ */

/**
 * Every registered jbl_bar_91 entity a card can use, by role.
 * The role is the integration's translation_key (= entity key); the value is its domain.
 * The media_player has no translation_key and is found by domain.
 */
export const ROLE_DOMAINS = {
  media_player: "media_player",
  // select
  bass: "select",
  center: "select",
  atmos: "select",
  rear: "select",
  eq_preset: "select",
  display_clock_when: "select",
  // number (the five eq_band numbers are in BarEntities.eqBands)
  audio_sync: "number",
  bass_offset: "number",
  // switch
  night: "switch",
  smart_mode: "switch",
  display_clock: "switch",
  // button
  standard_mode: "button",
  bluetooth_pairing: "button",
  calibrate: "button",
  sub_pair: "button",
  clear_messages: "button",
  restart: "button",
  // sensor
  sound_mode: "sensor",
  bluetooth_device: "sensor",
  bluetooth_audio: "sensor",
  cpu: "sensor",
  memory: "sensor",
  temperature: "sensor",
  wifi_signal: "sensor",
  uptime: "sensor",
  rear_battery_left: "sensor",
  rear_battery_right: "sensor",
  audio_format: "sensor",
  calibration: "sensor",
  subwoofer: "sensor",
  mode_after_standby: "sensor",
  front_eq_status: "sensor",
  timers: "sensor",
  next_timer: "sensor",
  messages: "sensor",
  // binary_sensor
  rear_docked: "binary_sensor",
  bluetooth_connected: "binary_sensor",
  command_running: "binary_sensor",
  timer_ringing: "binary_sensor",
  // event
  timer_events: "event",
  message_events: "event",
  // notify
  display: "notify",
} as const;

export type Role = keyof typeof ROLE_DOMAINS;

/** Entity ids found for one bar. A role is missing when the entity does not exist (older remote, disabled entity). */
export type BarEntities = Partial<Record<Role, string>> & {
  /** The bar's media_player: the target of every jbl_bar_91 service. */
  media_player: string;
  device_id?: string;
  /** The five Front EQ bands by index: 0 = 125 Hz, 1 = 500 Hz, 2 = 2 kHz, 3 = 4 kHz, 4 = 8 kHz. */
  eqBands: (string | undefined)[];
  /** Band entities whose index came from registry order only (no name, id or unique_id match). */
  eqBandsGuessed: string[];
  /** Unregistered fixed-id buttons that exist in hass.states (empty when they cannot be tied to this bar). */
  timerLines: string[];
  messageLines: string[];
  recentTimers: string[];
  recentMessages: string[];
  /** More than one jbl_bar_91 media_player exists. */
  multipleBars: boolean;
};

/* ------------------------------------------------------------------ */
/* Tab contract                                                        */
/* ------------------------------------------------------------------ */

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface CallOptions {
  /** The value the control is moving to: read it back with ctx.pendingValue(key) to show it while pending. */
  value?: unknown;
  /**
   * Keep the control pending after the service call resolved until this returns true
   * (checked with the LATEST hass on every update) or until `timeoutMs` passes.
   * Read state from the `hass` argument, not from a captured ctx (it would be stale).
   */
  until?: (hass: HomeAssistant) => boolean;
  /** Upper bound for `until`, default 20000 ms. */
  timeoutMs?: number;
  /** Skip the "is the bar reachable" check (e.g. forget_recent, which never talks to the bar). */
  offline?: boolean;
  /**
   * Called when the service call fails, before the error is shown. Return a text to show
   * instead of the translated service error.
   */
  onError?: (err: unknown) => string | undefined | void;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
}

export interface BusyInfo {
  /** binary_sensor command_running is on. */
  running: boolean;
  /** The remote action name (e.g. "bass_next", "bar91.timer.start"), when known. */
  action: string | null;
  /** "home_assistant" | "remote" | null */
  source: string | null;
}

/**
 * Everything a tab renderer gets. A tab is a pure function `(ctx) => TemplateResult`;
 * all state lives in the card (ctx.local) or in Home Assistant.
 */
export interface TabContext {
  hass: HomeAssistant;
  config: NormalizedConfig;
  entities: BarEntities;
  /** Typed service helpers bound to this bar's media_player. */
  services: JblServices;
  lang: "en" | "uk" | "fr";
  /** Translate a key ("home.volume", "sound.bass"...); `vars.count` picks plural forms (key_one, key_few, key_many, key_other). */
  t: Translate;
  /** State object for a role or an entity_id; undefined when the entity is missing. */
  stateOf(roleOrEntityId: Role | string | undefined): HassEntity | undefined;
  /** True when the entity exists and its state is neither "unavailable" nor missing. */
  isAvailable(roleOrEntityId: Role | string | undefined): boolean;
  /** The bar's media_player state is "unavailable" (remote unreachable). */
  barUnavailable: boolean;
  /** The bar is on (media_player state is not off/unavailable/unknown). */
  barOn: boolean;
  busy: BusyInfo;
  /** Date.now() at render time. */
  now: number;
  /** Ask for a re-render every second while this tab shows something live (countdowns). Call it during render. */
  wantTick(): void;
  /**
   * Run a service call with the shared pending/error handling:
   * - marks `key` pending until fn settles (and until `opts.until` holds),
   * - refuses with an inline error when the bar is unreachable (HA would skip the call silently),
   * - shows any rejection in the card's error strip.
   * Resolves true on success, false on error. Never rejects.
   */
  call(key: string, fn: () => Promise<unknown>, opts?: CallOptions): Promise<boolean>;
  isPending(key: string): boolean;
  /** The `value` passed to the pending call for `key`, else undefined. */
  pendingValue<T = unknown>(key: string): T | undefined;
  /**
   * Show an error (client-side validation). With `key`, a tab that renders ctx.renderError(key)
   * shows it next to that control; otherwise it goes to the card's error strip.
   */
  showError(message: string, key?: string): void;
  /**
   * Render the errors of these pending keys right here (next to the control that failed) instead
   * of in the strip at the top of the card. Call it during render. Such an error stays until it
   * is dismissed or the key is called again.
   */
  renderError(keys: string | string[]): TemplateResult | typeof nothing;
  /** Ask the user; resolves true when they confirm. */
  confirm(opts: ConfirmOptions): Promise<boolean>;
  /** Per-card local UI state that survives re-renders: ctx.local("timers.form", () => ({ minutes: 5 })). Mutate it, then call requestUpdate(). */
  local<T extends object>(key: string, init: () => T): T;
  requestUpdate(): void;
  /** Open HA's more-info dialog for an entity. */
  moreInfo(entityId: string | undefined): void;
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
  /** Local time "HH:MM" honouring the HA time format. */
  formatTime(date: Date | string | number): string;
  /** "7:05" or "1:05:30" (for countdowns). */
  formatDuration(totalSeconds: number): string;
}

export type TabRenderer = (ctx: TabContext) => TemplateResult;

export interface TabModule {
  render: TabRenderer;
  styles: CSSResult;
}
