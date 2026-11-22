// System tab layout variant A, "Hardware map".
// A picture of the system (phone, soundbar, rear speakers, subwoofer) where every
// device is a node; tapping one opens a small action panel under the picture. The
// diagnostics shrink to a strip of chips and Restart to a quiet footer link.
// Renders only from SystemModel; no rule is decided here. Remove the losing
// variants once one is picked.
import { css, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { IMAGES } from "../../assets";
import type { TabContext } from "../../types";
import { batteryIcon } from "../home-model";
import type { SysAction, SysBattery, SysMetric, SystemModel, Tone } from "../system-model";

type NodeId = "bt" | "cal" | "sub";

/**
 * Per-card UI state. `open` is the panel the user picked; without one, the busy device's panel opens by
 * itself unless the user closed that very panel (`dismissed`), which lasts until the busy device changes.
 */
interface ALocal {
  open?: NodeId;
  dismissed?: NodeId | null;
  lastAuto?: NodeId | null;
}

const PANEL_ID = "sys-a-panel";

export function renderSystemMap(ctx: TabContext, model: SystemModel): TemplateResult {
  const local = ctx.local<ALocal>("system_map", () => ({}));
  const nodes: NodeId[] = [];
  if (model.bluetooth) nodes.push("bt");
  if (model.calibration) nodes.push("cal");
  if (model.subwoofer) nodes.push("sub");

  // Until the user picks a device, show the panel of whatever is working right now.
  const auto: NodeId | null = model.calibration?.busy
    ? "cal"
    : model.subwoofer?.busy
      ? "sub"
      : model.bluetooth?.busy || model.bluetooth?.pairingHint
        ? "bt"
        : null;
  if (local.lastAuto !== auto) {
    local.lastAuto = auto;
    local.dismissed = undefined;
  }
  const chosen = local.open ?? (auto !== local.dismissed ? auto : null);
  const open = chosen && nodes.includes(chosen) ? chosen : null;
  const toggle = (id: NodeId): void => {
    if (open === id) {
      local.open = undefined;
      local.dismissed = auto;
    } else {
      local.open = id;
    }
    ctx.requestUpdate();
  };

  const hasMap = nodes.length > 0 || model.batteries.length > 0;
  const parts = [
    renderBanner(ctx, model),
    hasMap ? renderMap(ctx, model, open, toggle) : nothing,
    open ? renderPanel(ctx, model, open, () => toggle(open)) : nothing,
    hasMap && !open && nodes.length ? html`<p class="sys-a-taphint">${ctx.t("system_map.tap_hint")}</p>` : nothing,
    renderMetrics(ctx, model),
    renderRestart(ctx, model),
  ].filter((part) => part !== nothing);

  return html`<div class="sys-a" lang=${ctx.lang}>${parts.length ? parts : html`<p class="hint">${ctx.t("system.empty")}</p>`}</div>`;
}

/* ---------------- Low battery banner ---------------- */

function batteryLevel(ctx: TabContext, b: SysBattery): string {
  return b.level === undefined
    ? ctx.t("common.unknown")
    : ctx.t("system.percent", { value: ctx.formatNumber(Math.round(b.level)) });
}

function renderBanner(ctx: TabContext, model: SystemModel): TemplateResult | typeof nothing {
  if (!model.lowBatteries.length) return nothing;
  const { t } = ctx;
  const charging = model.docked;
  return html`<div class="sys-a-banner ${charging ? "charging" : ""}" role=${charging ? "status" : "alert"}>
    <ha-icon .icon=${charging ? "mdi:battery-charging-30" : "mdi:battery-alert-variant-outline"}></ha-icon>
    <div class="sys-a-banner-body">
      <div class="sys-a-banner-head">
        <span class="sys-a-banner-title">${t("system.battery.title")}</span>
        ${model.lowBatteries.map(
          (b) => html`<span class="sys-a-banner-level">${t(`system.battery.${b.side}`, { level: batteryLevel(ctx, b) })}</span>`,
        )}
      </div>
      ${model.batteryAdvice ? html`<div class="sys-a-banner-advice">${model.batteryAdvice}</div>` : nothing}
    </div>
  </div>`;
}

/* ---------------- Hardware map ---------------- */

/** A device status for the map. An unreachable bar reports no state, so say that instead of a bare dash. */
function nodeStatus(ctx: TabContext, status: string): string {
  return ctx.barUnavailable ? ctx.t("header.unreachable") : status;
}

function renderMap(ctx: TabContext, model: SystemModel, open: NodeId | null, toggle: (id: NodeId) => void): TemplateResult {
  const { t } = ctx;
  const { bluetooth: bt, calibration: cal, subwoofer: sub } = model;
  const docked = model.docked;
  const hasRears = model.batteries.length > 0 || Boolean(cal);
  const rearPics = hasRears && !docked;
  const measuring = Boolean(cal?.busy);

  // Grid areas: row 1 pictures, row 2 labels. Docked or narrow cards move the calibration node to a third row
  // (see the container query in the styles), so battery pills never collide with it.
  const subCol = sub ? " sub" : "";
  const columns = `minmax(0, 0.62fr) minmax(0, 2.6fr) minmax(0, 0.62fr)${sub ? " minmax(min-content, 0.85fr)" : ""}`;
  const areaVars = [
    `--sys-a-r1: "${rearPics ? "lpic bar rpic" : "bar bar bar"}${sub ? " subpic" : ""}"`,
    `--sys-a-r2: "left lbl right${subCol}"`,
    `--sys-a-r2b: "left . right${subCol}"`,
    `--sys-a-r3: "lbl lbl lbl${sub ? " lbl" : ""}"`,
  ].join("; ");

  // Pictures are mouse/touch shortcuts only; the labelled nodes below them are the focusable buttons.
  const rearClick = (side: "left" | "right"): void => {
    if (cal) toggle("cal");
    else ctx.moreInfo(model.batteries.find((b) => b.side === side)?.entity);
  };
  const rearPic = (side: "left" | "right"): TemplateResult => html`
    <div class="sys-a-cell sys-a-rear ${side} ${measuring ? "measuring" : ""}" aria-hidden="true" @click=${() => rearClick(side)}>
      <img class="sys-a-pic" src=${side === "left" ? IMAGES.rearLeft : IMAGES.rearRight} alt="" />
    </div>
  `;

  const battery = (side: "left" | "right"): TemplateResult | typeof nothing => {
    const b = model.batteries.find((x) => x.side === side);
    if (!b) return nothing;
    // While docked the rears charge, so a low level is no longer a warning (the banner turns green as well).
    const warn = b.low && !docked;
    return html`<button
      class="sys-a-batt ${side} ${warn ? "low" : ""} ${docked ? "charging" : ""}"
      @click=${() => ctx.moreInfo(b.entity)}
    >
      <span class="sr-only">${t(`home.room.rear_${side}`)}:</span>
      <ha-icon .icon=${warn ? "mdi:battery-alert-variant-outline" : batteryIcon(b.level, docked)}></ha-icon>
      <span>${batteryLevel(ctx, b)}</span>
      ${docked ? html`<span class="sr-only">, ${t("system_map.charging")}</span>` : nothing}
    </button>`;
  };

  const linked = bt?.connected === true;
  const phone = bt
    ? html`<button
          class="sys-a-node sys-a-phone ${linked ? "linked" : ""} ${open === "bt" ? "open" : ""}"
          aria-expanded=${open === "bt" ? "true" : "false"}
          aria-controls=${PANEL_ID}
          title=${bt.status}
          @click=${() => toggle("bt")}
        >
          <span class="sys-a-phone-ic" aria-hidden="true">
            <ha-icon .icon=${"mdi:cellphone"}></ha-icon>
            <ha-icon class="sys-a-phone-bt" .icon=${"mdi:bluetooth"}></ha-icon>
          </span>
          <span class="sr-only">${t("system.bt.title")}:</span>
          <span class="sys-a-node-text">${bt.device ?? t("system_map.no_device")}</span>
          ${bt.busy ? html`<span class="spinner" aria-hidden="true"></span>` : nothing}
        </button>
        <span class="sys-a-link ${linked ? "solid" : "dashed"}" aria-hidden="true"></span>`
    : nothing;

  const label = cal
    ? html`<button
        class="sys-a-node sys-a-cal tone-${cal.tone} ${open === "cal" ? "open" : ""}"
        aria-expanded=${open === "cal" ? "true" : "false"}
        aria-controls=${PANEL_ID}
        @click=${() => toggle("cal")}
      >
        ${cal.busy
          ? html`<span class="spinner" aria-hidden="true"></span>`
          : html`<ha-icon class="sys-a-tone-ic" .icon=${"mdi:surround-sound"}></ha-icon>`}
        <span class="sys-a-cal-text">
          <span class="sys-a-cal-name">${t("system_map.calibration")}<span class="sr-only">:</span></span>
          <span class="sys-a-node-text">${nodeStatus(ctx, cal.status)}</span>
        </span>
      </button>`
    : html`<span class="sys-a-barname">${t("home.room.bar")}</span>`;

  return html`<div class="sys-a-map ${docked ? "docked" : ""}" role="group" aria-label=${t("system_map.map")} style="grid-template-columns: ${columns}; ${areaVars}">
    ${rearPics ? rearPic("left") : nothing}
    <div class="sys-a-cell sys-a-barcell">
      ${phone}
      <img class="sys-a-pic sys-a-bar" src=${docked ? IMAGES.barDocked : IMAGES.barCenter} alt="" />
    </div>
    ${rearPics ? rearPic("right") : nothing}
    ${sub
      ? html`<div class="sys-a-cell sys-a-subpic" aria-hidden="true" @click=${() => toggle("sub")}>
          <span class="sys-a-subwrap">
            <img class="sys-a-pic" src=${IMAGES.subwoofer} alt="" />
            <span class="sys-a-subdot tone-${sub.tone} ${sub.busy ? "busy" : ""}"></span>
          </span>
        </div>`
      : nothing}
    <div class="sys-a-under left">${battery("left")}</div>
    <div class="sys-a-under lbl">${label}</div>
    <div class="sys-a-under right">${battery("right")}</div>
    ${sub
      ? html`<div class="sys-a-under sub">
          <button
            class="sys-a-node sys-a-sub tone-${sub.tone} ${open === "sub" ? "open" : ""}"
            aria-expanded=${open === "sub" ? "true" : "false"}
            aria-controls=${PANEL_ID}
            @click=${() => toggle("sub")}
          >
            ${sub.busy ? html`<span class="spinner" aria-hidden="true"></span>` : nothing}
            <span class="sr-only">${t("system.sub.title")}:</span>
            <span class="sys-a-node-text">${nodeStatus(ctx, sub.status)}</span>
          </button>
        </div>`
      : nothing}
  </div>`;
}

/* ---------------- Device panel ---------------- */

/**
 * The reason an action cannot run, as visible text. Stop-gap until system-model.ts sets `reason` itself for an
 * unreachable bar and for restart (see the prototype report); then this falls back to `a.reason` only.
 */
function whyNot(ctx: TabContext, a: SysAction): string | undefined {
  if (a.reason) return a.reason;
  if (a.enabled || a.pending) return undefined;
  return ctx.t(ctx.barUnavailable ? "system_map.unreachable" : "system.unavailable");
}

function renderAction(ctx: TabContext, a: SysAction, primary: boolean): TemplateResult {
  const why = whyNot(ctx, a);
  const whyId = `sys-a-why-${a.key.replace(/[^\w-]/g, "-")}`;
  const blocked = !a.enabled && !a.pending;
  return html`<div class="sys-a-act">
    <button
      class="sys-a-btn ${primary && a.enabled ? "primary" : ""} ${a.pending ? "pending" : ""} ${blocked ? "blocked" : ""}"
      data-key=${a.key}
      aria-disabled=${a.enabled ? "false" : "true"}
      aria-busy=${a.pending ? "true" : "false"}
      aria-describedby=${why ? whyId : nothing}
      @click=${() => {
        if (a.enabled) a.run();
      }}
    >
      ${a.pending ? html`<span class="spinner" aria-hidden="true"></span>` : html`<ha-icon .icon=${a.icon}></ha-icon>`}
      <span>${a.label}</span>
    </button>
    ${why
      ? html`<span class="sys-a-why" id=${whyId}><ha-icon .icon=${"mdi:information-outline"}></ha-icon><span>${why}</span></span>`
      : nothing}
  </div>`;
}

function renderNote(text: string, icon: string, kind: "guide" | "hint"): TemplateResult {
  return html`<div class="sys-a-note ${kind}" aria-live="polite"><ha-icon .icon=${icon}></ha-icon><span>${text}</span></div>`;
}

function renderStatus(ctx: TabContext, status: string, tone: Tone, busy: boolean, detail?: string): TemplateResult | typeof nothing {
  // An unreachable bar has no status to report; the blocked actions below already say why.
  if (ctx.barUnavailable) return nothing;
  return html`<div class="sys-a-status tone-${tone}">
    ${busy ? html`<span class="spinner" aria-hidden="true"></span>` : html`<span class="sys-a-dot" aria-hidden="true"></span>`}
    <span class="sys-a-status-text" aria-live="polite">${status}</span>
    ${detail ? html`<span class="sys-a-status-detail">${detail}</span>` : nothing}
  </div>`;
}

function renderPanel(ctx: TabContext, model: SystemModel, open: NodeId, close: () => void): TemplateResult | typeof nothing {
  const { t } = ctx;
  let title: string;
  let icon: string;
  let entity: string | undefined;
  let body: (TemplateResult | typeof nothing)[];

  if (open === "bt" && model.bluetooth) {
    const bt = model.bluetooth;
    title = t("system.bt.title");
    icon = "mdi:bluetooth";
    entity = bt.entity;
    body = [
      bt.device
        ? html`<div class="sys-a-device">
            <span class="sys-a-device-name">${bt.device}</span>
            ${bt.audio ? html`<span class="sys-a-device-sub">${bt.audio}</span>` : nothing}
          </div>`
        : nothing,
      renderStatus(ctx, bt.status, bt.tone, bt.busy),
      bt.switchSource || bt.pair
        ? html`<div class="sys-a-acts">
            ${bt.switchSource ? renderAction(ctx, bt.switchSource, true) : nothing}
            ${bt.pair ? renderAction(ctx, bt.pair, !bt.switchSource) : nothing}
          </div>`
        : nothing,
      bt.pairingHint ? renderNote(bt.pairingHint, "mdi:cellphone-check", "hint") : nothing,
    ];
  } else if (open === "cal" && model.calibration) {
    const cal = model.calibration;
    title = t("system.cal.title");
    icon = "mdi:surround-sound";
    entity = cal.entity;
    body = [
      renderStatus(ctx, cal.status, cal.tone, cal.busy),
      cal.guide ? renderNote(cal.guide, cal.busy ? "mdi:volume-off" : "mdi:map-marker-radius-outline", "guide") : nothing,
      // While measuring, the start button would only repeat the status line, so it is left out.
      cal.start && !cal.busy ? html`<div class="sys-a-acts">${renderAction(ctx, cal.start, true)}</div>` : nothing,
    ];
  } else if (open === "sub" && model.subwoofer) {
    const sub = model.subwoofer;
    title = t("system.sub.title");
    icon = "mdi:speaker";
    entity = sub.entity;
    body = [
      renderStatus(ctx, sub.status, sub.tone, sub.busy),
      sub.pair ? html`<div class="sys-a-acts">${renderAction(ctx, sub.pair, true)}</div>` : nothing,
      sub.pairingHint ? renderNote(sub.pairingHint, "mdi:gesture-tap-hold", "hint") : nothing,
    ];
  } else {
    return nothing;
  }

  return html`<section class="sys-a-panel ${open}" id=${PANEL_ID} aria-label=${title}>
    <div class="sys-a-panel-head">
      <ha-icon .icon=${icon}></ha-icon>
      <span class="sys-a-panel-title">${title}</span>
      ${entity
        ? html`<button class="sys-a-link-btn" @click=${() => ctx.moreInfo(entity)}>${t("system_map.details")}</button>`
        : nothing}
      <button class="sys-a-close" aria-label=${t("common.close")} title=${t("common.close")} @click=${close}>
        <ha-icon .icon=${"mdi:close"}></ha-icon>
      </button>
    </div>
    ${body.filter((part) => part !== nothing)}
  </section>`;
}

/* ---------------- Metrics strip ---------------- */

function chipText(ctx: TabContext, m: SysMetric): string {
  switch (m.key) {
    case "cpu":
    case "memory":
    case "wifi":
    case "uptime":
    case "mode_after_standby":
      return ctx.t(`system_map.metric.${m.key}`, { value: m.value });
    default:
      return m.value;
  }
}

function renderMetrics(ctx: TabContext, model: SystemModel): TemplateResult | typeof nothing {
  const { t } = ctx;
  if (!model.metrics.length && !model.hiddenMetrics.length) return nothing;
  return html`<div class="sys-a-diag">
    ${model.metrics.length
      ? html`<div class="sys-a-metrics" role="group" aria-label=${t("system_map.metrics")}>
          ${model.metrics.map((m) => {
            const full = `${m.label}: ${m.value}${m.sub ? ` (${m.sub})` : ""}`;
            return html`<button
              class="sys-a-chip ${m.key} tone-${m.tone ?? "none"}"
              title=${m.title ? `${full}. ${m.title}` : full}
              aria-label=${full}
              @click=${() => ctx.moreInfo(m.entity)}
            >
              <ha-icon .icon=${m.icon}></ha-icon><span>${chipText(ctx, m)}</span>
            </button>`;
          })}
        </div>`
      : nothing}
    ${model.hiddenMetrics.length
      ? html`<details class="sys-a-hidden">
          <summary>${t("system.disabled.summary", { names: model.hiddenMetrics.join(", ") })}</summary>
          <div class="sys-a-hidden-how">${model.hiddenHow}</div>
        </details>`
      : nothing}
  </div>`;
}

/* ---------------- Restart ---------------- */

function renderRestart(ctx: TabContext, model: SystemModel): TemplateResult | typeof nothing {
  const r = model.restart;
  if (!r) return nothing;
  const why = whyNot(ctx, r);
  return html`<div class="sys-a-foot">
    <span class="sys-a-foot-hint" id="sys-a-restart-hint">${why ?? r.hint}</span>
    <button
      class="sys-a-restart ${r.pending ? "pending" : ""} ${!r.enabled && !r.pending ? "blocked" : ""}"
      data-key=${r.key}
      title=${r.hint}
      aria-disabled=${r.enabled ? "false" : "true"}
      aria-busy=${r.pending ? "true" : "false"}
      aria-describedby="sys-a-restart-hint"
      @click=${() => {
        if (r.enabled) r.run();
      }}
    >
      ${r.pending ? html`<span class="spinner" aria-hidden="true"></span>` : html`<ha-icon .icon=${r.icon}></ha-icon>`}
      <span>${ctx.t("system_map.restart")}</span>
    </button>
  </div>`;
}

/** Styles for variant A only; every selector starts with .sys-a. */
export const systemMapStyles = css`
  .sys-a {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .sys-a .tone-ok {
    --sys-a-tone: var(--jbl-success);
  }
  .sys-a .tone-info {
    --sys-a-tone: var(--jbl-accent);
  }
  .sys-a .tone-warn {
    --sys-a-tone: var(--jbl-warning);
  }
  .sys-a .tone-err {
    --sys-a-tone: var(--jbl-error);
  }
  .sys-a .tone-neutral,
  .sys-a .tone-none {
    --sys-a-tone: var(--jbl-muted);
  }

  /* Low battery banner */
  .sys-a .sys-a-banner {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--jbl-radius-sm);
    border: 1px solid var(--jbl-warning);
    border-left-width: 4px;
    background: color-mix(in srgb, var(--jbl-warning) 13%, transparent);
  }
  .sys-a .sys-a-banner > ha-icon {
    --mdc-icon-size: 24px;
    color: var(--jbl-warning);
    flex: none;
  }
  .sys-a .sys-a-banner.charging {
    border-color: var(--jbl-success);
    background: color-mix(in srgb, var(--jbl-success) 10%, transparent);
  }
  .sys-a .sys-a-banner.charging > ha-icon {
    color: var(--jbl-success);
  }
  .sys-a .sys-a-banner-body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    line-height: 1.35;
  }
  .sys-a .sys-a-banner-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
  }
  .sys-a .sys-a-banner-title {
    font-weight: 600;
  }
  .sys-a .sys-a-banner-level {
    font-size: 0.9rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .sys-a .sys-a-banner-advice {
    font-size: 0.85rem;
  }

  /* Map */
  .sys-a .sys-a-map {
    display: grid;
    grid-template-areas: var(--sys-a-r1) var(--sys-a-r2);
    column-gap: 6px;
    row-gap: 8px;
    padding: 14px 12px 12px;
    border-radius: var(--jbl-radius);
    background:
      radial-gradient(120% 70% at 50% 100%, rgba(var(--jbl-accent-rgb), 0.07), transparent 70%),
      var(--jbl-surface);
  }
  .sys-a .sys-a-map.docked {
    grid-template-areas: var(--sys-a-r1) var(--sys-a-r2b) var(--sys-a-r3);
  }
  @container (max-width: 400px) {
    .sys-a .sys-a-map {
      grid-template-areas: var(--sys-a-r1) var(--sys-a-r2b) var(--sys-a-r3);
      padding: 12px 8px 10px;
    }
    .sys-a .sys-a-batt {
      padding: 1px 5px 1px 2px;
    }
    /* A long subwoofer status widens its column; keep the picture small so the bar stays the focus. */
    .sys-a .sys-a-map .sys-a-subwrap {
      max-width: 52px;
    }
    .sys-a .sys-a-map .sys-a-sub {
      font-size: 0.68rem;
      padding: 3px 6px;
    }
    .sys-a .sys-a-under.left {
      justify-content: flex-start;
    }
    .sys-a .sys-a-under.right {
      justify-content: flex-end;
    }
  }
  .sys-a .sys-a-cell {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    min-width: 0;
  }
  .sys-a .sys-a-rear.left {
    grid-area: lpic;
  }
  .sys-a .sys-a-rear.right {
    grid-area: rpic;
  }
  .sys-a .sys-a-rear,
  .sys-a .sys-a-subpic {
    cursor: pointer;
  }
  .sys-a .sys-a-barcell {
    grid-area: bar;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
  }
  .sys-a .sys-a-subpic {
    grid-area: subpic;
  }
  .sys-a .sys-a-pic {
    display: block;
    width: 100%;
    height: auto;
    user-select: none;
    -webkit-user-drag: none;
  }
  .sys-a .sys-a-rear.measuring .sys-a-pic {
    animation: sys-a-glow 1.6s ease-in-out infinite;
  }
  @keyframes sys-a-glow {
    0%,
    100% {
      filter: drop-shadow(0 0 1px rgba(var(--jbl-accent-rgb), 0.5));
    }
    50% {
      filter: drop-shadow(0 0 7px rgba(var(--jbl-accent-rgb), 1));
    }
  }
  .sys-a .sys-a-subwrap {
    position: relative;
    display: block;
    width: 100%;
    max-width: 72px;
  }
  .sys-a .sys-a-subdot {
    position: absolute;
    top: 4px;
    right: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--sys-a-tone);
    box-shadow: 0 0 0 2px var(--jbl-surface);
  }
  .sys-a .sys-a-subdot.busy {
    animation: sys-a-blink 1.1s ease-in-out infinite;
  }
  @keyframes sys-a-blink {
    50% {
      opacity: 0.3;
    }
  }

  /* Labels under the pictures */
  .sys-a .sys-a-under {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    min-width: 0;
  }
  .sys-a .sys-a-under.left {
    grid-area: left;
  }
  .sys-a .sys-a-under.right {
    grid-area: right;
  }
  .sys-a .sys-a-under.lbl {
    grid-area: lbl;
  }
  .sys-a .sys-a-under.sub {
    grid-area: sub;
  }
  .sys-a .sys-a-map.docked .sys-a-under.left {
    justify-content: flex-start;
  }
  .sys-a .sys-a-map.docked .sys-a-under.right {
    justify-content: flex-end;
  }
  .sys-a .sys-a-batt {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    padding: 2px 6px 2px 3px;
    border: 0;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    background: var(--jbl-card-bg);
    cursor: pointer;
  }
  .sys-a .sys-a-batt:hover {
    box-shadow: inset 0 0 0 1px rgba(var(--jbl-accent-rgb), 0.6);
  }
  .sys-a .sys-a-batt ha-icon {
    --mdc-icon-size: 15px;
    color: var(--jbl-muted);
  }
  .sys-a .sys-a-batt.charging ha-icon {
    color: var(--jbl-success);
  }
  .sys-a .sys-a-batt.low {
    background: color-mix(in srgb, var(--jbl-warning) 20%, var(--jbl-card-bg));
    box-shadow: inset 0 0 0 1px var(--jbl-warning);
    font-weight: 600;
  }
  .sys-a .sys-a-batt.low ha-icon {
    color: var(--jbl-warning);
  }
  .sys-a .sys-a-barname {
    font-size: 0.75rem;
    color: var(--jbl-muted);
  }

  /* Device nodes */
  .sys-a .sys-a-node {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--jbl-border);
    background: var(--jbl-card-bg);
    font-size: 0.8rem;
    line-height: 1.2;
    cursor: pointer;
    transition: background 120ms ease, border-color 120ms ease;
  }
  .sys-a .sys-a-node:hover {
    border-color: rgba(var(--jbl-accent-rgb), 0.6);
  }
  .sys-a .sys-a-node.open {
    border-color: var(--jbl-accent);
    background: rgba(var(--jbl-accent-rgb), 0.16);
    box-shadow: 0 0 0 1px var(--jbl-accent);
  }
  .sys-a .sys-a-node ha-icon {
    --mdc-icon-size: 18px;
    flex: none;
  }
  .sys-a .sys-a-node .spinner {
    width: 11px;
    height: 11px;
  }
  .sys-a .sys-a-node-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sys-a .sys-a-cal {
    border-radius: 12px;
    padding: 4px 12px 4px 8px;
    text-align: start;
  }
  .sys-a .sys-a-cal-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .sys-a .sys-a-cal-name {
    font-size: 0.74rem;
    color: var(--jbl-text);
    opacity: 0.72;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sys-a .sys-a-tone-ic {
    color: var(--sys-a-tone);
  }
  .sys-a .sys-a-phone {
    flex: none;
    padding-left: 6px;
  }
  .sys-a .sys-a-phone-ic {
    position: relative;
    display: inline-flex;
    flex: none;
    color: var(--jbl-muted);
  }
  .sys-a .sys-a-phone.linked .sys-a-phone-ic {
    color: var(--jbl-accent-text);
  }
  .sys-a .sys-a-node .sys-a-phone-bt {
    position: absolute;
    right: -5px;
    bottom: -3px;
    --mdc-icon-size: 11px;
    border-radius: 50%;
    padding: 1px;
    background: var(--jbl-muted);
    color: var(--jbl-card-bg);
  }
  .sys-a .sys-a-node.linked .sys-a-phone-bt {
    background: var(--jbl-accent-fill);
    color: var(--jbl-on-accent);
  }
  .sys-a .sys-a-link {
    flex: 1 1 auto;
    min-height: 12px;
    width: 0;
    border-left: 2px solid var(--jbl-accent);
  }
  .sys-a .sys-a-link.dashed {
    border-left: 2px dashed var(--jbl-muted);
    opacity: 0.7;
  }
  .sys-a .sys-a-sub {
    flex-direction: column;
    gap: 2px;
    min-width: 64px;
    max-width: 124px;
    padding: 3px 8px;
    border-radius: 10px;
    font-size: 0.72rem;
    text-align: center;
  }
  /* break-word (not anywhere) keeps the longest word as the min-content width, so the column grows to fit it. */
  .sys-a .sys-a-sub .sys-a-node-text,
  .sys-a .sys-a-cal .sys-a-node-text {
    white-space: normal;
    overflow-wrap: break-word;
    hyphens: auto;
  }

  .sys-a .sys-a-taphint {
    margin: -4px 0 0;
    text-align: center;
    font-size: 0.75rem;
    color: var(--jbl-muted);
  }

  /* Panel */
  .sys-a .sys-a-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: -4px;
    padding: 10px 12px 12px;
    border: 1px solid var(--jbl-border);
    border-top: 2px solid var(--jbl-accent);
    border-radius: var(--jbl-radius-sm);
    background: var(--jbl-card-bg);
  }
  .sys-a .sys-a-panel-head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .sys-a .sys-a-panel-head > ha-icon {
    color: var(--jbl-accent-text);
    flex: none;
  }
  .sys-a .sys-a-panel-title {
    flex: 1 1 auto;
    min-width: 0;
    font-weight: 500;
    line-height: 1.25;
    overflow-wrap: break-word;
  }
  .sys-a .sys-a-link-btn {
    flex: none;
    border: 0;
    background: none;
    padding: 4px 6px;
    border-radius: 6px;
    font-size: 0.8rem;
    color: var(--jbl-accent-text);
    cursor: pointer;
  }
  .sys-a .sys-a-link-btn:hover {
    text-decoration: underline;
  }
  .sys-a .sys-a-close {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--jbl-muted);
    cursor: pointer;
  }
  .sys-a .sys-a-close:hover {
    background: var(--jbl-surface);
  }
  .sys-a .sys-a-device {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .sys-a .sys-a-device-name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sys-a .sys-a-device-sub {
    font-size: 0.8rem;
    color: var(--jbl-muted);
  }
  .sys-a .sys-a-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.9rem;
    min-width: 0;
  }
  .sys-a .sys-a-dot {
    width: 9px;
    height: 9px;
    flex: none;
    border-radius: 50%;
    background: var(--sys-a-tone);
  }
  .sys-a .sys-a-status-text {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .sys-a .sys-a-note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--jbl-radius-sm);
    font-size: 0.85rem;
    line-height: 1.35;
    background: rgba(var(--jbl-accent-rgb), 0.1);
  }
  .sys-a .sys-a-note > ha-icon {
    --mdc-icon-size: 18px;
    flex: none;
    color: var(--jbl-accent-text);
  }
  .sys-a .sys-a-acts {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sys-a .sys-a-act {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
  }
  .sys-a .sys-a-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    min-width: 0;
    padding: 7px 14px;
    border: 1px solid var(--jbl-border);
    border-radius: 999px;
    background: var(--jbl-card-bg);
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
  }
  .sys-a .sys-a-btn > span:not(.spinner) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sys-a .sys-a-btn ha-icon {
    --mdc-icon-size: 18px;
    flex: none;
  }
  .sys-a .sys-a-btn:hover:not([aria-disabled="true"]) {
    border-color: var(--jbl-accent);
  }
  .sys-a .sys-a-btn.primary {
    background: var(--jbl-accent-fill);
    border-color: var(--jbl-accent-fill);
    color: var(--jbl-on-accent);
  }
  .sys-a .sys-a-btn.blocked {
    background: transparent;
    border-style: dashed;
    color: var(--jbl-muted);
    cursor: not-allowed;
  }
  .sys-a .sys-a-btn.pending,
  .sys-a .sys-a-restart.pending {
    cursor: progress;
    animation: sys-a-pulse 1.4s ease-in-out infinite;
  }
  @keyframes sys-a-pulse {
    50% {
      opacity: 0.6;
    }
  }
  .sys-a .sys-a-why {
    display: inline-flex;
    align-items: flex-start;
    gap: 4px;
    flex: 1 1 150px;
    min-width: 0;
    font-size: 0.8rem;
    line-height: 1.3;
    color: var(--jbl-text);
  }
  .sys-a .sys-a-why ha-icon {
    --mdc-icon-size: 16px;
    flex: none;
    color: var(--jbl-warning);
  }

  /* Diagnostics strip */
  .sys-a .sys-a-diag {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sys-a .sys-a-metrics {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .sys-a .sys-a-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
    min-height: 28px;
    padding: 4px 10px 4px 7px;
    border: 0;
    border-radius: 999px;
    background: var(--jbl-surface);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .sys-a .sys-a-chip > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sys-a .sys-a-chip ha-icon {
    --mdc-icon-size: 15px;
    flex: none;
    color: var(--jbl-muted);
  }
  .sys-a .sys-a-chip.tone-warn ha-icon,
  .sys-a .sys-a-chip.tone-err ha-icon {
    color: var(--sys-a-tone);
  }
  .sys-a .sys-a-chip.tone-warn,
  .sys-a .sys-a-chip.tone-err {
    box-shadow: inset 0 0 0 1px var(--sys-a-tone);
  }
  .sys-a .sys-a-chip:hover {
    background: rgba(var(--jbl-accent-rgb), 0.12);
  }
  .sys-a .sys-a-hidden {
    font-size: 0.75rem;
    color: var(--jbl-muted);
  }
  .sys-a .sys-a-hidden summary {
    display: flex;
    gap: 4px;
    cursor: pointer;
    width: fit-content;
    max-width: 100%;
    list-style: none;
  }
  .sys-a .sys-a-hidden summary::-webkit-details-marker {
    display: none;
  }
  .sys-a .sys-a-hidden summary::before {
    content: "+";
    flex: none;
    width: 0.7em;
    text-align: center;
  }
  .sys-a .sys-a-hidden[open] summary::before {
    content: "−";
  }
  .sys-a .sys-a-hidden-how {
    margin-top: 4px;
    line-height: 1.4;
  }

  /* Restart footer */
  .sys-a .sys-a-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 2px 10px;
    margin-top: 4px;
    padding-top: 8px;
    border-top: 1px solid var(--jbl-border);
  }
  .sys-a .sys-a-foot-hint {
    flex: 1 1 140px;
    min-width: 0;
    font-size: 0.75rem;
    line-height: 1.3;
    color: var(--jbl-muted);
  }
  .sys-a .sys-a-restart {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
    max-width: 100%;
    padding: 5px 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    /* Nudged toward the text colour: darker on light themes, lighter on dark ones, for 4.5:1 at this size. */
    color: color-mix(in srgb, var(--jbl-error) 85%, var(--jbl-text));
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
  }
  .sys-a .sys-a-restart ha-icon {
    --mdc-icon-size: 16px;
  }
  .sys-a .sys-a-restart:hover:not([aria-disabled="true"]) {
    background: color-mix(in srgb, var(--jbl-error) 12%, transparent);
  }
  .sys-a .sys-a-restart.blocked {
    color: var(--jbl-muted);
    cursor: not-allowed;
  }

  .sys-a button:focus-visible {
    outline: 2px solid var(--jbl-accent);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .sys-a .sys-a-rear.measuring .sys-a-pic {
      animation: none;
      filter: drop-shadow(0 0 5px rgba(var(--jbl-accent-rgb), 0.9));
    }
    .sys-a .sys-a-subdot.busy,
    .sys-a .sys-a-btn.pending,
    .sys-a .sys-a-restart.pending {
      animation: none;
    }
  }
`;
