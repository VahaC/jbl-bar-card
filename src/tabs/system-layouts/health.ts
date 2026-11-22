// System tab layout variant C ("Health dashboard"). Remove the losing
// variants once one is picked.
//
// Layout: a health hero (all good / N things need attention, with the issues and the battery
// advice), a grid of device cards (Bluetooth, Subwoofer, Surround calibration) with the action
// at the bottom of each card, a slim Restart row, and a row of diagnostics chips with tiny gauges.
// Everything comes from SystemModel; this file only decides how it looks.
import { css, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import type { TabContext } from "../../types";
import type { SysAction, SysDevice, SysMetric, SystemModel, Tone } from "../system-model";

const HERO_ICON: Record<Tone, string> = {
  ok: "mdi:check-circle-outline",
  info: "mdi:information-outline",
  warn: "mdi:alert-outline",
  err: "mdi:alert-circle-outline",
  neutral: "mdi:information-outline",
};

export function renderSystemHealth(ctx: TabContext, model: SystemModel): TemplateResult {
  const hasDevices = Boolean(model.bluetooth || model.subwoofer || model.calibration || model.restart);
  const hasAnything = hasDevices || model.metrics.length > 0 || model.batteries.length > 0 || model.hiddenMetrics.length > 0;
  if (!hasAnything) {
    return html`<div class="sys-c"><p class="hint">${ctx.t("system.empty")}</p></div>`;
  }
  return html`<div class="sys-c">
    ${renderHero(ctx, model)}${renderOfflineLine(ctx, model)}${renderDevices(ctx, model)}${renderRestart(ctx, model)}${renderDiagnostics(ctx, model)}
  </div>`;
}

/* ---------------- Health hero ---------------- */

function renderHero(ctx: TabContext, model: SystemModel): TemplateResult | typeof nothing {
  const { t } = ctx;
  const issues = model.issues;
  // While the bar is unreachable the card's own strip already says so; a hero would repeat it.
  // Stale issues (a low battery read before the bar dropped) still show, marked as possibly old.
  if (ctx.barUnavailable && !issues.length) return nothing;
  // Info issues are good news (rear speakers charging on the bar): keep the calm hero for them.
  const needsAttention = issues.some((issue) => issue.tone !== "info");
  const tone: Tone = needsAttention ? issues[0].tone : "ok";
  const title = needsAttention ? t("system_health.attention", { count: issues.length }) : t("system_health.all_good");
  const sub = ctx.barUnavailable ? t("system_health.offline_sub") : issues.length ? undefined : t("system_health.all_good_sub");
  return html`<section class="sys-c-hero tone-${tone}">
    <span class="sys-c-hero-icon" aria-hidden="true"><ha-icon .icon=${HERO_ICON[tone]}></ha-icon></span>
    <div class="sys-c-hero-body">
      <div class="sys-c-hero-title" aria-live="polite">${title}</div>
      ${sub ? html`<div class="sys-c-hero-sub">${sub}</div>` : nothing}
      ${issues.length
        ? html`<ul class="sys-c-issues">
            ${issues.map((issue) => html`<li class="tone-${issue.tone}"><span class="sys-c-dot" aria-hidden="true"></span>${issue.text}</li>`)}
          </ul>`
        : nothing}
    </div>
    ${model.batteryAdvice
      ? html`<div class="sys-c-advice ${model.docked ? "charging" : ""}">
          <ha-icon .icon=${model.docked ? "mdi:battery-charging-30" : "mdi:battery-alert-variant-outline"}></ha-icon>
          <span>${model.batteryAdvice}</span>
        </div>`
      : nothing}
  </section>`;
}

/* ---------------- Device cards ---------------- */

interface CardSpec {
  cls: string;
  icon: string;
  title: string;
  device: SysDevice;
  /** Secondary lines under the status (device name, audio). */
  lines: (string | undefined)[];
  /** Guide or pairing hint: longer text, so the card spans both columns. */
  note?: string;
  action?: SysAction;
  /** The one filled "next step" button of the tab. */
  primary?: boolean;
  /** A second way forward (Switch to Bluetooth). */
  extra?: SysAction;
  wide?: boolean;
}

/** All actions the tab shows, for the shared "unreachable" line. */
function allActions(model: SystemModel): SysAction[] {
  return [model.bluetooth?.pair, model.bluetooth?.switchSource, model.subwoofer?.pair, model.calibration?.start, model.restart].filter(
    (action): action is SysAction => Boolean(action),
  );
}

/** Blocked with no reason of its own: only happens while the bar is unreachable. */
const silentBlock = (ctx: TabContext, action: SysAction): boolean =>
  Boolean(ctx.barUnavailable) && !action.enabled && !action.pending && !action.reason;

/** One shared reason for every action the unreachable bar blocks, instead of one per action. */
function renderOfflineLine(ctx: TabContext, model: SystemModel): TemplateResult | typeof nothing {
  if (!allActions(model).some((action) => silentBlock(ctx, action))) return nothing;
  return html`<div class="sys-c-offline">
    <ha-icon .icon=${"mdi:lan-disconnect"} aria-hidden="true"></ha-icon>
    <span>${ctx.t("system_health.actions_offline")}</span>
  </div>`;
}

function renderDevices(ctx: TabContext, model: SystemModel): TemplateResult | typeof nothing {
  const { t } = ctx;
  const cards: CardSpec[] = [];
  const bt = model.bluetooth;
  if (bt) {
    cards.push({
      cls: "bluetooth",
      icon: bt.connected ? "mdi:bluetooth-connect" : "mdi:bluetooth",
      title: t("system.bt.title"),
      device: bt,
      lines: [bt.device, bt.audio],
      note: bt.pairingHint,
      action: bt.pair,
      extra: bt.switchSource,
    });
  }
  const sub = model.subwoofer;
  if (sub) {
    cards.push({
      cls: "subwoofer",
      icon: "mdi:speaker",
      title: t("system.sub.title"),
      device: sub,
      lines: [],
      note: sub.pairingHint,
      action: sub.pair,
    });
  }
  const cal = model.calibration;
  if (cal) {
    cards.push({
      cls: "calibration",
      icon: "mdi:surround-sound",
      title: t("system.cal.title"),
      device: cal,
      lines: [],
      note: cal.guide,
      action: cal.start,
      primary: true,
    });
  }
  if (!cards.length) return nothing;
  // Pair half-width cards in DOM order (no dense packing, so visual order = reading order):
  // a card with a note spans both columns, and a half card left without a partner spans too.
  let open: CardSpec | undefined;
  for (const card of cards) {
    if (card.note) {
      if (open) open.wide = true;
      open = undefined;
      card.wide = true;
    } else if (open) {
      open = undefined;
    } else {
      open = card;
    }
  }
  if (open) open.wide = true;
  return html`<div class="sys-c-grid">${cards.map((card) => renderCard(ctx, card))}</div>`;
}

function renderCard(ctx: TabContext, card: CardSpec): TemplateResult {
  const { device } = card;
  const lines = card.lines.filter((line): line is string => Boolean(line));
  // The unknown dash says nothing; leave the title alone instead.
  const showStatus = device.status !== ctx.t("common.unknown");
  // While the device itself is busy (measuring, sub pairing) the spinner and the note carry it.
  const action = card.action && !(card.action.pending && device.busy && card.note) ? card.action : undefined;
  const blocked = action && !action.enabled && !action.pending;
  return html`<section class="sys-c-card ${card.cls} ${card.wide ? "wide" : ""}" aria-label=${card.title}>
    <div class="sys-c-card-head">
      <span class="sys-c-card-icon" aria-hidden="true"><ha-icon .icon=${card.icon}></ha-icon></span>
      <div class="sys-c-card-titles">
        <div class="sys-c-card-title">${card.title}</div>
        <div class="sys-c-status tone-${device.tone} ${showStatus ? "" : "empty"}" aria-live="polite">
          ${showStatus
            ? html`${device.busy ? html`<span class="spinner" aria-hidden="true"></span>` : html`<span class="sys-c-dot" aria-hidden="true"></span>`}
                <span class="sys-c-status-text">${device.status}</span>`
            : nothing}
        </div>
      </div>
    </div>
    ${lines.length ? html`<div class="sys-c-lines">${lines.map((line) => html`<div class="sys-c-line">${line}</div>`)}</div>` : nothing}
    ${card.note ? html`<div class="sys-c-note">${card.note}</div>` : nothing}
    ${action || card.extra
      ? html`<div class="sys-c-actions">
          ${action
            ? blocked
              ? renderBlocked(ctx, action, card.extra)
              : renderButton(action, card.primary && action.enabled ? "primary" : "main")
            : nothing}
          ${card.extra && !blocked ? renderButton(card.extra, "link") : nothing}
        </div>`
      : nothing}
  </section>`;
}

/** Never a bare disabled button: the action's name and why it cannot run now, as text. */
function renderBlocked(ctx: TabContext, action: SysAction, extra?: SysAction): TemplateResult {
  const silent = silentBlock(ctx, action);
  const reason = action.reason ?? (silent ? undefined : ctx.t("system.unavailable"));
  return html`<div class="sys-c-blocked ${silent ? "silent" : ""}" data-key=${action.key}>
    <span class="sys-c-blocked-label"><ha-icon .icon=${action.icon} aria-hidden="true"></ha-icon><span>${action.label}</span></span>
    ${reason ? html`<span class="sys-c-reason">${reason}</span>` : nothing}
    ${extra ? renderButton(extra, "link") : nothing}
  </div>`;
}

function renderButton(action: SysAction, kind: "primary" | "main" | "link" | "danger"): TemplateResult {
  return html`<button
    class="sys-c-btn ${kind} ${action.pending ? "pending" : ""}"
    data-key=${action.key}
    aria-disabled=${action.enabled ? "false" : "true"}
    aria-busy=${action.pending ? "true" : "false"}
    @click=${() => {
      if (action.enabled) action.run();
    }}
  >
    ${action.pending ? html`<span class="spinner" aria-hidden="true"></span>` : html`<ha-icon .icon=${action.icon} aria-hidden="true"></ha-icon>`}
    <span>${action.label}</span>
  </button>`;
}

/* ---------------- Restart ---------------- */

/** A slim, quiet row after the device cards: the recovery action, red only in its button. */
function renderRestart(ctx: TabContext, model: SystemModel): TemplateResult | typeof nothing {
  const restart = model.restart;
  if (!restart) return nothing;
  const title = ctx.t("system.restart.title");
  return html`<section class="sys-c-restart" aria-label=${title}>
    <span class="sys-c-card-icon" aria-hidden="true"><ha-icon .icon=${"mdi:restart"}></ha-icon></span>
    <div class="sys-c-restart-text">
      <div class="sys-c-card-title">${title}</div>
      <div class="sys-c-restart-hint">${restart.hint}</div>
    </div>
    ${!restart.enabled && !restart.pending ? renderBlocked(ctx, restart) : renderButton(restart, "danger")}
  </section>`;
}

/* ---------------- Diagnostics ---------------- */

function renderDiagnostics(ctx: TabContext, model: SystemModel): TemplateResult | typeof nothing {
  const { t } = ctx;
  if (!model.metrics.length && !model.hiddenMetrics.length) return nothing;
  return html`<section class="sys-c-diag" aria-label=${t("system_health.diagnostics")}>
    <div class="sys-c-diag-title">${t("system_health.diagnostics")}</div>
    ${model.metrics.length ? html`<div class="sys-c-chips">${model.metrics.map((m) => renderChip(ctx, m))}</div>` : nothing}
    ${model.hiddenMetrics.length
      ? html`<details class="sys-c-hidden">
          <summary>${t("system.disabled.summary", { names: model.hiddenMetrics.join(", ") })}</summary>
          <div>${model.hiddenHow}</div>
        </details>`
      : nothing}
  </section>`;
}

function renderChip(ctx: TabContext, metric: SysMetric): TemplateResult {
  const pct = metric.ratio === undefined ? undefined : Math.round(metric.ratio * 100);
  return html`<button
    class="sys-c-chip ${metric.key}"
    title=${metric.title ?? metric.label}
    @click=${() => ctx.moreInfo(metric.entity)}
  >
    <span class="sys-c-chip-label"><ha-icon .icon=${metric.icon}></ha-icon><span>${metric.label}</span></span>
    <span class="sys-c-chip-value">${metric.value}${metric.sub ? html` <span class="sys-c-chip-sub">${metric.sub}</span>` : nothing}</span>
    ${pct !== undefined
      ? html`<span class="sys-c-gauge tone-${metric.tone ?? "neutral"}" aria-hidden="true"
          ><span style=${styleMap({ width: `${Math.max(pct, 3)}%` })}></span
        ></span>`
      : nothing}
  </button>`;
}

/** Styles for variant C only; every selector starts with .sys-c. */
export const systemHealthStyles = css`
  .sys-c {
    display: flex;
    flex-direction: column;
    gap: 12px;
    --sys-c-ok: var(--jbl-success);
    --sys-c-info: var(--jbl-info);
    --sys-c-warn: var(--jbl-warning);
    --sys-c-err: var(--jbl-error);
    --sys-c-neutral: var(--jbl-muted);
    /* Red text that keeps >= 4.5:1 in both themes: nudged towards the theme's text colour. */
    --sys-c-danger-text: color-mix(in srgb, var(--jbl-error) 80%, var(--jbl-text));
  }
  .sys-c .tone-ok {
    --sys-c-tone: var(--sys-c-ok);
  }
  .sys-c .tone-info {
    --sys-c-tone: var(--sys-c-info);
  }
  .sys-c .tone-warn {
    --sys-c-tone: var(--sys-c-warn);
  }
  .sys-c .tone-err {
    --sys-c-tone: var(--sys-c-err);
  }
  .sys-c .tone-neutral {
    --sys-c-tone: var(--sys-c-neutral);
  }
  .sys-c .sys-c-dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--sys-c-tone, var(--jbl-muted));
  }

  /* Health hero */
  .sys-c .sys-c-hero {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    column-gap: 14px;
    row-gap: 8px;
    padding: 14px 16px;
    border-radius: var(--jbl-radius);
    background: color-mix(in srgb, var(--sys-c-tone) 10%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sys-c-tone) 28%, transparent);
  }
  .sys-c .sys-c-hero-icon {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    color: var(--sys-c-tone);
    background: color-mix(in srgb, var(--sys-c-tone) 16%, transparent);
  }
  .sys-c .sys-c-hero-icon ha-icon {
    --mdc-icon-size: 26px;
  }
  .sys-c .sys-c-hero-body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 2px;
  }
  .sys-c .sys-c-hero-title {
    font-size: 1.15rem;
    font-weight: 600;
    line-height: 1.25;
  }
  .sys-c .sys-c-hero-sub {
    font-size: 0.85rem;
    color: var(--jbl-muted);
    line-height: 1.35;
  }
  .sys-c .sys-c-issues {
    list-style: none;
    margin: 2px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 0.9rem;
    font-variant-numeric: tabular-nums;
  }
  .sys-c .sys-c-issues li {
    display: flex;
    align-items: flex-start;
    line-height: 1.35;
    gap: 8px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .sys-c .sys-c-issues li .sys-c-dot {
    margin-top: calc(0.675em - 4px);
  }
  .sys-c .sys-c-advice {
    grid-column: 2;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--jbl-radius-sm);
    background: var(--jbl-card-bg);
    font-size: 0.85rem;
    font-weight: 500;
    line-height: 1.35;
  }
  .sys-c .sys-c-advice > ha-icon {
    flex: none;
    color: var(--jbl-warning);
    --mdc-icon-size: 18px;
  }
  .sys-c .sys-c-advice.charging > ha-icon {
    color: var(--jbl-success);
  }

  /* One shared reason while the bar is unreachable. */
  .sys-c .sys-c-offline {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 0.85rem;
    line-height: 1.35;
    color: var(--jbl-muted);
  }
  .sys-c .sys-c-offline > ha-icon {
    flex: none;
    --mdc-icon-size: 18px;
  }

  /* Device cards: outlined on the card background, so the tab is not a wall of grey boxes. */
  .sys-c .sys-c-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-flow: row;
    gap: 10px;
  }
  .sys-c .sys-c-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    padding: 12px;
    border-radius: var(--jbl-radius-sm);
    background: var(--jbl-card-bg);
    box-shadow: inset 0 0 0 1px var(--jbl-border);
  }
  .sys-c .sys-c-card.wide {
    grid-column: 1 / -1;
  }
  .sys-c .sys-c-card-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-width: 0;
  }
  .sys-c .sys-c-card-icon {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    background: var(--jbl-surface);
    color: var(--jbl-accent-text);
  }
  .sys-c .sys-c-card-titles {
    flex: 1 1 auto;
    min-width: 0;
  }
  .sys-c .sys-c-card-title {
    font-weight: 500;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .sys-c .sys-c-status {
    display: flex;
    align-items: flex-start;
    line-height: 1.3;
    gap: 6px;
    margin-top: 2px;
    font-size: 0.85rem;
    min-width: 0;
  }
  .sys-c .sys-c-status.empty {
    display: none;
  }
  /* The tone lives in the dot only; the text keeps full contrast. */
  .sys-c .sys-c-status-text {
    color: var(--jbl-text);
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .sys-c .sys-c-status.tone-neutral .sys-c-status-text {
    color: var(--jbl-muted);
  }
  /* Dot and spinner sit on the first line when the status wraps. */
  .sys-c .sys-c-status .sys-c-dot {
    margin-top: calc(0.65em - 4px);
  }
  .sys-c .sys-c-status .spinner {
    width: 10px;
    height: 10px;
    box-sizing: border-box;
    margin-top: calc(0.65em - 5px);
  }
  .sys-c .sys-c-lines {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .sys-c .sys-c-line {
    font-size: 0.85rem;
    color: var(--jbl-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sys-c .sys-c-line:first-child {
    color: var(--jbl-text);
  }
  .sys-c .sys-c-note {
    font-size: 0.85rem;
    line-height: 1.4;
    padding: 8px 10px;
    border-radius: var(--jbl-radius-sm);
    background: color-mix(in srgb, var(--jbl-surface) 65%, transparent);
  }
  .sys-c .sys-c-actions {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    min-width: 0;
  }

  /* Buttons: compact and start-aligned. Only the next step is filled. */
  .sys-c .sys-c-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    min-height: 34px;
    box-sizing: border-box;
    padding: 6px 12px;
    border: 0;
    border-radius: var(--jbl-radius-sm);
    font: inherit;
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.2;
    text-align: start;
    cursor: pointer;
    background: transparent;
    color: var(--jbl-accent-text);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--jbl-accent-text) 55%, transparent);
  }
  .sys-c .sys-c-btn > ha-icon,
  .sys-c .sys-c-btn > .spinner {
    flex: none;
    --mdc-icon-size: 18px;
  }
  .sys-c .sys-c-btn > .spinner {
    box-sizing: border-box;
  }
  .sys-c .sys-c-btn > span:last-child {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .sys-c .sys-c-btn:hover:not([aria-disabled="true"]) {
    background: color-mix(in srgb, var(--jbl-accent-text) 10%, transparent);
  }
  .sys-c .sys-c-btn:focus-visible {
    outline: 2px solid var(--jbl-accent);
    outline-offset: 2px;
  }
  .sys-c .sys-c-btn.primary {
    background: var(--jbl-accent-fill);
    color: var(--jbl-on-accent);
    box-shadow: none;
  }
  .sys-c .sys-c-btn.primary:hover:not([aria-disabled="true"]) {
    background: color-mix(in srgb, var(--jbl-accent-fill) 88%, black);
  }
  /* Text-style link (Switch to Bluetooth). */
  .sys-c .sys-c-btn.link {
    min-height: 32px;
    padding: 4px 6px;
    margin-inline-start: -6px;
    box-shadow: none;
  }
  .sys-c .sys-c-btn.link > span:last-child {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .sys-c .sys-c-btn[aria-disabled="true"] {
    cursor: default;
  }
  .sys-c .sys-c-btn.pending {
    background: transparent;
    color: var(--jbl-text);
    box-shadow: inset 0 0 0 1px var(--jbl-border);
  }
  .sys-c .sys-c-btn.danger {
    min-height: 32px;
    padding: 4px 12px;
    color: var(--sys-c-danger-text);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--jbl-error) 45%, transparent);
  }
  .sys-c .sys-c-btn.danger:hover:not([aria-disabled="true"]),
  .sys-c .sys-c-btn.danger:focus-visible {
    background: color-mix(in srgb, var(--jbl-error) 12%, transparent);
    box-shadow: inset 0 0 0 1px var(--jbl-error);
  }
  .sys-c .sys-c-btn.danger:focus-visible {
    outline-color: var(--jbl-error);
  }
  .sys-c .sys-c-blocked {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    align-self: stretch;
    padding: 7px 10px;
    border-radius: var(--jbl-radius-sm);
    background: color-mix(in srgb, var(--jbl-surface) 65%, transparent);
    font-size: 0.82rem;
    line-height: 1.35;
    color: var(--jbl-muted);
    min-width: 0;
  }
  /* Blocked only because the bar is unreachable: a plain label, the shared line says why. */
  .sys-c .sys-c-blocked.silent {
    padding: 2px 0;
    background: transparent;
  }
  .sys-c .sys-c-blocked.silent .sys-c-blocked-label {
    font-weight: 400;
  }
  .sys-c .sys-c-blocked-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    color: var(--jbl-muted);
  }
  .sys-c .sys-c-blocked-label > ha-icon {
    flex: none;
    --mdc-icon-size: 16px;
  }
  .sys-c .sys-c-reason {
    overflow-wrap: anywhere;
  }
  .sys-c .sys-c-blocked .sys-c-btn.link {
    margin-top: 2px;
  }

  /* Restart: a slim row after the device cards, quiet until its red button. */
  .sys-c .sys-c-restart {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: 10px;
    row-gap: 8px;
    padding: 8px 12px;
    border-radius: var(--jbl-radius-sm);
    box-shadow: inset 0 0 0 1px var(--jbl-border);
  }
  .sys-c .sys-c-restart .sys-c-card-icon {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    color: var(--jbl-muted);
  }
  .sys-c .sys-c-restart .sys-c-card-icon ha-icon {
    --mdc-icon-size: 20px;
  }
  .sys-c .sys-c-restart-text {
    flex: 1 1 160px;
    min-width: 0;
  }
  .sys-c .sys-c-restart .sys-c-card-title {
    font-size: 0.92rem;
  }
  .sys-c .sys-c-restart-hint {
    font-size: 0.8rem;
    line-height: 1.3;
    color: var(--jbl-muted);
  }
  .sys-c .sys-c-restart > .sys-c-btn,
  .sys-c .sys-c-restart > .sys-c-blocked {
    flex: 0 0 auto;
    margin-inline-start: auto;
  }
  .sys-c .sys-c-restart > .sys-c-blocked {
    align-self: center;
  }

  /* Diagnostics */
  .sys-c .sys-c-diag {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 2px;
  }
  .sys-c .sys-c-diag-title {
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--jbl-muted);
  }
  .sys-c .sys-c-chips {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
    gap: 6px;
  }
  .sys-c .sys-c-chip {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    padding: 8px 10px;
    border: 0;
    border-radius: var(--jbl-radius-sm);
    background: var(--jbl-surface);
    color: var(--jbl-text);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .sys-c .sys-c-chip:hover {
    background: color-mix(in srgb, var(--jbl-accent) 10%, var(--jbl-surface));
  }
  .sys-c .sys-c-chip:focus-visible {
    outline: 2px solid var(--jbl-accent);
    outline-offset: 2px;
  }
  .sys-c .sys-c-chip-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.72rem;
    line-height: 1.2;
    color: var(--jbl-muted);
    min-width: 0;
  }
  .sys-c .sys-c-chip-label > ha-icon {
    flex: none;
    --mdc-icon-size: 14px;
  }
  .sys-c .sys-c-chip-label > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sys-c .sys-c-chip-value {
    font-size: 0.95rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sys-c .sys-c-chip-sub {
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--jbl-muted);
  }
  .sys-c .sys-c-gauge {
    display: block;
    height: 3px;
    margin-top: 2px;
    border-radius: 2px;
    background: var(--jbl-border);
    overflow: hidden;
  }
  .sys-c .sys-c-gauge > span {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--sys-c-tone, var(--jbl-accent));
  }
  .sys-c .sys-c-hidden {
    font-size: 0.8rem;
    color: var(--jbl-muted);
    line-height: 1.4;
  }
  .sys-c .sys-c-hidden summary {
    cursor: pointer;
    border-radius: 4px;
  }
  .sys-c .sys-c-hidden summary:focus-visible {
    outline: 2px solid var(--jbl-accent);
    outline-offset: 2px;
  }
  .sys-c .sys-c-hidden > div {
    margin-top: 4px;
  }

  /* Narrow cards: one column of device cards. */
  @container (max-width: 359px) {
    .sys-c .sys-c-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .sys-c .sys-c-hero {
      column-gap: 10px;
      padding: 12px;
    }
    .sys-c .sys-c-advice {
      grid-column: 1 / -1;
    }
    .sys-c .sys-c-hero-icon {
      width: 38px;
      height: 38px;
    }
    .sys-c .sys-c-hero-icon ha-icon {
      --mdc-icon-size: 22px;
    }
  }
`;
