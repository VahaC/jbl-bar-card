// System tab layout variant B, "Compact list" (settings-app style).
// Three ring gauges (CPU, memory, temperature) above one grouped list: every device,
// diagnostic and the restart action is a row with a tinted icon, a title next to one compact
// trailing control, and a full-width secondary line under it (status, reason or guide).
// Status is always a tone dot plus text in that secondary line; a row whose action cannot run
// shows the reason there and leaves the trailing slot empty (no separate status badge: it reads
// calmer in a compact list than a badge would).
// Renders from SystemModel only; remove the losing variants once one is picked.
import { css, html, nothing, svg } from "lit";
import type { TemplateResult } from "lit";
import type { TabContext } from "../../types";
import type { SysAction, SysMetric, SystemModel, Tone } from "../system-model";

/** Metrics drawn as ring gauges; the rest become list rows. */
const GAUGE_KEYS: ReadonlyArray<SysMetric["key"]> = ["cpu", "memory", "temperature"];
const ROW_KEYS: ReadonlyArray<SysMetric["key"]> = ["wifi", "uptime", "mode_after_standby"];

/** Id of the restart hint (unique inside one card's shadow root). */
const RESTART_HINT_ID = "sys-b-restart-hint";

/**
 * Short pill text of the calibration action: the model picks start, step 2 or retry as its
 * label, so only here the label decides. The other rows pass their short text directly.
 * TODO if B wins: let SysAction carry a shortLabel and drop this.
 */
function calibrationShort(ctx: TabContext, action: SysAction): string {
  const { t } = ctx;
  if (action.label === t("system.cal.start_step2")) return t("system_list.step2");
  if (action.label === t("system.cal.retry")) return t("system_list.retry");
  return t("system_list.start");
}

export function renderSystemList(ctx: TabContext, model: SystemModel): TemplateResult {
  const gauges = model.metrics.filter((m) => GAUGE_KEYS.includes(m.key));
  const rows = [
    renderOffline(ctx),
    renderBattery(ctx, model),
    renderBluetooth(ctx, model),
    renderCalibration(ctx, model),
    renderSubwoofer(ctx, model),
    ...model.metrics.filter((m) => ROW_KEYS.includes(m.key)).map((m) => renderMetricRow(ctx, m)),
    renderHidden(ctx, model),
    renderRestart(ctx, model),
  ].filter((row): row is TemplateResult => row !== nothing);

  if (!gauges.length && !rows.length) {
    return html`<div class="sys-b"><p class="hint">${ctx.t("system.empty")}</p></div>`;
  }
  return html`<div class="sys-b">
    ${gauges.length
      ? html`<div class="sys-b-gauges" role="group" aria-label=${ctx.t("system.status")}>
          ${gauges.map((m) => renderGauge(ctx, m))}
        </div>`
      : nothing}
    ${rows.length ? html`<div class="sys-b-list">${rows}</div>` : nothing}
  </div>`;
}

/* ---------------- Gauges ---------------- */

function renderGauge(ctx: TabContext, m: SysMetric): TemplateResult {
  const ratio = m.ratio ?? 0;
  const arc = Math.round(ratio * 1000) / 10;
  return html`<button
    class="sys-b-gauge ${m.key} ${m.tone ?? "none"}"
    aria-label=${`${m.label}: ${m.value}`}
    title=${m.title ?? m.label}
    @click=${() => ctx.moreInfo(m.entity)}
  >
    <span class="sys-b-ring" aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false">
        <circle class="sys-b-track" cx="32" cy="32" r="27" pathLength="100"></circle>
        ${m.ratio !== undefined && arc > 0
          ? svg`<circle class="sys-b-arc" cx="32" cy="32" r="27" pathLength="100" stroke-dasharray="${arc} 100"></circle>`
          : nothing}
      </svg>
      <span class="sys-b-gauge-value ${m.value.length > 6 ? "long" : ""}">${m.value}</span>
    </span>
    <span class="sys-b-gauge-label" aria-hidden="true">${m.label}</span>
  </button>`;
}

/* ---------------- Rows ---------------- */

interface RowParts {
  icon: string;
  tone: Tone;
  title: string;
  /** Secondary line (status, levels, hint), under the title at full width. */
  sub?: TemplateResult | string;
  /** Wrapping text under the secondary line: why an action cannot run, or what to do next. */
  note?: string;
  trailing?: TemplateResult | typeof nothing;
  /** Announce changes of sub and note politely (off for rows that are alerts or controls). */
  live?: boolean;
  /** Id for the secondary line, so a row button can point aria-describedby at it. */
  subId?: string;
}

/**
 * Row grid: icon | title | trailing control on the first line, then sub and note under the
 * title spanning to the right edge, so a pill never squeezes the status.
 */
function rowBody(p: RowParts): TemplateResult {
  const live = p.live === false ? undefined : "polite";
  const below = p.sub !== undefined || Boolean(p.note);
  return html`<span class="sys-b-ico ${p.tone}" aria-hidden="true"><ha-icon .icon=${p.icon}></ha-icon></span>
    <span class="sys-b-title">${p.title}</span>
    <span class="sys-b-trail">${p.trailing ?? nothing}</span>
    ${below
      ? html`<span class="sys-b-below">
          ${p.sub !== undefined
            ? html`<span class="sys-b-sub" id=${p.subId ?? nothing} aria-live=${live ?? nothing}>${p.sub}</span>`
            : nothing}
          ${p.note ? html`<span class="sys-b-note" aria-live=${live ?? nothing}>${p.note}</span>` : nothing}
        </span>`
      : nothing}`;
}

function row(cls: string, p: RowParts): TemplateResult {
  return html`<div class="sys-b-row ${cls}">${rowBody(p)}</div>`;
}

/**
 * Text segments joined by a middle dot. A dot that would start a line is clipped away
 * (see .sys-b-segs), so a wrapped line never starts or ends with a separator.
 */
function segments(parts: ReadonlyArray<string | undefined>): TemplateResult {
  return html`<span class="sys-b-segs"
    ><span>${parts.filter((s): s is string => Boolean(s)).map((s) => html`<span class="sys-b-seg">${s}</span>`)}</span
  ></span>`;
}

/** Status with a tone dot. */
function status(parts: ReadonlyArray<string | undefined>, tone: Tone): TemplateResult {
  return html`<span class="sys-b-dot ${tone}" aria-hidden="true"></span>${segments(parts)}`;
}

const spinner = (label?: string): TemplateResult =>
  label ? html`<span class="spinner" role="img" aria-label=${label}></span>` : html`<span class="spinner" aria-hidden="true"></span>`;

/** The trailing control of an action: a pill when it can run, a spinner while pending, nothing otherwise. */
function actionControl(action: SysAction | undefined, short: string): TemplateResult | typeof nothing {
  if (!action) return nothing;
  if (action.pending) return spinner(action.label);
  if (!action.enabled) return nothing;
  return html`<button
    class="sys-b-pill"
    data-key=${action.key}
    aria-label=${action.label}
    title=${action.label}
    @click=${() => {
      if (action.enabled) action.run();
    }}
  >
    ${short}
  </button>`;
}

/**
 * Why an action cannot run, when it exists and cannot run. While the bar is unreachable the
 * single "offline" row says why for every row, so the per-row reason stays empty.
 */
function blockedReason(ctx: TabContext, action: SysAction | undefined): string | undefined {
  if (!action || action.enabled || action.pending) return undefined;
  if (ctx.barUnavailable) return undefined;
  return action.reason ?? ctx.t("system.unavailable");
}

function renderOffline(ctx: TabContext): TemplateResult | typeof nothing {
  if (!ctx.barUnavailable) return nothing;
  return html`<div class="sys-b-row sys-b-offline" role="status">
    ${rowBody({
      icon: "mdi:lan-disconnect",
      tone: "neutral",
      title: ctx.t("system_list.offline_title"),
      sub: ctx.t("system_list.offline_note"),
      live: false,
    })}
  </div>`;
}

function renderBattery(ctx: TabContext, model: SystemModel): TemplateResult | typeof nothing {
  if (!model.lowBatteries.length) return nothing;
  const levels = model.lowBatteries.map((b) =>
    ctx.t(`system.battery.${b.side}`, { level: ctx.t("system.percent", { value: ctx.formatNumber(Math.round(b.level!)) }) }),
  );
  // The row itself is the live region (alert, or status while charging): no nested live regions.
  return html`<div class="sys-b-row sys-b-battery ${model.docked ? "charging" : ""}" role=${model.docked ? "status" : "alert"}>
    ${rowBody({
      icon: model.docked ? "mdi:battery-charging-30" : "mdi:battery-alert-variant-outline",
      tone: model.docked ? "ok" : "warn",
      title: ctx.t(model.docked ? "system_list.charging_title" : "system.battery.title"),
      sub: segments(levels),
      note: model.batteryAdvice,
      live: false,
    })}
  </div>`;
}

function renderBluetooth(ctx: TabContext, model: SystemModel): TemplateResult | typeof nothing {
  const bt = model.bluetooth;
  if (!bt) return nothing;
  const parts = bt.device ? [bt.status, bt.device, bt.audio] : [bt.status, bt.connected === false ? ctx.t("system.bt.no_device") : undefined];
  // Pairing that waits for the Bluetooth source offers the switch right where the pair button would be.
  const pairBlocked = Boolean(bt.pair && !bt.pair.enabled && !bt.pair.pending);
  const blocked = blockedReason(ctx, bt.pair);
  const trailing = bt.pair
    ? pairBlocked && bt.switchSource
      ? actionControl(bt.switchSource, ctx.t("system_list.use_bt"))
      : actionControl(bt.pair, ctx.t("system_list.add"))
    : bt.busy
      ? spinner()
      : nothing;
  return row("sys-b-bt", {
    icon: bt.connected ? "mdi:bluetooth-connect" : "mdi:bluetooth",
    tone: bt.tone,
    title: ctx.t("system.bt.title"),
    sub: status(parts, bt.tone),
    note: blocked ?? bt.pairingHint,
    trailing,
  });
}

function renderCalibration(ctx: TabContext, model: SystemModel): TemplateResult | typeof nothing {
  const cal = model.calibration;
  if (!cal) return nothing;
  const note = blockedReason(ctx, cal.start) ?? cal.guide;
  // "Not running" (idle) and the unknown dash say nothing the guide or reason does not; any
  // other state, including one the card does not recognise, is always shown.
  const quiet = cal.kind === "idle" || cal.kind === "unknown";
  const showStatus = !quiet || !note;
  return row("sys-b-cal", {
    icon: "mdi:surround-sound",
    tone: cal.tone,
    title: ctx.t("system.cal.title"),
    sub: showStatus ? status([cal.status], cal.tone) : undefined,
    note,
    trailing: cal.start ? actionControl(cal.start, calibrationShort(ctx, cal.start)) : cal.busy ? spinner() : nothing,
  });
}

function renderSubwoofer(ctx: TabContext, model: SystemModel): TemplateResult | typeof nothing {
  const sub = model.subwoofer;
  if (!sub) return nothing;
  return row("sys-b-woofer", {
    icon: "mdi:speaker",
    tone: sub.tone,
    title: ctx.t("system.sub.title"),
    sub: status([sub.status], sub.tone),
    note: blockedReason(ctx, sub.pair) ?? sub.pairingHint,
    trailing: sub.pair ? actionControl(sub.pair, ctx.t("system_list.pair")) : sub.busy ? spinner() : nothing,
  });
}

function renderMetricRow(ctx: TabContext, m: SysMetric): TemplateResult {
  const cls = m.key === "mode_after_standby" ? "sys-b-standby" : `sys-b-${m.key}`;
  // A button is read in full when focused; no live region inside a control.
  return html`<button class="sys-b-row sys-b-link ${cls}" title=${m.title ?? m.label} @click=${() => ctx.moreInfo(m.entity)}>
    ${rowBody({
      icon: m.icon,
      tone: m.key === "wifi" ? (m.tone ?? "neutral") : "neutral",
      title: m.label,
      sub: m.sub,
      trailing: html`<span class="sys-b-value">${m.value}</span>`,
      live: false,
    })}
  </button>`;
}

function renderHidden(ctx: TabContext, model: SystemModel): TemplateResult | typeof nothing {
  if (!model.hiddenMetrics.length) return nothing;
  return html`<details class="sys-b-row sys-b-hidden">
    <summary>
      <span class="sys-b-ico neutral" aria-hidden="true"><ha-icon .icon=${"mdi:eye-off-outline"}></ha-icon></span>
      <span class="sys-b-title">${ctx.t("system.disabled.summary", { names: model.hiddenMetrics.join(", ") })}</span>
      <span class="sys-b-trail"><ha-icon class="sys-b-chev" .icon=${"mdi:chevron-down"}></ha-icon></span>
    </summary>
    <div class="sys-b-note">${model.hiddenHow}</div>
  </details>`;
}

function renderRestart(ctx: TabContext, model: SystemModel): TemplateResult | typeof nothing {
  const r = model.restart;
  if (!r) return nothing;
  const blocked = blockedReason(ctx, r);
  return html`<button
    class="sys-b-row sys-b-link sys-b-restart ${r.pending ? "pending" : ""}"
    aria-label=${r.label}
    aria-describedby=${RESTART_HINT_ID}
    aria-disabled=${r.enabled ? "false" : "true"}
    aria-busy=${r.pending ? "true" : "false"}
    @click=${() => {
      if (r.enabled) r.run();
    }}
  >
    ${rowBody({
      icon: r.icon,
      tone: "err",
      title: r.label,
      sub: blocked ?? r.hint,
      subId: RESTART_HINT_ID,
      live: false,
      trailing: r.pending ? spinner() : r.enabled ? html`<ha-icon class="sys-b-chev" .icon=${"mdi:chevron-right"}></ha-icon>` : nothing,
    })}
  </button>`;
}

/** Styles for variant B only; every selector starts with .sys-b. */
export const systemListStyles = css`
  .sys-b {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  /* ---- Ring gauges ---- */
  .sys-b .sys-b-gauges {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
    gap: 4px;
  }
  .sys-b .sys-b-gauge {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding: 6px 2px 4px;
    border: 0;
    border-radius: var(--jbl-radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .sys-b .sys-b-gauge:hover {
    background: var(--jbl-surface);
  }
  .sys-b .sys-b-gauge:focus-visible {
    outline: 2px solid var(--jbl-accent);
    outline-offset: 0;
  }
  .sys-b .sys-b-ring {
    position: relative;
    width: 64px;
    height: 64px;
    flex: none;
  }
  .sys-b .sys-b-ring svg {
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
    display: block;
  }
  .sys-b .sys-b-ring circle {
    fill: none;
    stroke-width: 6;
  }
  .sys-b .sys-b-track {
    stroke: var(--jbl-border);
  }
  .sys-b .sys-b-arc {
    stroke: var(--jbl-muted);
    stroke-linecap: round;
    transition: stroke-dasharray 300ms ease;
  }
  .sys-b .sys-b-gauge.ok .sys-b-arc {
    stroke: var(--jbl-success);
  }
  .sys-b .sys-b-gauge.warn .sys-b-arc {
    stroke: var(--jbl-warning);
  }
  .sys-b .sys-b-gauge.err .sys-b-arc {
    stroke: var(--jbl-error);
  }
  .sys-b .sys-b-gauge.info .sys-b-arc {
    stroke: var(--jbl-accent);
  }
  .sys-b .sys-b-gauge-value {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    letter-spacing: -0.01em;
  }
  .sys-b .sys-b-gauge-value.long {
    font-size: 0.7rem;
  }
  .sys-b .sys-b-gauge-label {
    max-width: 100%;
    font-size: 0.75rem;
    color: var(--jbl-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ---- Grouped list ---- */
  .sys-b .sys-b-list {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--jbl-border);
    border-radius: var(--jbl-radius-sm);
    overflow: hidden;
  }
  /*
   * Row: icon | title | trailing on a 30 px first line (icon, pill and title share one centre),
   * then sub and note under the title, spanning under the trailing control too.
   */
  .sys-b .sys-b-row,
  .sys-b .sys-b-hidden > summary {
    position: relative;
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) auto;
    grid-template-rows: minmax(30px, auto);
    column-gap: 12px;
    row-gap: 0;
    align-items: center;
    padding: 9px 12px;
    box-sizing: border-box;
    width: 100%;
    text-align: start;
    color: inherit;
    font: inherit;
  }
  /* Hairline dividers, inset past the icon. */
  .sys-b .sys-b-row + .sys-b-row::before {
    content: "";
    position: absolute;
    top: 0;
    left: 54px;
    right: 0;
    height: 1px;
    background: var(--jbl-border);
  }
  .sys-b button.sys-b-row {
    border: 0;
    border-radius: 0;
    background: none;
    cursor: pointer;
  }
  .sys-b button.sys-b-row:focus-visible,
  .sys-b .sys-b-hidden > summary:focus-visible {
    outline: 2px solid var(--jbl-accent);
    outline-offset: -2px;
  }
  .sys-b button.sys-b-row:hover:not([aria-disabled="true"]) {
    background: var(--jbl-surface);
  }

  .sys-b .sys-b-ico {
    grid-row: 1;
    grid-column: 1;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--jbl-surface);
    color: var(--jbl-muted);
  }
  .sys-b .sys-b-ico ha-icon {
    --mdc-icon-size: 18px;
  }
  .sys-b .sys-b-ico.ok {
    background: rgba(67, 160, 71, 0.15);
    color: var(--jbl-success);
  }
  .sys-b .sys-b-ico.info {
    background: rgba(var(--jbl-accent-rgb), 0.15);
    color: var(--jbl-accent-text);
  }
  .sys-b .sys-b-ico.warn {
    background: rgba(255, 166, 0, 0.18);
    color: var(--jbl-warning);
  }
  .sys-b .sys-b-ico.err {
    background: rgba(219, 68, 55, 0.14);
    color: var(--jbl-error);
  }

  .sys-b .sys-b-title {
    grid-row: 1;
    grid-column: 2;
    min-width: 0;
    font-size: 0.95rem;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .sys-b .sys-b-trail {
    grid-row: 1;
    grid-column: 3;
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    min-width: 0;
  }
  .sys-b .sys-b-trail:empty {
    display: none;
  }
  .sys-b .sys-b-below {
    grid-row: 2;
    grid-column: 2 / -1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .sys-b .sys-b-sub {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    min-width: 0;
    font-size: 0.8rem;
    line-height: 1.3;
    color: var(--jbl-muted);
    overflow-wrap: anywhere;
  }
  .sys-b .sys-b-note {
    font-size: 0.8rem;
    line-height: 1.35;
    color: var(--jbl-muted);
  }

  /* Middle-dot segments; the outer box clips the dot of whichever segment starts a line. */
  .sys-b .sys-b-segs {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
  }
  .sys-b .sys-b-segs > span {
    display: flex;
    flex-wrap: wrap;
    margin-inline-start: -14px;
  }
  .sys-b .sys-b-seg {
    position: relative;
    min-width: 0;
    padding-inline-start: 14px;
  }
  .sys-b .sys-b-seg::before {
    content: "·";
    position: absolute;
    inset-inline-start: 5px;
  }

  .sys-b .sys-b-dot {
    flex: none;
    margin-top: 0.4em;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--jbl-disabled);
  }
  .sys-b .sys-b-dot.ok {
    background: var(--jbl-success);
  }
  .sys-b .sys-b-dot.info {
    background: var(--jbl-accent);
  }
  .sys-b .sys-b-dot.warn {
    background: var(--jbl-warning);
  }
  .sys-b .sys-b-dot.err {
    background: var(--jbl-error);
  }

  .sys-b .sys-b-value {
    font-size: 0.9rem;
    color: var(--jbl-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .sys-b .sys-b-chev {
    color: var(--jbl-muted);
    --mdc-icon-size: 20px;
  }

  /* Compact action pill: tonal, so routine actions stay quieter than the red restart row. */
  .sys-b .sys-b-pill {
    flex: none;
    min-height: 30px;
    padding: 4px 14px;
    border-radius: 999px;
    border: 0;
    background: rgba(var(--jbl-accent-rgb), 0.15);
    color: var(--jbl-accent-text);
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .sys-b .sys-b-pill:hover {
    background: rgba(var(--jbl-accent-rgb), 0.22);
  }
  .sys-b .sys-b-pill:focus-visible {
    outline: 2px solid var(--jbl-accent);
    outline-offset: 2px;
  }

  /* Bar unreachable: one muted row says it for every action. */
  .sys-b .sys-b-offline .sys-b-title {
    color: var(--jbl-muted);
  }

  /* Low battery: the first row, tinted. */
  .sys-b .sys-b-battery {
    background: rgba(255, 166, 0, 0.12);
    box-shadow: inset 3px 0 0 var(--jbl-warning);
  }
  .sys-b .sys-b-battery .sys-b-title {
    font-weight: 600;
  }
  .sys-b .sys-b-battery .sys-b-sub {
    color: var(--jbl-text);
    font-variant-numeric: tabular-nums;
  }
  .sys-b .sys-b-battery .sys-b-note {
    color: var(--jbl-text);
  }
  .sys-b .sys-b-battery.charging {
    background: rgba(67, 160, 71, 0.1);
    box-shadow: inset 3px 0 0 var(--jbl-success);
  }
  .sys-b .sys-b-battery + .sys-b-row::before {
    left: 0;
  }

  /* Hidden diagnostics: a muted row that expands. */
  .sys-b .sys-b-hidden {
    display: block;
    padding: 0;
  }
  .sys-b .sys-b-hidden > summary {
    cursor: pointer;
    list-style: none;
  }
  .sys-b .sys-b-hidden > summary::-webkit-details-marker {
    display: none;
  }
  .sys-b .sys-b-hidden .sys-b-title {
    font-size: 0.85rem;
    color: var(--jbl-muted);
  }
  .sys-b .sys-b-hidden > .sys-b-note {
    padding: 0 12px 10px 54px;
  }
  .sys-b .sys-b-hidden[open] .sys-b-chev {
    transform: rotate(180deg);
  }

  /* Restart: quiet until looked at, then clearly destructive (the only red text in the list). */
  .sys-b .sys-b-restart .sys-b-title {
    color: var(--jbl-error);
    font-weight: 500;
  }
  .sys-b .sys-b-restart[aria-disabled="true"] {
    cursor: default;
  }
  .sys-b .sys-b-restart[aria-disabled="true"] .sys-b-title {
    opacity: 0.6;
  }

  /* Narrow cards: smaller gauges, tighter rows. */
  @container (max-width: 340px) {
    .sys-b .sys-b-ring {
      width: 56px;
      height: 56px;
    }
    .sys-b .sys-b-gauge-value {
      font-size: 0.78rem;
    }
    .sys-b .sys-b-gauge-value.long {
      font-size: 0.62rem;
    }
    .sys-b .sys-b-row,
    .sys-b .sys-b-hidden > summary {
      column-gap: 10px;
      padding: 8px 10px;
    }
    .sys-b .sys-b-row + .sys-b-row::before {
      left: 50px;
    }
    .sys-b .sys-b-hidden > .sys-b-note {
      padding-left: 50px;
    }
    .sys-b .sys-b-pill {
      padding: 4px 10px;
    }
  }
`;
