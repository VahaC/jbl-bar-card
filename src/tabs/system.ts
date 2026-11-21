import { css, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { numericState } from "../format";
import type { HassEntity, TabContext } from "../types";
import { LOW_BATTERY, isBlankState as isBlank } from "../state";

/** Pending keys used by this tab. */
export const SYSTEM_KEYS = {
  btPair: "system.bluetooth_pairing",
  btSource: "system.bluetooth_source",
  calibrate: "system.calibrate",
  subPair: "system.sub_pair",
  restart: "system.restart",
} as const;

/** How long the "pick the soundbar on your phone" hint stays after pairing started. */
const BT_HINT_MS = 120000;

interface SystemLocal {
  /** The bar reported "Step 1 done": the next press runs step 2. */
  step1Done: boolean;
  /** Date.now() when Bluetooth pairing was started from this card. */
  btPairingSince?: number;
}

/* ---------------- Pure helpers (exported for tests) ---------------- */

/** Seconds from a duration sensor, honouring the unit the user may have picked in HA. */
export function uptimeSeconds(st: HassEntity | undefined): number | undefined {
  const value = numericState(st?.state);
  if (value === undefined) return undefined;
  const unit = String(st?.attributes.unit_of_measurement ?? "s");
  const factor: Record<string, number> = { s: 1, ms: 0.001, min: 60, h: 3600, d: 86400 };
  return value * (factor[unit] ?? 1);
}

/** Wi-Fi quality bucket for a dBm reading. */
export function wifiQuality(dbm: number): "excellent" | "good" | "fair" | "weak" {
  if (dbm >= -55) return "excellent";
  if (dbm >= -67) return "good";
  if (dbm >= -75) return "fair";
  return "weak";
}

export type CalibrationKind = "idle" | "running" | "done1" | "done2" | "failed" | "cancelled" | "unknown" | "other";

/**
 * The calibration sensor's phase. The remote reports what the bar's display shows:
 * Idle, "Step N starting", "Starting in N", Measuring, "Step N done", "Failed, retry", Cancelled.
 */
export function calibrationPhase(state: string | undefined): { kind: CalibrationKind; key?: string; vars?: Record<string, string | number> } {
  if (isBlank(state)) return { kind: "unknown" };
  const s = state!;
  if (s === "Idle") return { kind: "idle", key: "cal.idle" };
  const starting = s.match(/^Step ([12]) starting$/i);
  if (starting) return { kind: "running", key: "cal.step_starting", vars: { step: starting[1] } };
  const countdown = s.match(/^Starting in (\d+)/i);
  if (countdown) return { kind: "running", key: "cal.starting_in", vars: { seconds: countdown[1] } };
  if (s === "Measuring" || /starting/i.test(s)) return { kind: "running", key: "cal.measuring" };
  if (s === "Step 1 done") return { kind: "done1", key: "cal.step1_done" };
  if (s === "Step 2 done") return { kind: "done2", key: "cal.done" };
  if (/^failed/i.test(s)) return { kind: "failed", key: "cal.failed" };
  if (s === "Cancelled") return { kind: "cancelled", key: "cal.cancelled" };
  return { kind: "other" };
}

/* ---------------- Render ---------------- */

export function renderSystemTab(ctx: TabContext): TemplateResult {
  const local = ctx.local<SystemLocal>("system", () => ({ step1Done: false }));
  const parts = [
    renderBatteryWarning(ctx),
    renderTiles(ctx),
    renderBluetooth(ctx, local),
    renderCalibration(ctx, local),
    renderSubwoofer(ctx),
    renderRestart(ctx),
  ].filter((part) => part !== nothing);
  return html`<div class="system">
    ${parts.length ? parts : html`<p class="hint">${ctx.t("system.empty")}</p>`}
  </div>`;
}

/* ---------------- Low rear battery ---------------- */

function renderBatteryWarning(ctx: TabContext): TemplateResult | typeof nothing {
  const { entities, t } = ctx;
  const low: TemplateResult[] = [];
  for (const side of ["left", "right"] as const) {
    const id = side === "left" ? entities.rear_battery_left : entities.rear_battery_right;
    const level = numericState(ctx.stateOf(id)?.state);
    if (level === undefined || level >= LOW_BATTERY) continue;
    const value = t("system.percent", { value: ctx.formatNumber(Math.round(level)) });
    low.push(html`<li>${t(`system.battery.${side}`, { level: value })}</li>`);
  }
  if (!low.length) return nothing;
  const docked = ctx.stateOf(entities.rear_docked)?.state === "on";
  return html`
    <div class="section">
      <div class="sys-alert ${docked ? "charging" : ""}" role=${docked ? "status" : "alert"}>
        <ha-icon .icon=${docked ? "mdi:battery-charging-30" : "mdi:battery-alert-variant-outline"}></ha-icon>
        <div class="grow">
          <div class="sys-alert-title">${t("system.battery.title")}</div>
          <ul class="sys-alert-list">
            ${low}
          </ul>
          <div class="hint">${t(docked ? "system.battery.charging" : "system.battery.fix")}</div>
        </div>
      </div>
    </div>
  `;
}

/* ---------------- Metric tiles ---------------- */

interface Tile {
  key: string;
  entity: string;
  icon: string;
  label: string;
  value: string;
  sub?: string;
  title?: string;
}

function renderTiles(ctx: TabContext): TemplateResult | typeof nothing {
  const { entities, t } = ctx;
  const tiles: Tile[] = [];
  const unknown = t("common.unknown");
  const number = (role: "cpu" | "memory" | "temperature" | "wifi_signal", digits: number): number | undefined => {
    const value = numericState(ctx.stateOf(role)?.state);
    return value === undefined ? undefined : Number(value.toFixed(digits));
  };

  if (entities.cpu) {
    const v = number("cpu", 0);
    tiles.push({
      key: "cpu",
      entity: entities.cpu,
      icon: "mdi:cpu-64-bit",
      label: t("system.cpu"),
      value: v === undefined ? unknown : t("system.percent", { value: ctx.formatNumber(v) }),
    });
  }
  if (entities.memory) {
    const v = number("memory", 1);
    tiles.push({
      key: "memory",
      entity: entities.memory,
      icon: "mdi:memory",
      label: t("system.memory"),
      value: v === undefined ? unknown : t("system.percent", { value: ctx.formatNumber(v, { maximumFractionDigits: 1 }) }),
    });
  }
  if (entities.temperature) {
    const v = number("temperature", 1);
    const unit = String(ctx.stateOf(entities.temperature)?.attributes.unit_of_measurement ?? "°C");
    tiles.push({
      key: "temperature",
      entity: entities.temperature,
      icon: "mdi:thermometer",
      label: t("system.temperature"),
      value: v === undefined ? unknown : `${ctx.formatNumber(v, { maximumFractionDigits: 1 })} ${unit}`,
    });
  }
  if (entities.wifi_signal) {
    const v = number("wifi_signal", 0);
    tiles.push({
      key: "wifi",
      entity: entities.wifi_signal,
      icon: v === undefined ? "mdi:wifi-strength-outline" : wifiIcon(v),
      label: t("system.wifi"),
      value: v === undefined ? unknown : `${ctx.formatNumber(v)} dBm`,
      sub: v === undefined ? undefined : t(`system.wifi.${wifiQuality(v)}`),
    });
  }
  if (entities.uptime) {
    const seconds = uptimeSeconds(ctx.stateOf(entities.uptime));
    tiles.push({
      key: "uptime",
      entity: entities.uptime,
      icon: "mdi:timer-outline",
      label: t("system.uptime"),
      value: seconds === undefined ? unknown : formatUptime(ctx, seconds),
    });
  }
  if (entities.mode_after_standby) {
    const state = ctx.stateOf(entities.mode_after_standby)?.state;
    tiles.push({
      key: "mode_after_standby",
      entity: entities.mode_after_standby,
      icon: "mdi:auto-fix",
      label: t("system.mode_after_standby"),
      value: state === "smart" || state === "standard" ? t(`header.mode_${state}`) : isBlank(state) ? unknown : state!,
      title: t("system.mode_after_standby_hint"),
    });
  }

  const hidden = [
    entities.wifi_signal ? undefined : t("system.wifi_signal"),
    entities.uptime ? undefined : t("system.uptime"),
  ].filter((name): name is string => Boolean(name));
  // Only explain the disabled diagnostics when the integration's other diagnostics are there.
  const explain = hidden.length > 0 && Boolean(entities.cpu || entities.memory || entities.temperature);
  if (!tiles.length && !explain) return nothing;

  return html`
    <div class="section">
      <div class="section-title">${t("system.status")}</div>
      ${tiles.length
        ? html`<div class="tiles">
            ${tiles.map(
              (tile) => html`<button
                class="tile sys-tile ${tile.key}"
                title=${tile.title ?? tile.label}
                @click=${() => ctx.moreInfo(tile.entity)}
              >
                <span class="tile-label"><ha-icon .icon=${tile.icon}></ha-icon><span>${tile.label}</span></span>
                <span class="tile-value">${tile.value}</span>
                ${tile.sub ? html`<span class="tile-sub">${tile.sub}</span>` : nothing}
              </button>`,
            )}
          </div>`
        : nothing}
      ${explain
        ? html`<details class="sys-details">
            <summary class="hint">${t("system.disabled.summary", { names: hidden.join(", ") })}</summary>
            <div class="hint">${t("system.disabled.how")}</div>
          </details>`
        : nothing}
    </div>
  `;
}

function wifiIcon(dbm: number): string {
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

function formatUptime(ctx: TabContext, totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return ctx.t("system.uptime.days", { days, hours });
  if (hours > 0) return ctx.t("system.uptime.hours", { hours, minutes });
  return ctx.t("system.uptime.minutes", { minutes });
}

/* ---------------- Bluetooth ---------------- */

function renderBluetooth(ctx: TabContext, local: SystemLocal): TemplateResult | typeof nothing {
  const { entities, t } = ctx;
  if (!entities.bluetooth_device && !entities.bluetooth_connected && !entities.bluetooth_pairing) return nothing;
  const device = ctx.stateOf(entities.bluetooth_device)?.state;
  const audio = ctx.stateOf(entities.bluetooth_audio)?.state;
  const connected = ctx.stateOf(entities.bluetooth_connected)?.state;
  const source = ctx.stateOf(entities.media_player)?.attributes.source;
  const onBluetooth = source === "Bluetooth";
  const pending = ctx.isPending(SYSTEM_KEYS.btPair);
  const sourcePending = ctx.isPending(SYSTEM_KEYS.btSource);
  const pairId = entities.bluetooth_pairing;

  let reason: string | undefined;
  if (pairId && !ctx.barUnavailable) {
    if (!ctx.barOn) reason = t("system.turn_on_first");
    else if (!onBluetooth) reason = t("system.bt.needs_source");
    else if (!ctx.isAvailable(pairId)) reason = t("system.unavailable");
  }
  const canPair = Boolean(pairId) && !ctx.barUnavailable && reason === undefined && !pending;
  const showPairingHint =
    local.btPairingSince !== undefined && Date.now() - local.btPairingSince < BT_HINT_MS && onBluetooth;

  const pair = (): void => {
    if (!pairId) return;
    void ctx
      .call(SYSTEM_KEYS.btPair, () => ctx.services.press(pairId))
      .then((ok) => {
        if (!ok) return;
        local.btPairingSince = Date.now();
        ctx.requestUpdate();
      });
  };
  const mediaPlayer = entities.media_player;
  const switchSource = (): void => {
    void ctx.call(SYSTEM_KEYS.btSource, () => ctx.services.selectSource("Bluetooth"), {
      value: "Bluetooth",
      until: (hass) => hass.states[mediaPlayer]?.attributes.source === "Bluetooth",
    });
  };

  return html`
    <div class="section bluetooth">
      <div class="section-title">${t("system.bt.title")}</div>
      <div class="list-item">
        <ha-icon .icon=${connected === "on" ? "mdi:bluetooth-connect" : "mdi:bluetooth"}></ha-icon>
        <div class="grow">
          <div class="sys-primary">${isBlank(device) ? t("system.bt.no_device") : device}</div>
          ${!isBlank(audio) ? html`<div class="sys-secondary">${audio}</div>` : nothing}
        </div>
        ${connected === "on"
          ? html`<span class="badge ok">${t("system.bt.connected")}</span>`
          : connected === "off"
            ? html`<span class="badge">${t("system.bt.not_connected")}</span>`
            : nothing}
      </div>
      ${pairId
        ? html`<div class="row sys-actions">
            <button class="btn ${pending ? "pending" : ""}" ?disabled=${!canPair} @click=${pair}>
              <ha-icon .icon=${"mdi:bluetooth-settings"}></ha-icon><span>${t("system.bt.pair")}</span>
            </button>
            ${ctx.barOn && !onBluetooth
              ? html`<button class="btn ghost ${sourcePending ? "pending" : ""}" ?disabled=${sourcePending} @click=${switchSource}>
                  ${t("system.bt.switch")}
                </button>`
              : nothing}
          </div>`
        : nothing}
      ${reason ? html`<div class="hint">${reason}</div>` : nothing}
      ${showPairingHint ? html`<div class="hint">${t("system.bt.pairing_hint")}</div>` : nothing}
    </div>
  `;
}

/* ---------------- Surround calibration ---------------- */

function badgeClass(kind: CalibrationKind): string {
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
      return "";
  }
}

function renderCalibration(ctx: TabContext, local: SystemLocal): TemplateResult | typeof nothing {
  const { entities, t } = ctx;
  if (!entities.calibrate && !entities.calibration) return nothing;
  const rawState = ctx.stateOf(entities.calibration)?.state;
  const phase = calibrationPhase(rawState);
  // "Step N done" shows on the display for a few seconds only: remember step 1 for the button label.
  if (phase.kind === "done1") local.step1Done = true;
  else if (phase.kind === "done2") local.step1Done = false;

  const status =
    phase.key !== undefined ? t(`system.${phase.key}`, phase.vars) : phase.kind === "other" ? rawState! : t("common.unknown");
  const running = phase.kind === "running";
  const calId = entities.calibrate;
  const pending = ctx.isPending(SYSTEM_KEYS.calibrate);
  const docked = ctx.stateOf(entities.rear_docked)?.state;
  const subPairing = ctx.stateOf(entities.subwoofer)?.state === "Pairing";

  let reason: string | undefined;
  if (calId && !ctx.barUnavailable && !running && !pending) {
    if (!ctx.barOn) reason = t("system.turn_on_first");
    else if (entities.rear_docked && docked !== "off") reason = t("system.cal.needs_undock");
    else if (subPairing) reason = t("system.cal.wait_sub");
    else if (!ctx.isAvailable(calId)) reason = t("system.unavailable");
  }
  const canStart = Boolean(calId) && !ctx.barUnavailable && !running && !pending && reason === undefined;
  const label = running
    ? t("system.cal.running")
    : local.step1Done
      ? t("system.cal.start_step2")
      : phase.kind === "failed"
        ? t("system.cal.retry")
        : t("system.cal.start");
  const guide = running
    ? t("system.cal.hint_running")
    : canStart
      ? t(local.step1Done ? "system.cal.hint_step2" : "system.cal.hint_step1")
      : undefined;

  const start = (): void => {
    if (!calId) return;
    void ctx.call(SYSTEM_KEYS.calibrate, () => ctx.services.press(calId));
  };

  return html`
    <div class="section calibration">
      <div class="section-title">${t("system.cal.title")}</div>
      <div class="list-item">
        <ha-icon .icon=${"mdi:surround-sound"}></ha-icon>
        <div class="grow sys-primary">${t("system.status")}</div>
        <span class="badge cal-status ${badgeClass(phase.kind)}" aria-live="polite">
          ${running ? html`<span class="spinner" aria-hidden="true"></span>` : nothing}${status}
        </span>
      </div>
      ${calId
        ? html`<div class="row sys-actions">
            <button class="btn ${pending ? "pending" : ""}" ?disabled=${!canStart} @click=${start}>
              <ha-icon .icon=${"mdi:play-circle-outline"}></ha-icon><span>${label}</span>
            </button>
          </div>`
        : nothing}
      ${reason ? html`<div class="hint">${reason}</div>` : nothing}
      ${guide ? html`<div class="hint">${guide}</div>` : nothing}
    </div>
  `;
}

/* ---------------- Subwoofer ---------------- */

const SUB_STATES: Record<string, { key: string; badge: string }> = {
  Connected: { key: "sub.connected", badge: "ok" },
  "Not connected": { key: "sub.not_connected", badge: "err" },
  Reconnecting: { key: "sub.reconnecting", badge: "warn" },
  Pairing: { key: "sub.pairing", badge: "info" },
};

function renderSubwoofer(ctx: TabContext): TemplateResult | typeof nothing {
  const { entities, t } = ctx;
  if (!entities.subwoofer && !entities.sub_pair) return nothing;
  const state = ctx.stateOf(entities.subwoofer)?.state;
  const known = state !== undefined ? SUB_STATES[state] : undefined;
  const pairing = state === "Pairing";
  const status = known ? t(`system.${known.key}`) : isBlank(state) ? t("system.sub.no_status") : state!;
  const pairId = entities.sub_pair;
  const pending = ctx.isPending(SYSTEM_KEYS.subPair);
  const measuring = calibrationPhase(ctx.stateOf(entities.calibration)?.state).kind === "running";

  let reason: string | undefined;
  if (pairId && !ctx.barUnavailable && !pairing && !pending) {
    if (!ctx.barOn) reason = t("system.turn_on_first");
    else if (measuring) reason = t("system.sub.wait_cal");
    else if (!ctx.isAvailable(pairId)) reason = t("system.unavailable");
  }
  const canPair = Boolean(pairId) && !ctx.barUnavailable && !pairing && !pending && reason === undefined;

  const pair = (): void => {
    if (!pairId) return;
    void ctx.call(SYSTEM_KEYS.subPair, () => ctx.services.press(pairId));
  };

  return html`
    <div class="section subwoofer">
      <div class="section-title">${t("system.sub.title")}</div>
      <div class="list-item">
        <ha-icon .icon=${"mdi:speaker"}></ha-icon>
        <div class="grow sys-primary">${t("system.status")}</div>
        <span class="badge sub-status ${known?.badge ?? ""}" aria-live="polite">
          ${pairing ? html`<span class="spinner" aria-hidden="true"></span>` : nothing}${status}
        </span>
      </div>
      ${pairId
        ? html`<div class="row sys-actions">
            <button class="btn ${pending ? "pending" : ""}" ?disabled=${!canPair} @click=${pair}>
              <ha-icon .icon=${"mdi:speaker-wireless"}></ha-icon><span>${t("system.sub.pair")}</span>
            </button>
          </div>`
        : nothing}
      ${reason ? html`<div class="hint">${reason}</div>` : nothing}
      ${pairing ? html`<div class="hint">${t("system.sub.pairing_hint")}</div>` : nothing}
    </div>
  `;
}

/* ---------------- Restart ---------------- */

function renderRestart(ctx: TabContext): TemplateResult | typeof nothing {
  const { entities, t } = ctx;
  const restartId = entities.restart;
  if (!restartId) return nothing;
  const pending = ctx.isPending(SYSTEM_KEYS.restart);
  const available = ctx.isAvailable(restartId);

  const restart = async (): Promise<void> => {
    if (ctx.isPending(SYSTEM_KEYS.restart)) return;
    const ok = await ctx.confirm({
      title: t("system.restart.confirm_title"),
      message: t("system.restart.confirm_message"),
      confirmLabel: t("system.restart.confirm"),
      destructive: true,
    });
    if (!ok) return;
    await ctx.call(SYSTEM_KEYS.restart, () => ctx.services.press(restartId));
  };

  return html`
    <div class="section restart">
      <div class="section-title">${t("system.restart.title")}</div>
      <div class="row sys-actions">
        <button
          class="btn danger ${pending ? "pending" : ""}"
          ?disabled=${!available}
          aria-disabled=${pending ? "true" : "false"}
          @click=${restart}
        >
          <ha-icon .icon=${"mdi:restart"}></ha-icon><span>${t("system.restart.button")}</span>
        </button>
      </div>
      <div class="hint">${t("system.restart.hint")}</div>
    </div>
  `;
}

/** Styles for this tab only (added to the card's static styles). */
export const systemStyles = css`
  .system .sys-alert {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--jbl-radius-sm);
    border: 1px solid var(--jbl-warning);
    background: rgba(255, 166, 0, 0.12);
  }
  .system .sys-alert > ha-icon {
    color: var(--jbl-warning);
    flex: none;
  }
  .system .sys-alert.charging {
    border-color: var(--jbl-border);
    background: var(--jbl-surface);
  }
  .system .sys-alert.charging > ha-icon {
    color: var(--jbl-success);
  }
  .system .sys-alert .grow {
    flex: 1 1 auto;
    min-width: 0;
  }
  .system .sys-alert-title {
    font-weight: 500;
  }
  .system .sys-alert-list {
    margin: 4px 0;
    padding-left: 18px;
    font-variant-numeric: tabular-nums;
  }
  .system button.sys-tile {
    border: 0;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: inherit;
  }
  .system button.sys-tile:hover {
    background: rgba(var(--jbl-accent-rgb), 0.1);
  }
  .system .tile-label > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .system .tile-sub {
    font-size: 0.75rem;
    color: var(--jbl-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .system .sys-details summary {
    cursor: pointer;
  }
  .system .sys-details > .hint {
    margin-top: 4px;
  }
  .system .list-item > ha-icon {
    color: var(--jbl-muted);
    flex: none;
  }
  .system .sys-primary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .system .sys-secondary {
    font-size: 0.8rem;
    color: var(--jbl-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .system .list-item .badge {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 65%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .system .badge .spinner {
    width: 10px;
    height: 10px;
  }
  .system .sys-actions .btn {
    max-width: 100%;
  }
  .system .sys-actions .btn > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;
