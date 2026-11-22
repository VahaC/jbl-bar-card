// Data model of the System tab, shared by its layouts (list, map, health). It holds every
// decision (when an action may run, why not, what the status says), so the layouts only
// differ in how they look.
import { numericState } from "../format";
import { LOW_BATTERY, isBlankState as isBlank } from "../state";
import type { TabContext } from "../types";
import { SYSTEM_KEYS, calibrationPhase, uptimeSeconds, wifiQuality } from "./system";
import type { CalibrationKind } from "./system";

/** How long the "pick the soundbar on your phone" hint stays after pairing started. */
const BT_HINT_MS = 120000;

/** Colour of a status badge. */
export type Tone = "ok" | "info" | "warn" | "err" | "neutral";

/** One thing the user can do, with everything a renderer needs. */
export interface SysAction {
  /** Pending key (also a stable id for the DOM). */
  key: string;
  label: string;
  icon: string;
  /** True when pressing it would do something now. */
  enabled: boolean;
  /** The command is on its way or the bar is working on it. */
  pending: boolean;
  /** Why it cannot run now (shown instead of a disabled button with no explanation). */
  reason?: string;
  /** Destructive: renderers must show it in the danger colour. Restart asks for confirmation itself. */
  danger?: boolean;
  run(): void;
}

export interface SysMetric {
  key: "cpu" | "memory" | "temperature" | "wifi" | "uptime" | "mode_after_standby";
  entity: string;
  icon: string;
  label: string;
  /** Formatted value, or the translated "unknown" dash. */
  value: string;
  /** Raw number when there is one (percent for cpu/memory, °C, dBm, seconds). */
  number?: number;
  /** 0..1 for gauges: cpu and memory percent, temperature against 90 °C, Wi-Fi from -90 to -30 dBm. */
  ratio?: number;
  /** Level for colouring a gauge. */
  tone?: Tone;
  sub?: string;
  title?: string;
}

export interface SysBattery {
  side: "left" | "right";
  entity: string;
  level?: number;
  low: boolean;
}

export interface SysDevice {
  /** Translated status ("Connected", "Step 1 done", "No device connected"...). */
  status: string;
  tone: Tone;
  /** A spinner belongs next to the status. */
  busy: boolean;
  /** Entity behind the status, for more-info. */
  entity?: string;
}

export interface SystemModel {
  batteries: SysBattery[];
  /** Batteries under LOW_BATTERY. */
  lowBatteries: SysBattery[];
  docked: boolean;
  /** Translated warning text for low batteries ("Put both rear speakers back…" or "…charging"). */
  batteryAdvice?: string;
  metrics: SysMetric[];
  /** Names of the diagnostics HA disabled (Wi-Fi signal, Uptime), and how to enable them. */
  hiddenMetrics: string[];
  hiddenHow: string;
  bluetooth?: SysDevice & {
    device?: string;
    audio?: string;
    connected?: boolean;
    pair?: SysAction;
    /** Offered when pairing needs Bluetooth as the source. */
    switchSource?: SysAction;
    /** Shown for two minutes after pairing started from this card. */
    pairingHint?: string;
  };
  calibration?: SysDevice & {
    kind: CalibrationKind;
    start?: SysAction;
    /** What to do for the next step, or what is happening now. */
    guide?: string;
  };
  subwoofer?: SysDevice & {
    pair?: SysAction;
    pairingHint?: string;
  };
  restart?: SysAction & { hint: string };
  /** Everything that needs attention, most urgent first (for a summary line). */
  issues: { tone: Tone; text: string }[];
}

interface ModelLocal {
  step1Done: boolean;
  btPairingSince?: number;
}

const SUB_STATES: Record<string, { key: string; tone: Tone }> = {
  Connected: { key: "sub.connected", tone: "ok" },
  "Not connected": { key: "sub.not_connected", tone: "err" },
  Reconnecting: { key: "sub.reconnecting", tone: "warn" },
  Pairing: { key: "sub.pairing", tone: "info" },
};

function calTone(kind: CalibrationKind): Tone {
  switch (kind) {
    case "running":
      return "info";
    case "done1":
    case "done2":
      return "ok";
    case "failed":
      return "err";
    case "cancelled":
      return "warn";
    default:
      return "neutral";
  }
}

export function wifiIcon(dbm: number): string {
  switch (wifiQuality(dbm)) {
    case "excellent":
      return "mdi:wifi-strength-4";
    case "good":
      return "mdi:wifi-strength-3";
    case "fair":
      return "mdi:wifi-strength-2";
    default:
      return "mdi:wifi-strength-1";
  }
}

export function formatUptime(ctx: TabContext, totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return ctx.t("system.uptime.days", { days, hours });
  if (hours > 0) return ctx.t("system.uptime.hours", { hours, minutes });
  return ctx.t("system.uptime.minutes", { minutes });
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function loadTone(percent: number): Tone {
  if (percent >= 90) return "err";
  if (percent >= 75) return "warn";
  return "ok";
}

/** Build the System tab model. Uses the same local state key as the current renderer. */
export function systemModel(ctx: TabContext): SystemModel {
  const { entities, t } = ctx;
  const local = ctx.local<ModelLocal>("system", () => ({ step1Done: false }));
  const unknown = t("common.unknown");
  const issues: SystemModel["issues"] = [];

  /* Batteries */
  const docked = ctx.stateOf(entities.rear_docked)?.state === "on";
  const batteries: SysBattery[] = [];
  for (const side of ["left", "right"] as const) {
    const id = side === "left" ? entities.rear_battery_left : entities.rear_battery_right;
    if (!id) continue;
    const level = numericState(ctx.stateOf(id)?.state);
    batteries.push({ side, entity: id, level, low: level !== undefined && level < LOW_BATTERY });
  }
  const lowBatteries = batteries.filter((b) => b.low);
  for (const b of lowBatteries) {
    const value = t("system.percent", { value: ctx.formatNumber(Math.round(b.level!)) });
    issues.push({ tone: docked ? "info" : "warn", text: t(`system.battery.${b.side}`, { level: value }) });
  }

  /* Metrics */
  const metrics: SysMetric[] = [];
  const num = (id: string | undefined, digits: number): number | undefined => {
    const v = numericState(ctx.stateOf(id)?.state);
    return v === undefined ? undefined : Number(v.toFixed(digits));
  };
  if (entities.cpu) {
    const v = num(entities.cpu, 0);
    metrics.push({
      key: "cpu",
      entity: entities.cpu,
      icon: "mdi:cpu-64-bit",
      label: t("system.cpu"),
      value: v === undefined ? unknown : t("system.percent", { value: ctx.formatNumber(v) }),
      number: v,
      ratio: v === undefined ? undefined : clamp01(v / 100),
      tone: v === undefined ? undefined : loadTone(v),
    });
  }
  if (entities.memory) {
    const v = num(entities.memory, 1);
    metrics.push({
      key: "memory",
      entity: entities.memory,
      icon: "mdi:memory",
      label: t("system.memory"),
      value: v === undefined ? unknown : t("system.percent", { value: ctx.formatNumber(v, { maximumFractionDigits: 1 }) }),
      number: v,
      ratio: v === undefined ? undefined : clamp01(v / 100),
      tone: v === undefined ? undefined : loadTone(v),
    });
  }
  if (entities.temperature) {
    const v = num(entities.temperature, 1);
    const unit = String(ctx.stateOf(entities.temperature)?.attributes.unit_of_measurement ?? "°C");
    const celsius = v === undefined ? undefined : unit.includes("F") ? ((v - 32) * 5) / 9 : v;
    metrics.push({
      key: "temperature",
      entity: entities.temperature,
      icon: "mdi:thermometer",
      label: t("system.temperature"),
      value: v === undefined ? unknown : `${ctx.formatNumber(v, { maximumFractionDigits: 1 })} ${unit}`,
      number: v,
      ratio: celsius === undefined ? undefined : clamp01(celsius / 90),
      tone: celsius === undefined ? undefined : celsius >= 80 ? "err" : celsius >= 70 ? "warn" : "ok",
    });
  }
  if (entities.wifi_signal) {
    const v = num(entities.wifi_signal, 0);
    const q = v === undefined ? undefined : wifiQuality(v);
    metrics.push({
      key: "wifi",
      entity: entities.wifi_signal,
      icon: v === undefined ? "mdi:wifi-strength-outline" : wifiIcon(v),
      label: t("system.wifi"),
      value: v === undefined ? unknown : `${ctx.formatNumber(v)} dBm`,
      number: v,
      ratio: v === undefined ? undefined : clamp01((v + 90) / 60),
      tone: q === undefined ? undefined : q === "weak" ? "err" : q === "fair" ? "warn" : "ok",
      sub: q === undefined ? undefined : t(`system.wifi.${q}`),
    });
  }
  if (entities.uptime) {
    const seconds = uptimeSeconds(ctx.stateOf(entities.uptime));
    metrics.push({
      key: "uptime",
      entity: entities.uptime,
      icon: "mdi:timer-outline",
      label: t("system.uptime"),
      value: seconds === undefined ? unknown : formatUptime(ctx, seconds),
      number: seconds,
    });
  }
  if (entities.mode_after_standby) {
    const state = ctx.stateOf(entities.mode_after_standby)?.state;
    metrics.push({
      key: "mode_after_standby",
      entity: entities.mode_after_standby,
      icon: "mdi:auto-fix",
      label: t("system.mode_after_standby"),
      value: state === "smart" || state === "standard" ? t(`header.mode_${state}`) : isBlank(state) ? unknown : state!,
      title: t("system.mode_after_standby_hint"),
    });
  }
  const hiddenMetrics = [
    entities.wifi_signal ? undefined : t("system.wifi_signal"),
    entities.uptime ? undefined : t("system.uptime"),
  ].filter((name): name is string => Boolean(name));
  const hasDiagnostics = Boolean(entities.cpu || entities.memory || entities.temperature);
  for (const m of metrics) {
    if (m.tone === "err" && m.key !== "wifi") issues.push({ tone: "err", text: `${m.label}: ${m.value}` });
  }

  const model: SystemModel = {
    batteries,
    lowBatteries,
    docked,
    batteryAdvice: lowBatteries.length ? t(docked ? "system.battery.charging" : "system.battery.fix") : undefined,
    metrics,
    hiddenMetrics: hasDiagnostics ? hiddenMetrics : [],
    hiddenHow: t("system.disabled.how"),
    issues,
  };

  /* Bluetooth */
  if (entities.bluetooth_device || entities.bluetooth_connected || entities.bluetooth_pairing) {
    const device = ctx.stateOf(entities.bluetooth_device)?.state;
    const audio = ctx.stateOf(entities.bluetooth_audio)?.state;
    const connectedState = ctx.stateOf(entities.bluetooth_connected)?.state;
    const onBluetooth = ctx.stateOf(entities.media_player)?.attributes.source === "Bluetooth";
    const pairId = entities.bluetooth_pairing;
    const pending = ctx.isPending(SYSTEM_KEYS.btPair);
    let reason: string | undefined;
    if (pairId && !ctx.barUnavailable) {
      if (!ctx.barOn) reason = t("system.turn_on_first");
      else if (!onBluetooth) reason = t("system.bt.needs_source");
      else if (!ctx.isAvailable(pairId)) reason = t("system.unavailable");
    }
    const mediaPlayer = entities.media_player;
    const sourcePending = ctx.isPending(SYSTEM_KEYS.btSource);
    model.bluetooth = {
      status:
        connectedState === "on"
          ? t("system.bt.connected")
          : connectedState === "off"
            ? t("system.bt.not_connected")
            : unknown,
      tone: connectedState === "on" ? "ok" : "neutral",
      busy: pending,
      entity: entities.bluetooth_device ?? entities.bluetooth_connected,
      device: isBlank(device) ? undefined : device,
      audio: isBlank(audio) ? undefined : audio,
      connected: connectedState === "on" ? true : connectedState === "off" ? false : undefined,
      pair: pairId
        ? {
            key: SYSTEM_KEYS.btPair,
            label: t("system.bt.pair"),
            icon: "mdi:bluetooth-settings",
            enabled: !ctx.barUnavailable && reason === undefined && !pending,
            pending,
            reason,
            run: () => {
              void ctx
                .call(SYSTEM_KEYS.btPair, () => ctx.services.press(pairId))
                .then((ok) => {
                  if (!ok) return;
                  local.btPairingSince = Date.now();
                  ctx.requestUpdate();
                });
            },
          }
        : undefined,
      switchSource:
        pairId && ctx.barOn && !onBluetooth
          ? {
              key: SYSTEM_KEYS.btSource,
              label: t("system.bt.switch"),
              icon: "mdi:bluetooth",
              enabled: !sourcePending,
              pending: sourcePending,
              run: () => {
                void ctx.call(SYSTEM_KEYS.btSource, () => ctx.services.selectSource("Bluetooth"), {
                  value: "Bluetooth",
                  until: (hass) => hass.states[mediaPlayer]?.attributes.source === "Bluetooth",
                });
              },
            }
          : undefined,
      pairingHint:
        local.btPairingSince !== undefined && Date.now() - local.btPairingSince < BT_HINT_MS && onBluetooth
          ? t("system.bt.pairing_hint")
          : undefined,
    };
  }

  /* Surround calibration */
  if (entities.calibrate || entities.calibration) {
    const rawState = ctx.stateOf(entities.calibration)?.state;
    const phase = calibrationPhase(rawState);
    if (phase.kind === "done1") local.step1Done = true;
    else if (phase.kind === "done2") local.step1Done = false;
    const running = phase.kind === "running";
    const calId = entities.calibrate;
    const pending = ctx.isPending(SYSTEM_KEYS.calibrate);
    const dockedState = ctx.stateOf(entities.rear_docked)?.state;
    const subPairing = ctx.stateOf(entities.subwoofer)?.state === "Pairing";
    let reason: string | undefined;
    if (calId && !ctx.barUnavailable && !running && !pending) {
      if (!ctx.barOn) reason = t("system.turn_on_first");
      else if (entities.rear_docked && dockedState !== "off") reason = t("system.cal.needs_undock");
      else if (subPairing) reason = t("system.cal.wait_sub");
      else if (!ctx.isAvailable(calId)) reason = t("system.unavailable");
    }
    const canStart = Boolean(calId) && !ctx.barUnavailable && !running && !pending && reason === undefined;
    model.calibration = {
      kind: phase.kind,
      status:
        phase.key !== undefined ? t(`system.${phase.key}`, phase.vars) : phase.kind === "other" ? rawState! : unknown,
      tone: calTone(phase.kind),
      busy: running,
      entity: entities.calibration,
      start: calId
        ? {
            key: SYSTEM_KEYS.calibrate,
            label: running
              ? t("system.cal.running")
              : local.step1Done
                ? t("system.cal.start_step2")
                : phase.kind === "failed"
                  ? t("system.cal.retry")
                  : t("system.cal.start"),
            icon: "mdi:play-circle-outline",
            enabled: canStart,
            pending: pending || running,
            reason,
            run: () => void ctx.call(SYSTEM_KEYS.calibrate, () => ctx.services.press(calId)),
          }
        : undefined,
      guide: running
        ? t("system.cal.hint_running")
        : canStart
          ? t(local.step1Done ? "system.cal.hint_step2" : "system.cal.hint_step1")
          : undefined,
    };
    if (phase.kind === "failed") issues.push({ tone: "err", text: `${t("system.cal.title")}: ${model.calibration.status}` });
  }

  /* Subwoofer */
  if (entities.subwoofer || entities.sub_pair) {
    const state = ctx.stateOf(entities.subwoofer)?.state;
    const known = state !== undefined ? SUB_STATES[state] : undefined;
    const pairing = state === "Pairing";
    const pairId = entities.sub_pair;
    const pending = ctx.isPending(SYSTEM_KEYS.subPair);
    const measuring = calibrationPhase(ctx.stateOf(entities.calibration)?.state).kind === "running";
    let reason: string | undefined;
    if (pairId && !ctx.barUnavailable && !pairing && !pending) {
      if (!ctx.barOn) reason = t("system.turn_on_first");
      else if (measuring) reason = t("system.sub.wait_cal");
      else if (!ctx.isAvailable(pairId)) reason = t("system.unavailable");
    }
    model.subwoofer = {
      status: known ? t(`system.${known.key}`) : isBlank(state) ? t("system.sub.no_status") : state!,
      tone: known?.tone ?? "neutral",
      busy: pairing,
      entity: entities.subwoofer,
      pair: pairId
        ? {
            key: SYSTEM_KEYS.subPair,
            label: t("system.sub.pair"),
            icon: "mdi:speaker-wireless",
            enabled: !ctx.barUnavailable && !pairing && !pending && reason === undefined,
            pending: pending || pairing,
            reason,
            run: () => void ctx.call(SYSTEM_KEYS.subPair, () => ctx.services.press(pairId)),
          }
        : undefined,
      pairingHint: pairing ? t("system.sub.pairing_hint") : undefined,
    };
    if (state === "Not connected") issues.push({ tone: "err", text: `${t("system.sub.title")}: ${model.subwoofer.status}` });
  }

  /* Restart */
  const restartId = entities.restart;
  if (restartId) {
    const pending = ctx.isPending(SYSTEM_KEYS.restart);
    model.restart = {
      key: SYSTEM_KEYS.restart,
      label: t("system.restart.button"),
      icon: "mdi:restart",
      enabled: ctx.isAvailable(restartId) && !pending,
      pending,
      danger: true,
      hint: t("system.restart.hint"),
      run: () => {
        void (async () => {
          if (ctx.isPending(SYSTEM_KEYS.restart)) return;
          const ok = await ctx.confirm({
            title: t("system.restart.confirm_title"),
            message: t("system.restart.confirm_message"),
            confirmLabel: t("system.restart.confirm"),
            destructive: true,
          });
          if (!ok) return;
          await ctx.call(SYSTEM_KEYS.restart, () => ctx.services.press(restartId));
        })();
      },
    };
  }

  const rank: Record<Tone, number> = { err: 0, warn: 1, info: 2, ok: 3, neutral: 4 };
  issues.sort((a, b) => rank[a.tone] - rank[b.tone]);
  return model;
}
