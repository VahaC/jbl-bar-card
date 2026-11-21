/**
 * A fake Home Assistant with one JBL Bar 9.1 (jbl_bar_91 integration v0.13.2) for the demo page
 * and the tests. It models the remote's state and derives every entity the integration creates,
 * with the same entity ids (English), translation keys, states and attributes.
 *
 * callService() simulates the integration: calls are serialized (one command at a time),
 * take ~600 ms, switch binary_sensor command_running on while they run, and refuse the same
 * things the remote refuses (rear level while docked, pairing outside Bluetooth, ...).
 */
import type {
  DeviceRegistryEntry,
  EntityRegistryDisplayEntry,
  HassEntities,
  HassEntity,
  HassServiceTarget,
  HomeAssistant,
} from "../src/types";
import { foldDisplayText } from "../src/services";

export const DEVICE_ID = "d1c0ffee5ba791";
export const MEDIA_PLAYER = "media_player.jbl_bar_9_1";

/** Registered entities: entity_id -> [translation_key, entity_category?]. */
const REGISTERED: Record<string, [string | undefined, ("config" | "diagnostic")?]> = {
  [MEDIA_PLAYER]: [undefined],
  "select.jbl_bar_9_1_bass_level": ["bass"],
  "select.jbl_bar_9_1_center_level": ["center"],
  "select.jbl_bar_9_1_atmos_height": ["atmos"],
  "select.jbl_bar_9_1_rear_speakers": ["rear"],
  "select.jbl_bar_9_1_front_eq_preset": ["eq_preset"],
  "select.jbl_display_clock_when": ["display_clock_when"],
  "number.jbl_bar_9_1_front_eq_125_hz": ["eq_band", "config"],
  "number.jbl_bar_9_1_front_eq_500_hz": ["eq_band", "config"],
  "number.jbl_bar_9_1_front_eq_2_khz": ["eq_band", "config"],
  "number.jbl_bar_9_1_front_eq_4_khz": ["eq_band", "config"],
  "number.jbl_bar_9_1_front_eq_8_khz": ["eq_band", "config"],
  "number.jbl_bar_9_1_audio_sync": ["audio_sync", "config"],
  "number.jbl_bar_9_1_bass_offset": ["bass_offset", "config"],
  "switch.jbl_bar_9_1_night_mode": ["night"],
  "switch.jbl_bar_9_1_smart_mode": ["smart_mode", "config"],
  "switch.jbl_display_clock": ["display_clock"],
  "button.jbl_bar_9_1_bluetooth_pairing": ["bluetooth_pairing"],
  "button.jbl_bar_9_1_calibrate_surround": ["calibrate", "config"],
  "button.jbl_bar_9_1_pair_subwoofer": ["sub_pair", "config"],
  "button.jbl_bar_9_1_clear_all_messages": ["clear_messages"],
  "button.jbl_bar_9_1_restart": ["restart", "config"],
  "sensor.jbl_bar_9_1_sound_mode": ["sound_mode"],
  "sensor.jbl_bar_9_1_bluetooth_device": ["bluetooth_device"],
  "sensor.jbl_bar_9_1_bluetooth_audio": ["bluetooth_audio"],
  "sensor.jbl_bar_9_1_cpu": ["cpu", "diagnostic"],
  "sensor.jbl_bar_9_1_memory_used": ["memory", "diagnostic"],
  "sensor.jbl_bar_9_1_temperature": ["temperature", "diagnostic"],
  "sensor.jbl_bar_9_1_wi_fi_signal": ["wifi_signal", "diagnostic"],
  "sensor.jbl_bar_9_1_uptime": ["uptime", "diagnostic"],
  "sensor.jbl_bar_9_1_rear_left_battery": ["rear_battery_left"],
  "sensor.jbl_bar_9_1_rear_right_battery": ["rear_battery_right"],
  "sensor.jbl_bar_9_1_audio_format": ["audio_format"],
  "sensor.jbl_bar_9_1_calibration": ["calibration", "diagnostic"],
  "sensor.jbl_bar_9_1_subwoofer": ["subwoofer", "diagnostic"],
  "sensor.jbl_bar_9_1_mode_after_standby": ["mode_after_standby", "diagnostic"],
  "sensor.jbl_bar_9_1_front_eq_status": ["front_eq_status"],
  "sensor.jbl_bar_9_1_timers": ["timers"],
  "sensor.jbl_bar_9_1_next_timer": ["next_timer"],
  "sensor.jbl_bar_9_1_messages": ["messages"],
  "binary_sensor.jbl_bar_9_1_rear_speakers_docked": ["rear_docked"],
  "binary_sensor.jbl_bar_9_1_bluetooth_connected": ["bluetooth_connected"],
  "binary_sensor.jbl_bar_9_1_command_running": ["command_running"],
  "binary_sensor.jbl_bar_9_1_timer_ringing": ["timer_ringing"],
  "event.jbl_bar_9_1_timer_events": ["timer_events"],
  "event.jbl_bar_9_1_message_events": ["message_events"],
  "notify.jbl_bar_9_1_display": ["display"],
};

const ID = {
  bass: "select.jbl_bar_9_1_bass_level",
  center: "select.jbl_bar_9_1_center_level",
  atmos: "select.jbl_bar_9_1_atmos_height",
  rear: "select.jbl_bar_9_1_rear_speakers",
  eqPreset: "select.jbl_bar_9_1_front_eq_preset",
  clockWhen: "select.jbl_display_clock_when",
  bands: [
    "number.jbl_bar_9_1_front_eq_125_hz",
    "number.jbl_bar_9_1_front_eq_500_hz",
    "number.jbl_bar_9_1_front_eq_2_khz",
    "number.jbl_bar_9_1_front_eq_4_khz",
    "number.jbl_bar_9_1_front_eq_8_khz",
  ],
  avSync: "number.jbl_bar_9_1_audio_sync",
  bassOffset: "number.jbl_bar_9_1_bass_offset",
  night: "switch.jbl_bar_9_1_night_mode",
  smart: "switch.jbl_bar_9_1_smart_mode",
  clock: "switch.jbl_display_clock",
  btPair: "button.jbl_bar_9_1_bluetooth_pairing",
  calibrate: "button.jbl_bar_9_1_calibrate_surround",
  subPair: "button.jbl_bar_9_1_pair_subwoofer",
  clearMessages: "button.jbl_bar_9_1_clear_all_messages",
  restart: "button.jbl_bar_9_1_restart",
  commandRunning: "binary_sensor.jbl_bar_9_1_command_running",
} as const;

const SOURCES = ["TV", "HDMI", "Bluetooth"] as const;
type Source = (typeof SOURCES)[number];
const BASE_FEATURES = 3468;
const ALL_PLAYBACK = 23997;

export const EQ_PRESETS: Record<string, number[]> = {
  original: [0, 0, 0, 0, 0],
  less_bass: [-4, -2, 0, 0, 0],
  clear_dialogue: [-3, -1, 0, 0, -1],
  softer_treble: [0, 0, 0, -2, -3],
  warm: [0, 0, -1, -2, -3],
  bright: [-3, -2, -1, 0, 0],
  vocal_focus: [-4, -2, 0, -1, -2],
};
const CENTER_OPTIONS = ["0", "1", "2", "3", "4", "5"];
const BASS_OPTIONS = ["1", "2", "3", "4", "5"];
const ATMOS_OPTIONS = ["low", "mid", "high"];
const REAR_OPTIONS = ["low", "mid", "high", "muted"];

interface Timer {
  id: string;
  name: string;
  ringing: boolean;
  endsAt: number | null;
  ringingSince?: number;
  countdown: boolean;
  sound: "off" | "unless_tv" | "always";
  durationS: number;
}

interface Message {
  id: string;
  text: string;
  mode: "passes" | "duration" | "forever";
  passesLeft: number | null;
  endsAt: number | null;
  durationS: number | null;
  whenOn: boolean;
  held: boolean;
  clearOnKey: boolean;
}

interface Plan {
  /** Remote action name shown by command_running. */
  action: string;
  /** Duration in units of delayMs. */
  steps?: number;
  /** Rejected before anything runs (schema/validation errors). */
  reject?: Error;
  apply: () => void;
}

interface RecentTimer {
  text: string;
  minutes: number;
  sound: Timer["sound"];
  countdown: boolean;
}

interface RecentMessage {
  text: string;
  id?: string;
  forever?: boolean;
  durationS?: number;
  repeat?: number;
  whenOn?: boolean;
}

export interface MockOptions {
  /** HA language ("en", "uk", "fr"...). */
  language?: string;
  dark?: boolean;
  /** Clock for timers (tests pass a fixed value). */
  now?: () => number;
  /** Simulated duration of one remote action. */
  delayMs?: number;
  log?: (line: string) => void;
}

/** A HA websocket error as hass.callService rejects with it. */
export class MockServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const refused = (error: string): MockServiceError =>
  new MockServiceError("home_assistant_error", `The soundbar refused the control: ${error}`);

/** The remote folds names and texts with displayText (the card mirrors it). */
const fold = (text: string): string => foldDisplayText(text);

function durationSeconds(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    if (/^\d+$/.test(value)) return Number(value);
    const parts = value.split(":").map(Number);
    if (parts.length === 2) return parts[0] * 3600 + parts[1] * 60;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return NaN;
  }
  if (value && typeof value === "object") {
    const d = value as { days?: number; hours?: number; minutes?: number; seconds?: number };
    return (d.days ?? 0) * 86400 + (d.hours ?? 0) * 3600 + (d.minutes ?? 0) * 60 + (d.seconds ?? 0);
  }
  return NaN;
}

const iso = (ms: number): string => new Date(Math.round(ms / 1000) * 1000).toISOString().replace(".000Z", "+00:00");
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class MockBar {
  language: string;
  dark: boolean;
  delayMs: number;
  readonly entities: Record<string, EntityRegistryDisplayEntry>;
  readonly devices: Record<string, DeviceRegistryEntry>;
  /** Every service call, for tests. */
  readonly calls: { domain: string; service: string; data: Record<string, unknown>; target?: HassServiceTarget }[] = [];

  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly listeners = new Set<() => void>();
  private states: HassEntities = {};
  private snapshot?: HomeAssistant;
  private queue: Promise<unknown> = Promise.resolve();
  private seq = 4;
  private readonly started: number;

  // ---- remote model ----
  reachable = true;
  power: "On" | "Standby" = "On";
  volume = 14;
  muted = false;
  source: Source = "Bluetooth";
  smart = false;
  night = false;
  bass = 2; // index: option "3"
  center = 1;
  atmos = 1;
  rear = 2;
  docked = false;
  batteryLeft = 14;
  batteryRight = 76;
  gains: number[] = [...EQ_PRESETS.warm];
  bassOffset = 0.5;
  /** The remote asks for an EQ reset (eq status "reset_required"); selecting "original" clears it. */
  eqResetNeeded = false;
  avSync = 40;
  clockOn = true;
  clockWhen: "standby" | "always" = "standby";
  calibration = "Idle";
  subPairing = false;
  /**
   * What sensor.subwoofer reports. The remote only knows the subwoofer state while the bar's display
   * shows a subwoofer message (toolkit setup.go), so it is usually "unknown".
   */
  subStatus = "unknown";
  playerState: "PLAYING" | "PAUSED" | "IDLE" = "PLAYING";
  btConnected = true;
  cpu = 23;
  memory = 41.7;
  temperature = 52;
  wifi = -58;
  local: { action: string | null; source: "home_assistant" | "remote" | null } = { action: null, source: null };
  timers: Timer[];
  messages: Message[];
  recentTimers: RecentTimer[] = [
    { text: "EGGS", minutes: 7, sound: "unless_tv", countdown: true },
    { text: "", minutes: 5, sound: "unless_tv", countdown: false },
    { text: "PASTA", minutes: 10, sound: "always", countdown: true },
    { text: "LAUNDRY", minutes: 60, sound: "off", countdown: false },
  ];
  recentMessages: RecentMessage[] = [
    { text: "DOOR OPEN", id: "door", forever: true },
    { text: "CALL MOM", repeat: 3 },
    { text: "WASHING DONE", durationS: 900 },
    { text: "BED TIME", id: "bed", forever: true, whenOn: true },
  ];

  constructor(options: MockOptions = {}) {
    this.language = options.language ?? "en";
    this.dark = options.dark ?? false;
    this.delayMs = options.delayMs ?? 600;
    this.now = options.now ?? (() => Date.now());
    this.log = options.log ?? (() => undefined);
    this.started = this.now();
    const now = this.now();
    this.timers = [
      { id: "t1", name: "TEA", ringing: true, endsAt: null, ringingSince: now - 20000, countdown: false, sound: "always", durationS: 240 },
      { id: "t2", name: "PIZZA", ringing: false, endsAt: now + 7 * 60000 + 12000, countdown: true, sound: "unless_tv", durationS: 900 },
      { id: "t3", name: "", ringing: false, endsAt: now + 42 * 60000, countdown: false, sound: "off", durationS: 3600 },
    ];
    this.messages = [
      { id: "fridge", text: "FRIDGE OPEN", mode: "forever", passesLeft: null, endsAt: null, durationS: null, whenOn: false, held: false, clearOnKey: true },
      { id: "default", text: "DINNER AT 8", mode: "passes", passesLeft: 3, endsAt: null, durationS: null, whenOn: false, held: false, clearOnKey: false },
    ];
    this.devices = {
      [DEVICE_ID]: {
        id: DEVICE_ID,
        name: "JBL Bar 9.1",
        name_by_user: null,
        manufacturer: "JBL",
        model: "Bar 9.1 True Wireless Surround",
        sw_version: null,
        configuration_url: "http://192.168.1.50",
        area_id: "living_room",
      },
      other: { id: "other", name: "Kitchen lamp", name_by_user: null },
    };
    const entities: Record<string, EntityRegistryDisplayEntry> = {};
    for (const [entityId, [key, category]] of Object.entries(REGISTERED)) {
      entities[entityId] = {
        entity_id: entityId,
        device_id: DEVICE_ID,
        platform: "jbl_bar_91",
        translation_key: key,
        entity_category: category,
        has_entity_name: true,
        labels: [],
      };
    }
    // An unrelated entity, to prove discovery filters by platform + device.
    entities["light.kitchen"] = { entity_id: "light.kitchen", device_id: "other", platform: "hue", labels: [] };
    this.entities = entities;
    this.rebuild(false);
  }

  /* ------------------------------------------------------------ */
  /* Public API                                                    */
  /* ------------------------------------------------------------ */

  /** A HA object; a new one after every change (like the real frontend). */
  hass(): HomeAssistant {
    if (this.snapshot) return this.snapshot;
    const lang = this.language;
    this.snapshot = {
      states: this.states,
      entities: this.entities,
      devices: this.devices,
      locale: { language: lang, number_format: "language", time_format: "language" },
      language: lang,
      themes: { darkMode: this.dark, theme: "default", default_theme: "default", themes: {} },
      config: { time_zone: "Europe/Kyiv", language: lang },
      callService: (domain, service, data, target) => this.callService(domain, service, data ?? {}, target),
      callWS: async <T>(msg: { type: string; [key: string]: unknown }): Promise<T> => {
        if (msg.type === "config/entity_registry/get_entries") {
          const out: Record<string, { unique_id: string } | null> = {};
          for (const id of (msg.entity_ids as string[]) ?? []) {
            const band = ID.bands.indexOf(id as (typeof ID.bands)[number]);
            out[id] = band >= 0 ? { unique_id: `01JBLBAR91_eq_band_${band}` } : null;
          }
          return out as T;
        }
        throw new MockServiceError("unknown_command", `Unknown command ${msg.type}`);
      },
    };
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setLanguage(language: string): void {
    this.language = language;
    this.changed();
  }

  setDark(dark: boolean): void {
    this.dark = dark;
    this.changed();
  }

  /** Change model fields and re-derive the entities. */
  update(fn: (bar: this) => void): void {
    fn(this);
    this.rebuild();
  }

  /** Something done on the bar's own web page: command_running with source "remote". */
  async simulateRemote(action = "bass_next", ms = 4000): Promise<void> {
    this.update((b) => (b.local = { action, source: "remote" }));
    await sleep(ms);
    this.update((b) => {
      if (action === "bass_next") b.bass = (b.bass + 1) % BASS_OPTIONS.length;
      b.local = { action: null, source: null };
    });
  }

  /** Advance live things: timers ending/ringing, messages, metrics. Call once a second. */
  tick(): void {
    const now = this.now();
    for (const t of this.timers) {
      if (!t.ringing && t.endsAt !== null && t.endsAt <= now) {
        t.ringing = true;
        t.endsAt = null;
        t.ringingSince = now;
      }
    }
    // The bar rings up to 10 min; the mock stops a ringing timer after 2 min.
    this.timers = this.timers.filter((t) => !(t.ringing && t.ringingSince !== undefined && now - t.ringingSince > 120000));
    this.messages = this.messages.filter((m) => !(m.mode === "duration" && m.endsAt !== null && m.endsAt <= now));
    const secs = Math.floor((now - this.started) / 1000);
    if (secs % 8 === 0) {
      const showing = this.messages.find((m) => !m.held);
      if (showing && showing.mode === "passes" && showing.passesLeft !== null) {
        showing.passesLeft -= 1;
        if (showing.passesLeft <= 0) this.messages = this.messages.filter((m) => m !== showing);
      }
    }
    if (secs % 5 === 0) {
      this.cpu = Math.round(15 + Math.random() * 25);
      this.temperature = Math.round(50 + Math.random() * 5);
    }
    this.rebuild();
  }

  /* ------------------------------------------------------------ */
  /* Service simulation                                            */
  /* ------------------------------------------------------------ */

  callService(domain: string, service: string, data: Record<string, unknown> = {}, target?: HassServiceTarget): Promise<unknown> {
    this.calls.push({ domain, service, data, target });
    const ids = ([] as string[]).concat((target?.entity_id ?? data.entity_id ?? []) as string | string[]);
    this.log(`→ ${domain}.${service} ${JSON.stringify(data)} ${ids.join(", ")}`);
    const run = async (): Promise<unknown> => {
      if (!this.reachable) {
        // HA skips unavailable entities in entity services: the call "succeeds" and does nothing.
        this.log("  skipped: the bar is unavailable");
        return { context: { id: "" } };
      }
      const plan = this.plan(domain, service, data, ids[0]);
      if (plan.reject) {
        this.log(`  ✗ ${plan.reject.message}`);
        throw plan.reject;
      }
      this.update((b) => (b.local = { action: plan.action, source: "home_assistant" }));
      try {
        await sleep(this.delayMs * (plan.steps ?? 1));
        plan.apply();
        this.log(`  ✓ ${plan.action}`);
      } catch (err) {
        this.log(`  ✗ ${(err as Error).message}`);
        throw err;
      } finally {
        this.update((b) => (b.local = { action: null, source: null }));
      }
      return { context: { id: `ctx${++this.seq}` } };
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private plan(
    domain: string,
    service: string,
    data: Record<string, unknown>,
    entityId: string | undefined,
  ): Plan {
    const fail = (err: Error): Plan => ({ action: "unknown", reject: err, apply: () => undefined });
    const awake = this.power === "On";
    const unknown = () => fail(new MockServiceError("not_found", `Service ${domain}.${service} not found.`));

    if (domain === "media_player") {
      switch (service) {
        case "turn_on":
          return { action: "power", steps: 3, apply: () => (this.power = "On") };
        case "turn_off":
          return { action: "power", steps: 2, apply: () => (this.power = "Standby") };
        case "volume_up":
          return { action: "volume_up", apply: () => (this.volume = Math.min(32, this.volume + 1)) };
        case "volume_down":
          return { action: "volume_down", apply: () => (this.volume = Math.max(0, this.volume - 1)) };
        case "volume_set": {
          const target = Math.min(32, Math.max(0, Math.round(Number(data.volume_level) * 32)));
          const up = target >= this.volume;
          return { action: up ? "volume_up" : "volume_down", steps: Math.max(1, Math.abs(target - this.volume) * 0.4), apply: () => (this.volume = target) };
        }
        case "volume_mute":
          return { action: "mute", apply: () => (this.muted = data.is_volume_muted === true) };
        case "select_source": {
          const source = data.source as Source;
          if (!SOURCES.includes(source)) return { action: "unknown", apply: () => undefined };
          return {
            action: `input_${source.toLowerCase()}`,
            steps: 2,
            apply: () => {
              this.source = source;
              this.playerState = source === "Bluetooth" ? "PLAYING" : "IDLE";
            },
          };
        }
        case "media_play":
        case "media_pause":
        case "media_stop":
        case "media_next_track":
        case "media_previous_track": {
          const action = { media_play: "media_play", media_pause: "media_pause", media_stop: "media_stop", media_next_track: "media_next", media_previous_track: "media_previous" }[service]!;
          if (this.source !== "Bluetooth" || !awake) return { action, apply: () => { throw refused("this source does not report support for that playback control"); } };
          return {
            action,
            apply: () => {
              if (service === "media_play") this.playerState = "PLAYING";
              if (service === "media_pause") this.playerState = "PAUSED";
              if (service === "media_stop") this.playerState = "IDLE";
            },
          };
        }
        default:
          return unknown();
      }
    }

    if (domain === "select" && service === "select_option" && entityId) {
      const option = String(data.option);
      const cycle = (options: string[], current: number, action: string, set: (i: number) => void) => {
        const index = options.indexOf(option);
        if (index < 0) return fail(new MockServiceError("service_validation_error", `Option ${option} is not valid.`));
        const steps = (index - current + options.length) % options.length;
        return { action, steps: Math.max(1, steps), apply: () => set(index) };
      };
      switch (entityId) {
        case ID.bass:
          return cycle(BASS_OPTIONS, this.bass, "bass_next", (i) => (this.bass = i));
        case ID.center:
          return cycle(CENTER_OPTIONS, this.center, "center_next", (i) => (this.center = i));
        case ID.atmos:
          return cycle(ATMOS_OPTIONS, this.atmos, "atmos_next", (i) => (this.atmos = i));
        case ID.rear:
          if (this.docked) return { action: "rear_next", apply: () => { throw refused("undock both rear speakers first"); } };
          return cycle(REAR_OPTIONS, this.rear, "rear_next", (i) => (this.rear = i));
        case ID.eqPreset: {
          const curve = EQ_PRESETS[option];
          if (!curve) return fail(new MockServiceError("service_validation_error", `Option ${option} is not valid.`));
          return {
            action: option === "original" ? "eq_reset" : "eq_apply",
            apply: () => {
              this.gains = [...curve];
              if (option === "original") this.eqResetNeeded = false;
            },
          };
        }
        case ID.clockWhen:
          return { action: "bar91.display-clock.set", apply: () => (this.clockWhen = option === "always" ? "always" : "standby") };
        default:
          return unknown();
      }
    }

    if (domain === "number" && service === "set_value" && entityId) {
      const value = Number(data.value);
      const band = ID.bands.indexOf(entityId as (typeof ID.bands)[number]);
      if (band >= 0) {
        return {
          action: "eq_apply",
          apply: () => {
            const gains = [...this.gains];
            gains[band] = Math.round(value * 2) / 2;
            this.gains = gains;
          },
        };
      }
      if (entityId === ID.avSync) {
        return { action: "av_sync_set", steps: 1 + Math.abs(value - this.avSync) / 20, apply: () => (this.avSync = value) };
      }
      if (entityId === ID.bassOffset) {
        if (value < -3 || value > 3 || Math.round(value * 2) !== value * 2) {
          return fail(new MockServiceError("home_assistant_error", "The bass offset goes from -3 to +3 dB in 0.5 dB steps."));
        }
        return { action: "bar91.bass-offset.set", apply: () => (this.bassOffset = value) };
      }
      return unknown();
    }

    if (domain === "switch" && entityId) {
      const on = service === "turn_on";
      if (entityId === ID.night) return { action: "night_toggle", apply: () => (this.night = on) };
      if (entityId === ID.smart) return { action: on ? "smart" : "standard", apply: () => (this.smart = on) };
      if (entityId === ID.clock) return { action: "bar91.display-clock.set", apply: () => (this.clockOn = on) };
      return unknown();
    }

    if (domain === "button" && service === "press" && entityId) return this.planButton(entityId);

    if (domain === "jbl_bar_91") return this.planJbl(service, data, entityId);

    return unknown();
  }

  private planButton(entityId: string): Plan {
    switch (entityId) {
      case ID.restart:
        return {
          action: "bar91.system.reboot",
          apply: () => {
            this.reachable = false;
            setTimeout(() => this.update((b) => (b.reachable = true)), 8000);
          },
        };
      case ID.clearMessages:
        return { action: "bar91.display-message.cancel", apply: () => (this.messages = []) };
      case ID.btPair:
        if (this.source !== "Bluetooth") {
          return { action: "bluetooth_pair", apply: () => { throw refused("select Bluetooth first; pairing status must be available"); } };
        }
        return { action: "bluetooth_pair", apply: () => undefined };
      case ID.calibrate: {
        const step = this.calibration.startsWith("Step 1") ? 2 : 1;
        return {
          action: "calibrate",
          apply: () => {
            this.calibration = `Step ${step} starting`;
            setTimeout(() => this.update((b) => (b.calibration = "Measuring")), 2000);
            setTimeout(() => this.update((b) => (b.calibration = `Step ${step} done`)), 8000);
          },
        };
      }
      case ID.subPair:
        return {
          action: "sub_pair",
          apply: () => {
            this.subPairing = true;
            setTimeout(
              () =>
                this.update((b) => {
                  b.subPairing = false;
                  b.subStatus = "Connected";
                }),
              6000,
            );
          },
        };
    }
    const line = entityId.match(/^button\.jbl_(timer|message)_line_(\d)$/);
    if (line) {
      const n = Number(line[2]) - 1;
      if (line[1] === "timer") {
        const t = this.sortedTimers()[n];
        return { action: "bar91.timer.cancel", apply: () => (this.timers = this.timers.filter((x) => x !== t)) };
      }
      const m = this.messages[n];
      return { action: "bar91.display-message.cancel", apply: () => (this.messages = this.messages.filter((x) => x !== m)) };
    }
    const recent = entityId.match(/^button\.jbl_recent_(timer|message)_(\d)$/);
    if (recent) {
      const n = Number(recent[2]) - 1;
      if (recent[1] === "timer") {
        const r = this.visibleRecentTimers()[n];
        if (!r) return { action: "bar91.timer.start", apply: () => undefined };
        return { action: "bar91.timer.start", apply: () => this.startTimer(r.text, r.minutes * 60, r.sound, r.countdown, true) };
      }
      const r = this.visibleRecentMessages()[n];
      if (!r) return { action: "bar91.display-message.show", apply: () => undefined };
      return {
        action: "bar91.display-message.show",
        apply: () => this.showMessage(r.text, r.id, { forever: r.forever, durationS: r.durationS, repeat: r.repeat, whenOn: r.whenOn }, true),
      };
    }
    return { action: "unknown", apply: () => undefined };
  }

  private planJbl(service: string, data: Record<string, unknown>, entityId: string | undefined): Plan {
    const invalid = (message: string): Plan => ({
      action: "unknown",
      reject: new MockServiceError("service_validation_error", message),
      apply: () => undefined,
    });
    switch (service) {
      case "timer_start": {
        const seconds = Math.floor(durationSeconds(data.duration));
        if (!(seconds >= 1 && seconds <= 43200)) return invalid("The duration goes from 1 second to 12 hours.");
        const name = fold(String(data.name ?? ""));
        return {
          action: "bar91.timer.start",
          apply: () => {
            if (this.timers.some((t) => t.name === name)) throw refused(name ? `a timer named ${name} is already running` : "an unnamed timer is already running");
            if (this.timers.length >= 8) throw refused("at most 8 timers can run");
            this.startTimer(name, seconds, (data.sound as Timer["sound"]) ?? "off", data.show_time_left === true, data.keep_in_recent !== false);
          },
        };
      }
      case "timer_cancel": {
        if (data.all) return { action: "bar91.timer.cancel", apply: () => (this.timers = []) };
        if (typeof data.id === "string") {
          return {
            action: "bar91.timer.cancel",
            apply: () => {
              if (!this.timers.some((t) => t.id === data.id)) throw refused(`no timer ${data.id}`);
              this.timers = this.timers.filter((t) => t.id !== data.id);
            },
          };
        }
        if (typeof data.name === "string") {
          const name = fold(data.name);
          if (!this.timers.some((t) => t.name === name)) return invalid(`No timer named ${data.name} is running.`);
          return { action: "bar91.timer.cancel", apply: () => (this.timers = this.timers.filter((t) => t.name !== name)) };
        }
        return invalid("Give the name or id of the timer, or choose all.");
      }
      case "timer_extend": {
        const add = data.duration === undefined ? 60 : Math.floor(durationSeconds(data.duration));
        if (!(add >= 1 && add <= 3600)) return invalid("The time added goes from 1 second to 1 hour.");
        const target =
          typeof data.id === "string"
            ? this.timers.find((t) => t.id === data.id)
            : typeof data.name === "string"
              ? this.timers.find((t) => !t.ringing && t.name === fold(String(data.name)))
              : this.sortedTimers().find((t) => !t.ringing);
        if (!target) return invalid(typeof data.name === "string" ? `No timer named ${data.name} is running.` : "No timer is running.");
        return {
          action: "bar91.timer.extend",
          apply: () => {
            if (target.ringing || target.endsAt === null) throw refused("a ringing timer cannot get more time");
            target.endsAt += add * 1000;
            target.durationS += add;
          },
        };
      }
      case "display_message": {
        const text = String(data.message ?? "");
        if (text.length < 1 || text.length > 64) return invalid("Invalid message: length must be 1 to 64.");
        if (data.id !== undefined && !/^[a-z0-9_-]{1,32}$/.test(String(data.id))) return invalid(`Invalid id: ${String(data.id)}`);
        const lengths = [data.repeat, data.duration, data.forever].filter((v) => v !== undefined && v !== null && v !== false);
        if (lengths.length > 1) return invalid("Choose only one of repeat, duration or until cancelled.");
        const durationS = data.duration !== undefined ? Math.floor(durationSeconds(data.duration)) : undefined;
        if (durationS !== undefined && !(durationS >= 1 && durationS <= 86400)) return invalid("The duration goes from 1 second to 24 hours.");
        return {
          action: "bar91.display-message.show",
          apply: () => {
            const folded = fold(text);
            if (folded.length > 31) throw refused("the text is longer than 31 characters");
            if (/[^A-Z0-9 \-.:!?']/.test(folded)) throw refused("the text has characters the display cannot show");
            this.showMessage(
              folded,
              data.id as string | undefined,
              {
                forever: data.forever === true,
                durationS,
                repeat: typeof data.repeat === "number" ? data.repeat : undefined,
                whenOn: data.when_on === true,
                clearOnKey: data.clear_on_key === true,
              },
              data.keep_in_recent !== false,
            );
          },
        };
      }
      case "display_cancel": {
        const id = typeof data.id === "string" && data.id ? data.id : undefined;
        return {
          action: "bar91.display-message.cancel",
          apply: () => (this.messages = id ? this.messages.filter((m) => m.id !== id) : []),
        };
      }
      case "forget_recent": {
        const m = entityId?.match(/^button\.jbl_recent_(timer|message)_(\d)$/);
        if (!m) return invalid(`${entityId} is not a recent timer or message: pick button.jbl_recent_timer_N or button.jbl_recent_message_N.`);
        const n = Number(m[2]) - 1;
        return {
          action: "forget_recent",
          steps: 0.2,
          apply: () => {
            if (m[1] === "timer") {
              const item = this.visibleRecentTimers()[n];
              this.recentTimers = this.recentTimers.filter((r) => r !== item);
            } else {
              const item = this.visibleRecentMessages()[n];
              this.recentMessages = this.recentMessages.filter((r) => r !== item);
            }
          },
        };
      }
      default:
        return invalid(`Service jbl_bar_91.${service} not found.`);
    }
  }

  private startTimer(name: string, seconds: number, sound: Timer["sound"], countdown: boolean, keep: boolean): void {
    const now = this.now();
    this.timers.push({ id: `t${++this.seq}`, name, ringing: false, endsAt: now + seconds * 1000, countdown, sound, durationS: seconds });
    if (keep) {
      const minutes = Math.max(1, Math.round(seconds / 60));
      this.recentTimers = [{ text: name, minutes, sound, countdown }, ...this.recentTimers.filter((r) => !(r.text === name && r.minutes === minutes))].slice(0, 8);
    }
  }

  private showMessage(
    text: string,
    id: string | undefined,
    length: { forever?: boolean; durationS?: number; repeat?: number; whenOn?: boolean; clearOnKey?: boolean },
    keep: boolean,
  ): void {
    const msgId = id ?? "default";
    const held = length.whenOn === true && this.power !== "On";
    const message: Message = {
      id: msgId,
      text,
      mode: length.forever ? "forever" : length.durationS ? "duration" : "passes",
      passesLeft: length.forever || length.durationS ? null : (length.repeat ?? 1),
      endsAt: length.durationS && !held ? this.now() + length.durationS * 1000 : null,
      durationS: length.durationS && held ? length.durationS : null,
      whenOn: length.whenOn === true,
      held,
      clearOnKey: length.clearOnKey === true,
    };
    const index = this.messages.findIndex((m) => m.id === msgId);
    if (index >= 0) this.messages[index] = message;
    else this.messages.push(message);
    if (keep) {
      const entry: RecentMessage = { text, id, forever: length.forever || undefined, durationS: length.durationS, repeat: length.repeat, whenOn: length.whenOn || undefined };
      this.recentMessages = [entry, ...this.recentMessages.filter((r) => !(r.text === text && r.id === id))].slice(0, 8);
    }
  }

  /* ------------------------------------------------------------ */
  /* Entity derivation                                             */
  /* ------------------------------------------------------------ */

  private sortedTimers(): Timer[] {
    return [...this.timers].sort((a, b) => {
      if (a.ringing !== b.ringing) return a.ringing ? -1 : 1;
      return (a.endsAt ?? 0) - (b.endsAt ?? 0);
    });
  }

  private visibleRecentTimers(): RecentTimer[] {
    return this.recentTimers.filter((r) => !this.timers.some((t) => t.name === r.text)).slice(0, 4);
  }

  private visibleRecentMessages(): RecentMessage[] {
    return this.recentMessages.filter((r) => !this.messages.some((m) => m.text === r.text && m.id === (r.id ?? "default"))).slice(0, 4);
  }

  private changed(): void {
    this.snapshot = undefined;
    for (const listener of this.listeners) listener();
  }

  /** Re-derive every entity; unchanged entities keep their object (like HA). */
  private rebuild(notify = true): void {
    const next: HassEntities = {};
    const old = this.states;
    const stamp = new Date(this.now()).toISOString();
    const put = (entityId: string, state: string, attributes: Record<string, unknown>): void => {
      const prev = old[entityId];
      if (prev && prev.state === state && JSON.stringify(prev.attributes) === JSON.stringify(attributes)) {
        next[entityId] = prev;
        return;
      }
      next[entityId] = {
        entity_id: entityId,
        state,
        attributes,
        last_changed: prev && prev.state === state ? prev.last_changed : stamp,
        last_updated: stamp,
        context: { id: `c${++this.seq}` },
      };
    };
    const up = this.reachable;
    const awake = up && this.power === "On";
    const name = (n: string) => `JBL Bar 9.1 ${n}`;
    /** An entity of the bar: unavailable keeps only friendly_name/icon (HA drops the rest). */
    const ent = (entityId: string, available: boolean, state: string, attrs: Record<string, unknown>, base: Record<string, unknown>) =>
      put(entityId, available ? state : "unavailable", available ? { ...attrs, ...base } : base);

    // media_player
    const features = awake && this.source === "Bluetooth" ? ALL_PLAYBACK : BASE_FEATURES;
    const mpBase = { friendly_name: "JBL Bar 9.1", device_class: "speaker", source_list: [...SOURCES], supported_features: features };
    const mpState = !up ? "unavailable" : this.power === "Standby" ? "off" : this.playerState === "PLAYING" ? "playing" : this.playerState === "PAUSED" ? "paused" : "on";
    const media =
      awake && this.source === "Bluetooth" && this.playerState !== "IDLE"
        ? { media_title: "Midnight Drive", media_artist: "The Neon Lights", media_album_name: "City Hours", app_name: "Spotify" }
        : {};
    put(
      MEDIA_PLAYER,
      mpState,
      mpState === "unavailable" || mpState === "off"
        ? mpBase
        : { ...mpBase, volume_level: this.volume / 32, is_volume_muted: this.muted, source: this.source, ...media },
    );

    // selects
    const sel = (id: string, n: string, options: string[], index: number, icon: string) =>
      ent(id, up, options[index] ?? "unknown", {}, { friendly_name: name(n), options, icon });
    sel(ID.bass, "Bass level", BASS_OPTIONS, this.bass, "mdi:speaker");
    sel(ID.center, "Center level", CENTER_OPTIONS, this.center, "mdi:account-voice");
    sel(ID.atmos, "Atmos height", ATMOS_OPTIONS, this.atmos, "mdi:surround-sound");
    sel(ID.rear, "Rear speakers", REAR_OPTIONS, this.rear, "mdi:speaker-wireless");

    const eqApplies = awake && !this.smart;
    const anyGain = this.gains.some((g) => g !== 0);
    const resetReason = "Reset the Front EQ, then apply it again";
    const eqStatus = this.eqResetNeeded ? "reset_needed" : !anyGain ? "off" : eqApplies ? "active" : "waiting";
    const preset = Object.entries(EQ_PRESETS).find(([, curve]) => curve.every((g, i) => g === this.gains[i]))?.[0];
    const eqReason = this.eqResetNeeded
      ? resetReason
      : eqApplies
        ? undefined
        : this.smart
          ? "Front EQ requires Standard Mode and active audio"
          : "Turn on the bar and start audio to adjust EQ";
    const presetStatus = this.eqResetNeeded ? "reset_required" : anyGain ? (eqApplies ? "active" : "waiting") : "ready";
    ent(ID.eqPreset, up, preset ?? "unknown", { status: presetStatus, ...(eqReason ? { error: eqReason } : {}), kept: true }, {
      friendly_name: name("Front EQ preset"),
      options: Object.keys(EQ_PRESETS),
      icon: "mdi:tune-vertical",
    });
    ent(ID.clockWhen, up, this.clockWhen, {}, { friendly_name: name("Clock shows"), options: ["standby", "always"], icon: "mdi:clock-digital" });

    // numbers
    const bandLabels = ["125 Hz", "500 Hz", "2 kHz", "4 kHz", "8 kHz"];
    ID.bands.forEach((id, i) =>
      ent(id, up, this.gains[i].toFixed(1), {}, {
        friendly_name: name(`Front EQ ${bandLabels[i]}`),
        min: -6,
        max: 0,
        step: 0.5,
        mode: "slider",
        unit_of_measurement: "dB",
        icon: "mdi:equalizer",
      }),
    );
    const syncAvailable = awake && (this.source === "TV" || this.source === "HDMI");
    ent(ID.avSync, syncAvailable, String(this.avSync), {}, {
      friendly_name: name("Audio sync"),
      min: 0,
      max: 250,
      step: 10,
      mode: "box",
      unit_of_measurement: "ms",
      icon: "mdi:timer-sync-outline",
    });
    ent(ID.bassOffset, up, this.bassOffset.toFixed(1), { status: this.bassOffset ? "active" : "off" }, {
      friendly_name: name("Bass offset"),
      min: -3,
      max: 3,
      step: 0.5,
      mode: "slider",
      unit_of_measurement: "dB",
      icon: "mdi:speaker",
    });

    // switches
    ent(ID.night, up, this.night ? "on" : "off", {}, { friendly_name: name("Night mode"), icon: "mdi:weather-night" });
    ent(ID.smart, awake, this.smart ? "on" : "off", {}, { friendly_name: name("Smart mode"), icon: "mdi:auto-fix" });
    ent(ID.clock, up, this.clockOn ? "on" : "off", {}, { friendly_name: name("Clock"), icon: "mdi:clock-digital" });

    // buttons
    const measuring = this.calibration.toLowerCase().includes("starting") || this.calibration === "Measuring";
    ent(ID.btPair, up, "unknown", {}, { friendly_name: name("Bluetooth pairing"), icon: "mdi:bluetooth-settings" });
    ent(ID.calibrate, awake && this.docked === false && !measuring && !this.subPairing, "unknown", {}, { friendly_name: name("Calibrate surround"), icon: "mdi:surround-sound" });
    ent(ID.subPair, awake && !measuring && !this.subPairing, "unknown", {}, { friendly_name: name("Pair subwoofer"), icon: "mdi:speaker-wireless" });
    ent(ID.clearMessages, up, "unknown", {}, { friendly_name: name("Clear all messages"), icon: "mdi:message-off-outline" });
    ent(ID.restart, up, "unknown", {}, { friendly_name: name("Restart"), device_class: "restart" });

    // sensors
    const sensor = (id: string, available: boolean, state: string | number | null, base: Record<string, unknown>, attrs: Record<string, unknown> = {}) =>
      ent(id, available, state === null ? "unknown" : String(state), attrs, base);
    sensor("sensor.jbl_bar_9_1_sound_mode", up, awake ? (this.smart ? "smart" : "standard") : "unknown", {
      friendly_name: name("Sound mode"),
      device_class: "enum",
      options: ["standard", "smart", "unknown"],
      icon: "mdi:auto-fix",
    });
    sensor("sensor.jbl_bar_9_1_bluetooth_device", up, this.btConnected ? "Pixel 9" : null, { friendly_name: name("Bluetooth device"), icon: "mdi:cellphone" });
    sensor("sensor.jbl_bar_9_1_bluetooth_audio", up, this.btConnected ? (this.source === "Bluetooth" ? "Streaming" : "Connected") : null, {
      friendly_name: name("Bluetooth audio"),
      icon: "mdi:bluetooth-audio",
    });
    sensor("sensor.jbl_bar_9_1_cpu", up, this.cpu, { friendly_name: name("CPU"), unit_of_measurement: "%", state_class: "measurement", icon: "mdi:cpu-64-bit" });
    sensor("sensor.jbl_bar_9_1_memory_used", up, this.memory, { friendly_name: name("Memory used"), unit_of_measurement: "%", state_class: "measurement", icon: "mdi:memory" });
    sensor("sensor.jbl_bar_9_1_temperature", up, this.temperature, { friendly_name: name("Temperature"), unit_of_measurement: "°C", device_class: "temperature", state_class: "measurement" });
    sensor("sensor.jbl_bar_9_1_wi_fi_signal", up, this.wifi, { friendly_name: name("Wi-Fi signal"), unit_of_measurement: "dBm", device_class: "signal_strength", state_class: "measurement" });
    sensor("sensor.jbl_bar_9_1_uptime", up, 186420 + Math.floor((this.now() - this.started) / 1000), { friendly_name: name("Uptime"), unit_of_measurement: "s", device_class: "duration" });
    sensor("sensor.jbl_bar_9_1_rear_left_battery", up, this.batteryLeft, { friendly_name: name("Rear left battery"), unit_of_measurement: "%", device_class: "battery", state_class: "measurement" });
    sensor("sensor.jbl_bar_9_1_rear_right_battery", up, this.batteryRight, { friendly_name: name("Rear right battery"), unit_of_measurement: "%", device_class: "battery", state_class: "measurement" });
    const format = !awake ? null : this.source === "Bluetooth" ? "PCM 2.0" : this.source === "HDMI" ? "DOLBY ATMOS" : "DOLBY SURROUND DD+";
    sensor("sensor.jbl_bar_9_1_audio_format", up, format, { friendly_name: name("Audio format"), icon: "mdi:surround-sound" });
    sensor("sensor.jbl_bar_9_1_calibration", up, this.calibration, { friendly_name: name("Calibration"), icon: "mdi:tune-vertical" });
    sensor("sensor.jbl_bar_9_1_subwoofer", up, this.subPairing ? "Pairing" : this.subStatus, { friendly_name: name("Subwoofer"), icon: "mdi:speaker-wireless" });
    sensor("sensor.jbl_bar_9_1_mode_after_standby", up, "smart", {
      friendly_name: name("Mode after standby"),
      device_class: "enum",
      options: ["standard", "smart"],
    });
    sensor(
      "sensor.jbl_bar_9_1_front_eq_status",
      up,
      eqStatus,
      { friendly_name: name("Front EQ status"), device_class: "enum", options: ["active", "waiting", "off", "reset_needed"] },
      { gains_db: [...this.gains], ...(eqReason && (anyGain || this.eqResetNeeded) ? { reason: eqReason } : {}) },
    );

    // timers
    const timers = this.sortedTimers();
    const timerItems = timers.map((t) => ({
      id: t.id,
      name: t.name,
      ringing: t.ringing,
      ends_at: t.endsAt === null ? null : iso(t.endsAt),
      countdown: t.countdown,
      sound: t.sound,
      duration_s: t.durationS,
    }));
    sensor("sensor.jbl_bar_9_1_timers", up, timers.length, { friendly_name: name("Timers"), icon: "mdi:timer-outline" }, { timers: timerItems });
    const nextTimer = timers.find((t) => !t.ringing);
    sensor(
      "sensor.jbl_bar_9_1_next_timer",
      up,
      nextTimer?.endsAt ? iso(nextTimer.endsAt) : null,
      { friendly_name: name("Next timer"), device_class: "timestamp" },
      nextTimer ? { name: nextTimer.name, id: nextTimer.id } : {},
    );
    const ringing = timers.filter((t) => t.ringing);
    ent("binary_sensor.jbl_bar_9_1_timer_ringing", up, ringing.length ? "on" : "off", { names: ringing.map((t) => t.name) }, {
      friendly_name: name("Timer ringing"),
      icon: "mdi:alarm-bell",
    });

    // messages
    const firstShowing = this.messages.find((m) => !m.held);
    const messageItems = this.messages.map((m) => ({
      id: m.id,
      name: m.id === "default" ? "" : m.id,
      text: m.text,
      mode: m.mode,
      passes_left: m.mode === "passes" ? m.passesLeft : null,
      ends_at: m.mode === "duration" && !m.held && m.endsAt !== null ? iso(m.endsAt) : null,
      duration_s: m.held && m.mode === "duration" ? m.durationS : null,
      showing: m === firstShowing,
      when_on: m.whenOn,
      held: m.held,
    }));
    sensor("sensor.jbl_bar_9_1_messages", up, this.messages.length, { friendly_name: name("Messages"), icon: "mdi:message-text-outline" }, { messages: messageItems });

    // binary sensors
    ent("binary_sensor.jbl_bar_9_1_rear_speakers_docked", up, this.docked ? "on" : "off", {}, { friendly_name: name("Rear speakers docked"), icon: "mdi:speaker-wireless" });
    ent("binary_sensor.jbl_bar_9_1_bluetooth_connected", up, this.btConnected ? "on" : "off", {}, { friendly_name: name("Bluetooth connected"), device_class: "connectivity" });
    const remoteBusy = this.local.source === "remote" || measuring;
    const running = this.local.action !== null || remoteBusy;
    // command_running stays available while the coordinator works (only last_update_success).
    put(ID.commandRunning, running ? "on" : "off", {
      action: this.local.action ?? (measuring ? "calibrate" : null),
      source: this.local.source ?? (remoteBusy ? "remote" : null),
      friendly_name: name("Command running"),
      device_class: "running",
    });

    // events and notify
    ent("event.jbl_bar_9_1_timer_events", up, new Date(this.started - 60000).toISOString(), {
      event_types: ["started", "ringing", "finished", "cancelled"],
      event_type: "ringing",
      id: "t1",
      name: "TEA",
    }, { friendly_name: name("Timer events") });
    ent("event.jbl_bar_9_1_message_events", up, new Date(this.started - 120000).toISOString(), {
      event_types: ["shown", "ended"],
      event_type: "shown",
      id: "fridge",
      text: "FRIDGE OPEN",
      named: true,
    }, { friendly_name: name("Message events") });
    ent("notify.jbl_bar_9_1_display", up, "unknown", {}, { friendly_name: name("Display"), supported_features: 1 });

    // Unregistered line and recent buttons (fixed ids, live labels, no device).
    for (let n = 1; n <= 8; n++) {
      const t = timers[n - 1];
      const id = `button.jbl_timer_line_${n}`;
      if (t && up) {
        const label = t.ringing ? `🔔 ${t.name || "Timer"} – ringing` : `${t.name || "Timer"} – ends at ${hhmm(t.endsAt!)}`;
        put(id, "unknown", {
          line: n,
          id: t.id,
          name: t.name,
          ringing: t.ringing,
          ends_at: t.endsAt === null ? null : iso(t.endsAt),
          duration_s: t.durationS,
          friendly_name: label,
          icon: t.ringing ? "mdi:bell-ring" : "mdi:timer-outline",
        });
      } else put(id, "unavailable", { friendly_name: `Timer line ${n}`, icon: "mdi:timer-outline" });
      const m = this.messages[n - 1];
      const mid = `button.jbl_message_line_${n}`;
      if (m && up) {
        const suffix = m.held ? " – when the bar is on" : m.mode === "forever" ? " – until cleared" : m.endsAt ? ` – until ${hhmm(m.endsAt)}` : "";
        put(mid, "unknown", {
          line: n,
          id: m.id,
          friendly_name: `${m.text}${m.id !== "default" ? ` (${m.id})` : ""}${suffix}`,
          icon: m.held ? "mdi:power-sleep" : m === firstShowing ? "mdi:message-text" : "mdi:message-text-clock-outline",
        });
      } else put(mid, "unavailable", { friendly_name: `Message line ${n}`, icon: "mdi:message-text" });
    }
    const recentTimers = this.visibleRecentTimers();
    const recentMessages = this.visibleRecentMessages();
    for (let n = 1; n <= 4; n++) {
      const r = recentTimers[n - 1];
      put(
        `button.jbl_recent_timer_${n}`,
        r && up ? "unknown" : "unavailable",
        r && up
          ? { friendly_name: `${r.text || "Timer"} · ${r.minutes % 60 === 0 ? `${r.minutes / 60} h` : `${r.minutes} min`}`, icon: "mdi:timer-refresh-outline" }
          : { friendly_name: `Recent timer ${n}`, icon: "mdi:timer-refresh-outline" },
      );
      const rm = recentMessages[n - 1];
      const length = rm?.forever ? "until cleared" : rm?.durationS ? `${Math.round(rm.durationS / 60)} min` : `${rm?.repeat ?? 1} times`;
      put(
        `button.jbl_recent_message_${n}`,
        rm && up ? "unknown" : "unavailable",
        rm && up
          ? {
              friendly_name: `${rm.text}${rm.id ? ` (${rm.id})` : ""} · ${length}${rm.whenOn ? " · when the bar is on" : ""}`,
              icon: "mdi:message-reply-text-outline",
            }
          : { friendly_name: `Recent message ${n}`, icon: "mdi:message-reply-text-outline" },
      );
    }

    // Keep the same states object when nothing changed (HA does not send an update then).
    const keys = Object.keys(next);
    const same = keys.length === Object.keys(old).length && keys.every((k) => old[k] === next[k]);
    if (same) return;
    this.states = next;
    if (notify) this.changed();
    else this.snapshot = undefined;
  }
}

function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Shortcut for tests: a HA object with the default bar. */
export function createMockHass(options: MockOptions = {}): { bar: MockBar; hass: HomeAssistant } {
  const bar = new MockBar(options);
  return { bar, hass: bar.hass() };
}

export type { HassEntity };
