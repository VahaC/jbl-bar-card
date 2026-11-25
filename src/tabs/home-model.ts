// Data model of the Home tab. It holds every decision the tab makes (what is shown,
// what is enabled or pending, which service a button calls and how it confirms), so a
// layout in src/tabs/home-layouts/ only decides how things look. See docs/layouts-home.md.
import { numericState } from "../format";
import { BAR_SOURCES, FEATURE, VOLUME_MAX } from "../services";
import { IMAGES } from "../assets";
import { LOW_BATTERY } from "../state";
import type { BarSource } from "../services";
import type { HassEntity, HomeAssistant, TabContext } from "../types";

/** Pending keys used by this tab (other tabs must use their own "<tab>." prefix). */
export const HOME_KEYS = {
  /** Shared with the card header's power button: both show and block the same pending command. */
  power: "header.power",
  source: "home.source",
  volume: "home.volume",
  mute: "home.mute",
  smart: "home.smart_mode",
  standard: "home.standard_mode",
  night: "home.night",
  pureVoice: "home.pure_voice",
  feedbackTone: "home.feedback_tone",
  bassBoost: "home.bass_boost",
  moment: "home.moment",
  deepSleep: "home.deep_sleep",
  playback: "home.playback",
} as const;

const OFF_STATES = new Set(["off", "unavailable", "unknown", "standby"]);

/** The bar is on: its media_player exists and is not off/unavailable/unknown/standby. */
export function isBarOn(state: HassEntity | undefined): boolean {
  return state !== undefined && !OFF_STATES.has(state.state);
}

/** How long a power change may take before the pending state is dropped. */
export const POWER_TIMEOUT_MS = 30000;

/** ctx.local("home") state: shared by every layout of this tab. */
export interface HomeLocal {
  /** Volume while the slider is being dragged (not sent yet). */
  dragVolume?: number;
}

/** The bar's volume on its own scale (0..32 on the Bar 9.1, 0..100 on JBL One bars), or undefined. */
export function volumeStep(hass: HomeAssistant, mediaPlayer: string, max: number = VOLUME_MAX): number | undefined {
  const level = hass.states[mediaPlayer]?.attributes.volume_level;
  return typeof level === "number" ? Math.round(level * max) : undefined;
}

/** Material Design battery icon for a level (charging variants while docked). */
export function batteryIcon(level: number | undefined, charging: boolean): string {
  if (level === undefined) return "mdi:battery-unknown";
  const tens = Math.min(100, Math.max(0, Math.floor(level / 10) * 10));
  if (charging) return tens < 10 ? "mdi:battery-charging-outline" : `mdi:battery-charging-${tens}`;
  if (tens >= 100) return "mdi:battery";
  if (tens < 10) return "mdi:battery-outline";
  return `mdi:battery-${tens}`;
}

/* ------------------------------------------------------------------ */
/* Model types                                                         */
/* ------------------------------------------------------------------ */

/** One thing the user can press, with everything a renderer needs. */
export interface HomeAction {
  /** Stable id inside the model ("volume_up", "night"...), usable as a DOM hook. */
  id: string;
  /** Pending key. Several actions may share one (volume up/down, the playback buttons). */
  key: string;
  /** Translated text: the visible label, or the aria-label/title of an icon button. */
  label: string;
  icon: string;
  /** Render the control disabled when false. */
  enabled: boolean;
  /** This action's command is on its way (show the pending style). */
  pending: boolean;
  /** Why it cannot run now, when the model knows (for a hint next to a disabled control). */
  reason?: string;
  /** Do it. Safe to call when disabled or pending: the model re-checks and ignores repeats where needed. */
  run(): void;
}

/** An on/off control (power, mute, Smart mode, Night). */
export interface HomeToggle extends HomeAction {
  kind: "switch";
  /** The state to show: the pending target while a change is on its way, else the entity's state. */
  on: boolean;
  /**
   * Fixed accessible name that does not change with the state ("Mute", "Power", "Night"). Use it
   * with aria-pressed or role="switch", which already say the state. `label` may name the action
   * instead ("Unmute", "Turn off"): use that only on a control without aria-pressed, or as a tooltip.
   */
  name: string;
}

/** A one-shot button (Standard mode on remotes without the Smart mode switch). */
export interface HomeButton extends HomeAction {
  kind: "button";
}

export interface HomeRear {
  side: "left" | "right";
  /** Battery sensor; undefined when this rear has none (the button is then disabled). */
  entity?: string;
  /** Battery percent, when known. */
  level?: number;
  /** Below LOW_BATTERY. */
  low: boolean;
  /** "Rear left" */
  name: string;
  /** aria-label: "Rear left 14%". */
  label: string;
  /** Battery icon (charging variants while docked). */
  batteryIcon: string;
  /** "14%" or the unknown dash; undefined when there is no battery sensor. */
  batteryText?: string;
  /** "Low battery" when low, else "" (title of the battery text). */
  batteryTitle: string;
  /** Speaker picture (data URL). */
  image: string;
  /** Open the battery's more-info (no-op without an entity). */
  open(): void;
}

export interface HomeSub {
  entity?: string;
  /** "Subwoofer" */
  name: string;
  /** "1".."5" when the bass select shows a level. */
  bassLevel?: string;
  /** "Bass 3/5" */
  bassText?: string;
  /** aria-label: "Subwoofer, Bass 3/5". */
  label: string;
  enabled: boolean;
  image: string;
  open(): void;
}

export interface HomeRoom {
  /** Group label "Speakers". */
  label: string;
  docked: boolean;
  /** The dock sensor reports on/off. */
  dockKnown: boolean;
  /** "Rears docked" / "Rears detached" when the dock state is known. */
  dockText?: string;
  /** "Soundbar" (shown under the bar when the dock state is unknown). */
  barName: string;
  /** The bar has rear speakers (battery or dock entities exist). */
  hasRears: boolean;
  /** Draw the rears as separate pictures (they exist and are detached). */
  showRearPictures: boolean;
  /** Bar picture: with the rears on it while docked. */
  barImage: string;
  /** Left then right; empty when the bar has no rears. */
  rears: HomeRear[];
  sub: HomeSub;
}

export interface HomeSourceOption {
  value: BarSource;
  /** The source name as the bar shows it ("TV", "HDMI", "Bluetooth"). */
  label: string;
  active: boolean;
  /** This source is the pending target. */
  pending: boolean;
  enabled: boolean;
  /** Select it (ignored when it is already the source and nothing is pending). */
  select(): void;
}

export interface HomeSource {
  /** "Source" */
  title: string;
  options: HomeSourceOption[];
  /** The bar's current source, also when it is none of the options. */
  current?: string;
  /** "Now playing from <app>" when the current source is not one of the options. */
  otherText?: string;
  enabled: boolean;
  reason?: string;
}

export interface HomeSlider {
  min: number;
  max: number;
  step: number;
  /** Value to draw (drag value, pending target or the bar's volume; 0 when unknown). */
  value: number;
  enabled: boolean;
  label: string;
  /** While dragging (input event): show the value, send nothing. */
  preview(value: number): void;
  /** On release (change event): send the value once and keep it pending until the bar reports it. */
  commit(value: number): void;
}

export interface HomeVolume {
  /** "Volume" */
  title: string;
  max: number;
  /** The bar's reported volume (0..max). */
  current?: number;
  /** What to show: drag value, else pending target, else current. */
  shown?: number;
  /** `shown` as text, or the unknown dash. */
  shownText: string;
  /** A volume change is on its way. */
  pending: boolean;
  /** The bar is in standby or unreachable: there is no volume to show. */
  off: boolean;
  /** Text shown instead of the number while off ("Off"). */
  offText: string;
  muted: boolean;
  /** "Muted" badge text when muted. */
  mutedText?: string;
  down: HomeAction;
  up: HomeAction;
  mute: HomeToggle;
  slider: HomeSlider;
  reason?: string;
}

export type PlaybackAction = "previous" | "play" | "pause" | "stop" | "next";

export interface HomePlaybackAction extends HomeAction {
  action: PlaybackAction;
  /** Play or pause: the big round button. */
  primary: boolean;
}

export interface HomePlayback {
  /** media_title, or the artist when there is no title; "" when neither. */
  title: string;
  /** "Artist · via Spotify" (artist only when it is not already the title). */
  subtitle: string;
  hasInfo: boolean;
  /** The raw media_title, artist and app_name (undefined when empty). */
  trackTitle?: string;
  artist?: string;
  app?: string;
  /** Transport buttons the source supports, in display order. */
  actions: HomePlaybackAction[];
}

export interface HomeModel {
  /** media_player is "off" (standby). */
  standby: boolean;
  /** The standby hint text when standby. */
  standbyHint?: string;
  /**
   * Turn the bar on or off: the same control as the card header's power button (one shared
   * pending key). Undefined when the media_player is missing.
   */
  power?: HomeToggle;
  room: HomeRoom;
  /** Undefined when the media_player is missing. */
  source?: HomeSource;
  /** Undefined when the media_player is missing. */
  volume?: HomeVolume;
  /** Mode chips; undefined when the bar has neither a Smart/Standard control nor Night. */
  modes?: {
    smart?: HomeToggle | HomeButton;
    night?: HomeToggle;
    /** More sound keys of JBL One bars (PureVoice, Tones, Bass boost, Moment), in that order. */
    extra?: (HomeToggle | HomeButton)[];
  };
  /** Undefined when off, or when there are neither buttons nor track info. */
  playback?: HomePlayback;
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

export function homeModel(ctx: TabContext): HomeModel {
  const mp = ctx.stateOf(ctx.entities.media_player);
  const standby = mp?.state === "off";
  const standbyHint = standby ? ctx.t("home.standby_hint") : undefined;
  const modes = modesModel(ctx);
  return {
    standby,
    standbyHint,
    power: mp ? powerToggle(ctx) : undefined,
    room: roomModel(ctx),
    source: sourceModel(ctx, standbyHint),
    volume: volumeModel(ctx, standbyHint),
    modes,
    playback: playbackModel(ctx),
  };
}

/** Why a bar command cannot run while the bar is unreachable, else undefined. */
function unreachableReason(ctx: TabContext): string | undefined {
  return ctx.barUnavailable ? ctx.t("home.reason_unreachable") : undefined;
}

/**
 * The power toggle. The card header renders it too, so both share the pending key, the pending
 * target and the "ignore taps while pending" rule.
 */
export function powerToggle(ctx: TabContext): HomeToggle {
  const mediaPlayer = ctx.entities.media_player;
  const isOn = isBarOn(ctx.stateOf(mediaPlayer));
  const on = ctx.pendingValue<boolean>(HOME_KEYS.power) ?? isOn;
  const label = ctx.t(on ? "header.power_off" : "header.power_on");
  return {
    kind: "switch",
    id: "power",
    key: HOME_KEYS.power,
    label,
    name: ctx.t("home.power"),
    icon: "mdi:power",
    on,
    enabled: !ctx.barUnavailable,
    pending: ctx.isPending(HOME_KEYS.power),
    reason: unreachableReason(ctx),
    run: () => {
      // A second tap while the first is on its way would toggle the power back.
      if (ctx.isPending(HOME_KEYS.power)) return;
      void ctx.call(HOME_KEYS.power, () => (isOn ? ctx.services.turnOff() : ctx.services.turnOn()), {
        value: !isOn,
        until: (hass) => isBarOn(hass.states[mediaPlayer]) === !isOn,
        timeoutMs: POWER_TIMEOUT_MS,
      });
    },
  };
}

function roomModel(ctx: TabContext): HomeRoom {
  const { entities, t } = ctx;
  const dockState = ctx.stateOf(entities.rear_docked)?.state;
  const docked = dockState === "on";
  const dockKnown = dockState === "on" || dockState === "off";
  const bass = ctx.stateOf(entities.bass)?.state;
  const bassLevel = bass && /^[1-5]$/.test(bass) ? bass : undefined;
  const hasRears = Boolean(entities.rear_battery_left || entities.rear_battery_right || entities.rear_docked);

  const rear = (side: "left" | "right"): HomeRear => {
    const entity = side === "left" ? entities.rear_battery_left : entities.rear_battery_right;
    const level = numericState(ctx.stateOf(entity)?.state);
    const low = level !== undefined && level < LOW_BATTERY;
    const name = t(`home.room.rear_${side}`);
    return {
      side,
      entity,
      level,
      low,
      name,
      label: `${name}${level !== undefined ? ` ${Math.round(level)}%` : ""}`,
      batteryIcon: batteryIcon(level, docked),
      batteryText: entity ? (level !== undefined ? `${Math.round(level)}%` : t("common.unknown")) : undefined,
      batteryTitle: low ? t("home.room.battery_low") : "",
      image: side === "left" ? IMAGES.rearLeft : IMAGES.rearRight,
      open: () => ctx.moreInfo(entity),
    };
  };

  const subName = t("home.room.subwoofer");
  const bassText = bassLevel ? t("home.room.bass", { level: bassLevel }) : undefined;
  return {
    label: t("home.room.label"),
    docked,
    dockKnown,
    dockText: dockKnown ? t(docked ? "home.room.rears_docked" : "home.room.rears_detached") : undefined,
    barName: t("home.room.bar"),
    hasRears,
    showRearPictures: hasRears && !docked,
    barImage: docked ? IMAGES.barDocked : IMAGES.barCenter,
    rears: hasRears ? [rear("left"), rear("right")] : [],
    sub: {
      // JBL One bars have no bass level; their sub opens the Bass boost key instead.
      entity: entities.bass ?? entities.bass_boost,
      name: subName,
      bassLevel,
      bassText,
      label: bassText ? `${subName}, ${bassText}` : subName,
      enabled: Boolean(entities.bass ?? entities.bass_boost),
      image: entities.platform === "jbl_bar" ? IMAGES.subwooferCompact : IMAGES.subwoofer,
      open: () => ctx.moreInfo((entities.bass ?? entities.bass_boost) as string),
    },
  };
}

function sourceModel(ctx: TabContext, standbyHint: string | undefined): HomeSource | undefined {
  const mp = ctx.stateOf(ctx.entities.media_player);
  if (!mp) return undefined;
  const list = Array.isArray(mp.attributes.source_list)
    ? (mp.attributes.source_list as string[]).filter((s): s is BarSource => (BAR_SOURCES as string[]).includes(s))
    : [...BAR_SOURCES];
  const current = typeof mp.attributes.source === "string" ? mp.attributes.source : undefined;
  const pendingTarget = ctx.pendingValue<string>(HOME_KEYS.source);
  const enabled = ctx.barOn;
  const other = current && !(list as string[]).includes(current) ? current : undefined;
  const mediaPlayer = ctx.entities.media_player;

  const choose = (source: BarSource): void => {
    if (source === current && pendingTarget === undefined) return;
    void ctx.call(HOME_KEYS.source, () => ctx.services.selectSource(source), {
      value: source,
      until: (hass) => hass.states[mediaPlayer]?.attributes.source === source,
    });
  };

  return {
    title: ctx.t("home.source"),
    options: list.map((source) => ({
      value: source,
      label: source,
      active: source === current,
      pending: pendingTarget === source,
      enabled,
      select: () => choose(source),
    })),
    current,
    otherText: other ? ctx.t("home.source_other", { source: other }) : undefined,
    enabled,
    reason: enabled ? undefined : standbyHint,
  };
}

function volumeModel(ctx: TabContext, standbyHint: string | undefined): HomeVolume | undefined {
  const mp = ctx.stateOf(ctx.entities.media_player);
  if (!mp) return undefined;
  const mediaPlayer = ctx.entities.media_player;
  const local = ctx.local<HomeLocal>("home", () => ({}));
  const max = ctx.entities.volumeMax ?? VOLUME_MAX;
  /** One volume_up / volume_down press on that scale (3 % on JBL One bars). */
  const stepSize = ctx.entities.volumeStep ?? 1;
  const current = volumeStep(ctx.hass, mediaPlayer, max);
  const pendingTarget = ctx.pendingValue<number>(HOME_KEYS.volume);
  // A drag the bar cut short (standby, unreachable, volume unknown) never gets its release:
  // drop its preview so the number does not stay frozen at the dragged value.
  if (!ctx.barOn || current === undefined) local.dragVolume = undefined;
  const shown = local.dragVolume ?? pendingTarget ?? current;
  const muted = mp.attributes.is_volume_muted === true;
  const mutePending = ctx.isPending(HOME_KEYS.mute);
  const on = ctx.barOn;
  const reason = on ? undefined : standbyHint;
  const volPending = ctx.isPending(HOME_KEYS.volume);

  const step = (delta: 1 | -1): void => {
    // Read the pending target at press time: quick repeated presses add up.
    const base = ctx.pendingValue<number>(HOME_KEYS.volume) ?? current;
    if (base === undefined) return;
    const target = Math.min(max, Math.max(0, base + delta * stepSize));
    if (target === base) return;
    void ctx.call(HOME_KEYS.volume, () => (delta > 0 ? ctx.services.volumeUp() : ctx.services.volumeDown()), {
      value: target,
      until: (hass) => {
        // The bar moves by its own step; done once the volume reached (or passed) the target.
        const now = volumeStep(hass, mediaPlayer, max);
        return now !== undefined && (delta > 0 ? now >= target : now <= target);
      },
    });
  };

  // Show the pending target while a mute change is on its way; run() still toggles the raw state.
  const muteShown = ctx.pendingValue<boolean>(HOME_KEYS.mute) ?? muted;
  const muteLabel = ctx.t(muteShown ? "home.unmute" : "home.mute");
  return {
    title: ctx.t("home.volume"),
    max,
    current,
    shown,
    shownText: shown !== undefined ? String(shown) : ctx.t("common.unknown"),
    pending: volPending,
    off: !on,
    offText: ctx.t("home.volume_off"),
    muted,
    mutedText: muted ? ctx.t("home.muted") : undefined,
    down: {
      id: "volume_down",
      key: HOME_KEYS.volume,
      label: ctx.t("home.volume_down"),
      icon: "mdi:minus",
      enabled: on && shown !== undefined && shown > 0,
      pending: volPending,
      reason,
      run: () => step(-1),
    },
    up: {
      id: "volume_up",
      key: HOME_KEYS.volume,
      label: ctx.t("home.volume_up"),
      icon: "mdi:plus",
      enabled: on && shown !== undefined && shown < max,
      pending: volPending,
      reason,
      run: () => step(1),
    },
    mute: {
      kind: "switch",
      id: "mute",
      key: HOME_KEYS.mute,
      label: muteLabel,
      name: ctx.t("home.mute_name"),
      icon: muteShown ? "mdi:volume-off" : "mdi:volume-high",
      on: muteShown,
      enabled: on,
      pending: mutePending,
      reason,
      run: () => {
        // The integration toggles mute: a second tap before the first is confirmed would undo it.
        if (ctx.isPending(HOME_KEYS.mute)) return;
        void ctx.call(HOME_KEYS.mute, () => ctx.services.mute(!muted), {
          value: !muted,
          until: (hass) => (hass.states[mediaPlayer]?.attributes.is_volume_muted === true) === !muted,
        });
      },
    },
    slider: {
      min: 0,
      max,
      step: stepSize,
      value: shown ?? 0,
      enabled: on && current !== undefined,
      label: ctx.t("home.volume"),
      preview: (value) => {
        local.dragVolume = value;
        ctx.requestUpdate();
      },
      commit: (target) => {
        local.dragVolume = undefined;
        if (target === current && pendingTarget === undefined) {
          ctx.requestUpdate();
          return;
        }
        void ctx.call(HOME_KEYS.volume, () => ctx.services.setVolume(target), {
          value: target,
          until: (hass) => {
            const now = volumeStep(hass, mediaPlayer, max);
            return now !== undefined && Math.abs(now - target) < stepSize;
          },
          timeoutMs: 60000,
        });
      },
    },
    reason,
  };
}

/**
 * Why a mode control is disabled: the bar is unreachable, or in standby (the bar reports some
 * mode switches as unavailable then; the layouts already show the standby hint, so they can
 * drop the repeat), else its entity reports no state.
 */
function modeUnavailableReason(ctx: TabContext, name: string): string {
  const standby = ctx.stateOf(ctx.entities.media_player)?.state === "off";
  return unreachableReason(ctx) ?? (standby ? ctx.t("home.standby_hint") : ctx.t("home.mode_unavailable", { name }));
}

function switchModel(ctx: TabContext, id: string, key: string, entityId: string, label: string, icon: string): HomeToggle {
  const st = ctx.stateOf(entityId);
  const known = st?.state === "on" || st?.state === "off";
  const on = st?.state === "on";
  const pendingValue = ctx.pendingValue<boolean>(key);
  return {
    kind: "switch",
    id,
    key,
    label,
    name: label,
    icon,
    on: pendingValue ?? on,
    enabled: known,
    pending: ctx.isPending(key),
    reason: known ? undefined : modeUnavailableReason(ctx, label),
    run: () => {
      // Night and Smart are toggles on the bar: a second tap while the first is pending would
      // send the same toggle again and flip the setting back.
      if (ctx.isPending(key)) return;
      void ctx.call(key, () => ctx.services.setSwitch(entityId, !on), {
        value: !on,
        until: (hass) => hass.states[entityId]?.state === (!on ? "on" : "off"),
      });
    },
  };
}

function modesModel(ctx: TabContext): HomeModel["modes"] {
  const { entities, t } = ctx;
  let smart: HomeToggle | HomeButton | undefined;
  if (entities.smart_mode) {
    smart = switchModel(ctx, "smart_mode", HOME_KEYS.smart, entities.smart_mode, t("home.smart_mode"), "mdi:auto-fix");
  } else if (entities.standard_mode) {
    const entity = entities.standard_mode;
    const label = t("home.standard_mode");
    const enabled = ctx.isAvailable(entity);
    smart = {
      kind: "button",
      id: "standard_mode",
      key: HOME_KEYS.standard,
      label,
      icon: "mdi:auto-fix",
      enabled,
      pending: ctx.isPending(HOME_KEYS.standard),
      reason: enabled ? undefined : modeUnavailableReason(ctx, label),
      run: () => {
        if (!ctx.isPending(HOME_KEYS.standard)) void ctx.call(HOME_KEYS.standard, () => ctx.services.press(entity));
      },
    };
  }
  const night = entities.night
    ? switchModel(ctx, "night", HOME_KEYS.night, entities.night, t("home.night"), "mdi:weather-night")
    : undefined;
  const extra = extraModes(ctx);
  if (!smart && !night && !extra.length) return undefined;
  return { smart, night, extra: extra.length ? extra : undefined };
}

/** A remote key that only fires (Bass boost, Moment): no state to show, just pending while it runs. */
function pressModel(ctx: TabContext, id: string, key: string, entity: string, label: string, icon: string): HomeButton {
  const enabled = ctx.isAvailable(entity) && ctx.barOn;
  return {
    kind: "button",
    id,
    key,
    label,
    icon,
    enabled,
    pending: ctx.isPending(key),
    reason: enabled ? undefined : unreachableReason(ctx) ?? modeUnavailableReason(ctx, label),
    run: () => {
      if (!ctx.isPending(key)) void ctx.call(key, () => ctx.services.press(entity));
    },
  };
}

function extraModes(ctx: TabContext): (HomeToggle | HomeButton)[] {
  const { entities, t } = ctx;
  const out: (HomeToggle | HomeButton)[] = [];
  if (entities.pure_voice)
    out.push(switchModel(ctx, "pure_voice", HOME_KEYS.pureVoice, entities.pure_voice, t("home.pure_voice"), "mdi:account-voice"));
  if (entities.feedback_tone)
    out.push(switchModel(ctx, "feedback_tone", HOME_KEYS.feedbackTone, entities.feedback_tone, t("home.feedback_tone"), "mdi:volume-source"));
  if (entities.bass_boost)
    out.push(pressModel(ctx, "bass_boost", HOME_KEYS.bassBoost, entities.bass_boost, t("home.bass_boost"), "mdi:waveform"));
  if (entities.moment)
    out.push(pressModel(ctx, "moment", HOME_KEYS.moment, entities.moment, t("home.moment"), "mdi:play-box-multiple"));
  if (entities.deep_sleep)
    out.push(switchModel(ctx, "deep_sleep", HOME_KEYS.deepSleep, entities.deep_sleep, t("home.deep_sleep"), "mdi:power-sleep"));
  return out;
}

const PLAYBACK_ICONS: Record<PlaybackAction, string> = {
  previous: "mdi:skip-previous",
  play: "mdi:play",
  pause: "mdi:pause",
  stop: "mdi:stop",
  next: "mdi:skip-next",
};

function playbackModel(ctx: TabContext): HomePlayback | undefined {
  const mp = ctx.stateOf(ctx.entities.media_player);
  if (!mp || !ctx.barOn) return undefined;
  const features = Number(mp.attributes.supported_features ?? 0);
  const has = (bit: number): boolean => (features & bit) === bit;
  const playing = mp.state === "playing";
  const list: PlaybackAction[] = [];
  if (has(FEATURE.PREVIOUS_TRACK)) list.push("previous");
  if (playing && has(FEATURE.PAUSE)) list.push("pause");
  else if (has(FEATURE.PLAY)) list.push("play");
  else if (has(FEATURE.PAUSE)) list.push("pause");
  if (has(FEATURE.STOP)) list.push("stop");
  if (has(FEATURE.NEXT_TRACK)) list.push("next");

  const title = typeof mp.attributes.media_title === "string" ? mp.attributes.media_title : "";
  const artist = typeof mp.attributes.media_artist === "string" ? mp.attributes.media_artist : "";
  const app = typeof mp.attributes.app_name === "string" ? mp.attributes.app_name : "";
  if (!list.length && !title && !artist) return undefined;

  const s = ctx.services;
  const send = (action: PlaybackAction): Promise<unknown> => {
    switch (action) {
      case "previous":
        return s.mediaPrevious();
      case "play":
        return s.mediaPlay();
      case "pause":
        return s.mediaPause();
      case "stop":
        return s.mediaStop();
      case "next":
        return s.mediaNext();
    }
  };
  const pendingAction = ctx.pendingValue<PlaybackAction>(HOME_KEYS.playback);

  return {
    title: title || artist,
    subtitle: [title ? artist : "", app ? ctx.t("home.via", { app }) : ""].filter(Boolean).join(" · "),
    hasInfo: Boolean(title || artist),
    trackTitle: title || undefined,
    artist: artist || undefined,
    app: app || undefined,
    actions: list.map((action) => ({
      id: action,
      action,
      key: HOME_KEYS.playback,
      label: ctx.t(`home.${action}`),
      icon: PLAYBACK_ICONS[action],
      primary: action === "play" || action === "pause",
      enabled: true,
      pending: pendingAction === action,
      run: () => void ctx.call(HOME_KEYS.playback, () => send(action), { value: action }),
    })),
  };
}
