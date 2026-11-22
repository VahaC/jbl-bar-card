// The "media" Home layout: a media player. A large "now playing" panel (track, or the source
// with its icon), a round volume knob with - / + and mute, the source as a compact segmented
// row and Smart mode / Night as small chips. The room picture is replaced by a status line
// with the rear batteries and the dock state. Rendered only from homeModel(); every decision
// (pending, what is sent, repeats) is the model's. See docs/layouts-home.md.
// Strings: src/i18n/home_media.ts ("home_media.<key>"). Every CSS selector starts with .home-media.
import { css, html, nothing, svg } from "lit";
import type { TemplateResult } from "lit";
import type { TabContext } from "../../types";
import type { HomeAction, HomeButton, HomeModel, HomeRear, HomeToggle, HomeVolume } from "../home-model";

/** ctx.local("home_media"): the knob gesture in progress (per card, survives re-renders). */
interface MediaLocal {
  drag?: {
    /** Pointer that drags the knob; undefined while the keyboard moves it. */
    pointerId?: number;
    /**
     * The pointer's angle from the start of the arc, followed by the shortest turn (pointer drags
     * only). Outside 0..ARC_SWEEP the pointer is in the gap and the knob rests on the end it left.
     */
    pos?: number;
    /** Last value previewed (sent once, on release). */
    value: number;
  };
}

/** The knob's arc: starts at the bottom left (135 deg, clockwise from 3 o'clock) and sweeps 270 deg. */
const ARC_START = 135;
const ARC_SWEEP = 270;
const VIEW = 200;
const CENTER = VIEW / 2;
const RADIUS = 80;
/** Keyboard steps of PageUp / PageDown. */
const PAGE_STEP = 4;

const SOURCE_ICONS: Record<string, string> = {
  TV: "mdi:television",
  HDMI: "mdi:video-input-hdmi",
  Bluetooth: "mdi:bluetooth",
};

/** Icons of well-known apps (app_name), matched case-insensitively by prefix. */
const APP_ICONS: [string, string][] = [
  ["spotify", "mdi:spotify"],
  ["youtube", "mdi:youtube"],
];

function sourceIcon(source: string | undefined): string {
  if (!source) return "mdi:soundbar";
  return SOURCE_ICONS[source] ?? "mdi:cast-audio";
}

function appIcon(app: string | undefined): string | undefined {
  const name = app?.toLowerCase();
  return name ? APP_ICONS.find(([prefix]) => name.startsWith(prefix))?.[1] : undefined;
}

function point(angleDeg: number, radius = RADIUS): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(a), y: CENTER + radius * Math.sin(a) };
}

const GAP = 360 - ARC_SWEEP;

/** The pointer's angle from the start of the arc, clockwise (0..360), or undefined when the element has no size. */
function angleAt(ev: PointerEvent, el: Element): number | undefined {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return undefined;
  const dx = ev.clientX - (r.left + r.width / 2);
  const dy = ev.clientY - (r.top + r.height / 2);
  return ((((Math.atan2(dy, dx) * 180) / Math.PI - ARC_START) % 360) + 360) % 360;
}

/** Where a drag starts: on the arc the angle itself, in the gap the nearer end (below 0 or above ARC_SWEEP). */
function startPos(angle: number): number {
  return angle > ARC_SWEEP + GAP / 2 ? angle - 360 : angle;
}

/**
 * Follow the pointer from `prev` to `angle` by the shortest turn. The gap is decided by the angle,
 * not by how far the value moved: a fast swipe over the top stays on the arc, and a move into the
 * gap stays on the end it left (it only reaches the other end after crossing the whole gap).
 */
function nextPos(prev: number, angle: number): number {
  const delta = ((((angle - prev) % 360) + 540) % 360) - 180;
  const pos = prev + delta;
  if (pos > 360) return pos - 360;
  if (pos < -GAP) return pos + 360;
  return pos;
}

function valueOf(pos: number, min: number, max: number): number {
  const along = Math.min(ARC_SWEEP, Math.max(0, pos));
  return min + Math.round((along / ARC_SWEEP) * (max - min));
}

/** The pointer is on the ring (not in the middle, where the number is). */
function onRing(ev: PointerEvent, el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (!r.width) return false;
  const dx = ev.clientX - (r.left + r.width / 2);
  const dy = ev.clientY - (r.top + r.height / 2);
  return Math.hypot(dx, dy) >= r.width * 0.3;
}

export function renderMedia(ctx: TabContext, model: HomeModel): TemplateResult {
  return html`
    <div class="home-media">
      ${renderStatus(ctx, model)} ${renderHero(ctx, model)} ${renderKnob(ctx, model.volume)} ${renderSource(model)}
      ${renderModes(model)} ${renderReasons(model)}
    </div>
  `;
}

/* ---------------- Status line: rear batteries, dock ---------------- */

function renderStatus(ctx: TabContext, model: HomeModel): TemplateResult | typeof nothing {
  const { room } = model;
  const rears = room.rears.filter((r) => r.batteryText !== undefined);
  if (!rears.length && !room.dockText) return nothing;
  const badge = (r: HomeRear): TemplateResult => html`
    <button
      class="m-batt ${r.low ? "low" : ""}"
      ?disabled=${!r.entity}
      aria-label=${r.batteryTitle ? `${r.label}, ${r.batteryTitle}` : r.label}
      title=${r.batteryTitle || r.name}
      @click=${r.open}
    >
      <ha-icon .icon=${r.batteryIcon}></ha-icon>
      <span class="side">${ctx.t(`home_media.rear_${r.side}_short`)}</span>
      <span class="level">${r.batteryText}</span>
      ${r.low ? html`<ha-icon class="alert" .icon=${"mdi:alert"}></ha-icon>` : nothing}
    </button>
  `;
  return html`
    <div class="status" role="group" aria-label=${room.label}>
      <div class="batts">${rears.map(badge)}</div>
      ${room.dockText
        ? html`<span class="dock ${room.docked ? "docked" : ""}" role="img" aria-label=${room.dockText} title=${room.dockText}>
            <ha-icon .icon=${room.docked ? "mdi:link-variant" : "mdi:link-variant-off"}></ha-icon>
          </span>`
        : nothing}
    </div>
  `;
}

/* ---------------- Now playing ---------------- */

function renderHero(ctx: TabContext, model: HomeModel): TemplateResult {
  const pb = model.playback;
  const current = model.source?.current;
  let kind: "m-standby" | "track" | "source";
  let icon: string;
  let eyebrow: string | undefined;
  let title: string;
  let subtitle: string | undefined;
  if (model.standby) {
    kind = "m-standby";
    icon = "mdi:power-sleep";
    eyebrow = model.room.barName;
    title = ctx.t("home_media.standby");
    subtitle = model.standbyHint;
  } else if (pb?.hasInfo) {
    kind = "track";
    icon = appIcon(pb.app) ?? sourceIcon(current);
    eyebrow = current ?? ctx.t("home.now_playing");
    title = pb.title;
    subtitle = pb.subtitle || undefined;
  } else {
    // The source in large type. Without a media_player only the bar's name; a source that is none
    // of the options (a cast app) is the title already, so its "Now playing from X" is not repeated.
    kind = "source";
    icon = sourceIcon(current);
    eyebrow = model.source?.title;
    title = current ?? model.room.barName;
  }
  const actions = pb?.actions ?? [];
  return html`
    <section class="hero ${kind}">
      <div class="hero-main">
        <div class="art" aria-hidden="true"><ha-icon .icon=${icon}></ha-icon></div>
        <div class="meta" aria-live="polite">
          ${eyebrow ? html`<div class="eyebrow">${eyebrow}</div>` : nothing}
          <div class="m-title">${title}</div>
          ${subtitle ? html`<div class="m-sub">${subtitle}</div>` : nothing}
        </div>
      </div>
      ${actions.length
        ? html`<div class="m-transport">
            ${actions.map(
              (a) => html`<button
                class="icon-btn ${a.primary ? "on primary" : ""} ${a.pending ? "pending" : ""}"
                ?disabled=${!a.enabled}
                aria-label=${a.label}
                title=${a.label}
                aria-busy=${a.pending ? "true" : "false"}
                @click=${a.run}
              >
                <ha-icon .icon=${a.icon}></ha-icon>
              </button>`,
            )}
          </div>`
        : nothing}
    </section>
  `;
}

/* ---------------- Volume knob ---------------- */

function renderKnob(ctx: TabContext, volume: HomeVolume | undefined): TemplateResult | typeof nothing {
  const local = ctx.local<MediaLocal>("home_media", () => ({}));
  // A gesture cut short by the bar (standby, player gone) ends here and sends nothing.
  if (local.drag && !volume?.slider.enabled) local.drag = undefined;
  if (!volume) return nothing;
  const { down, up, mute, slider } = volume;
  const range = slider.max - slider.min;
  const fraction = range > 0 ? Math.min(1, Math.max(0, (slider.value - slider.min) / range)) : 0;
  const sweep = ARC_SWEEP * fraction;
  const thumb = point(ARC_START + sweep);
  const clamp = (v: number): number => Math.min(slider.max, Math.max(slider.min, v));

  const finish = (): void => {
    const drag = local.drag;
    if (!drag) return;
    local.drag = undefined;
    if (slider.enabled) slider.commit(drag.value);
  };
  const onPointerDown = (ev: PointerEvent): void => {
    const el = ev.currentTarget as HTMLElement;
    if (!slider.enabled || ev.button > 0 || !onRing(ev, el)) return;
    const angle = angleAt(ev, el);
    if (angle === undefined) return;
    ev.preventDefault();
    el.focus({ preventScroll: true });
    el.setPointerCapture?.(ev.pointerId);
    const pos = startPos(angle);
    const value = valueOf(pos, slider.min, slider.max);
    local.drag = { pointerId: ev.pointerId, pos, value };
    slider.preview(value);
  };
  const onPointerMove = (ev: PointerEvent): void => {
    const drag = local.drag;
    if (!drag || drag.pointerId !== ev.pointerId || drag.pos === undefined) return;
    const angle = angleAt(ev, ev.currentTarget as Element);
    if (angle === undefined) return;
    drag.pos = nextPos(drag.pos, angle);
    const value = valueOf(drag.pos, slider.min, slider.max);
    if (value === drag.value) return;
    drag.value = value;
    slider.preview(value);
  };
  // pointerup, pointercancel and lostpointercapture (after pointerup it finds no drag left).
  const onPointerEnd = (ev: PointerEvent): void => {
    if (local.drag?.pointerId !== ev.pointerId) return;
    const el = ev.currentTarget as HTMLElement;
    if (el.hasPointerCapture?.(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
    finish();
  };
  const onKeyDown = (ev: KeyboardEvent): void => {
    if (!slider.enabled) return;
    const base = local.drag?.value ?? slider.value;
    const steps: Record<string, number> = {
      ArrowUp: base + slider.step,
      ArrowRight: base + slider.step,
      ArrowDown: base - slider.step,
      ArrowLeft: base - slider.step,
      PageUp: base + PAGE_STEP * slider.step,
      PageDown: base - PAGE_STEP * slider.step,
      Home: slider.min,
      End: slider.max,
    };
    if (!(ev.key in steps) || local.drag?.pointerId !== undefined) return;
    ev.preventDefault();
    const value = clamp(steps[ev.key]);
    local.drag = { value };
    slider.preview(value);
  };
  // Held keys preview on every repeat; the value is sent once, when the key is released.
  const onKeyUp = (): void => {
    if (local.drag && local.drag.pointerId === undefined) finish();
  };

  const valueText = [`${volume.shownText} / ${volume.max}`, volume.mutedText].filter(Boolean).join(", ");
  const ticks = Array.from({ length: 9 }, (_, i) => {
    const angle = ARC_START + (ARC_SWEEP * i) / 8;
    const a = point(angle, RADIUS + 13);
    const b = point(angle, RADIUS + 17);
    return svg`<line class="tick" x1=${a.x} y1=${a.y} x2=${b.x} y2=${b.y}></line>`;
  });

  return html`
    <section class="dial">
      <button class="icon-btn step" ?disabled=${!down.enabled} @click=${down.run} aria-label=${down.label} title=${down.label}>
        <ha-icon .icon=${down.icon}></ha-icon>
      </button>
      <div class="knob ${volume.muted ? "muted" : ""} ${slider.enabled ? "" : "off"}">
        <div
          class="ring"
          role="slider"
          tabindex=${slider.enabled ? 0 : -1}
          aria-label=${slider.label}
          aria-valuemin=${slider.min}
          aria-valuemax=${slider.max}
          aria-valuenow=${slider.value}
          aria-valuetext=${valueText}
          aria-disabled=${slider.enabled ? "false" : "true"}
          aria-busy=${volume.pending ? "true" : "false"}
          @pointerdown=${onPointerDown}
          @pointermove=${onPointerMove}
          @pointerup=${onPointerEnd}
          @pointercancel=${onPointerEnd}
          @lostpointercapture=${onPointerEnd}
          @keydown=${onKeyDown}
          @keyup=${onKeyUp}
          @blur=${finish}
        >
          <svg viewBox="0 0 ${VIEW} ${VIEW}" aria-hidden="true" focusable="false">
            ${ticks}
            <circle
              class="track"
              cx=${CENTER}
              cy=${CENTER}
              r=${RADIUS}
              pathLength="360"
              stroke-dasharray="${ARC_SWEEP} 360"
              transform="rotate(${ARC_START} ${CENTER} ${CENTER})"
            ></circle>
            ${sweep > 0
              ? svg`<circle
                  class="value ${volume.pending ? "pending" : ""}"
                  cx=${CENTER}
                  cy=${CENTER}
                  r=${RADIUS}
                  pathLength="360"
                  stroke-dasharray="${sweep} 360"
                  transform="rotate(${ARC_START} ${CENTER} ${CENTER})"
                ></circle>`
              : nothing}
            ${slider.enabled ? svg`<circle class="thumb" cx=${thumb.x} cy=${thumb.y} r="9"></circle>` : nothing}
          </svg>
        </div>
        <div class="readout">
          <div class="m-num ${volume.pending ? "pending" : ""}" aria-live=${local.drag ? "off" : "polite"}>
            ${volume.shownText}${volume.shown !== undefined ? html`<span class="m-max">/${volume.max}</span>` : nothing}
          </div>
          ${volume.mutedText
            ? html`<span class="badge warn">${volume.mutedText}</span>`
            : html`<span class="m-caption">${volume.title}</span>`}
        </div>
        <button
          class="icon-btn mute ${mute.on ? "on" : ""} ${mute.pending ? "pending" : ""}"
          ?disabled=${!mute.enabled}
          aria-label=${mute.label}
          title=${mute.label}
          aria-busy=${mute.pending ? "true" : "false"}
          @click=${mute.run}
        >
          <ha-icon .icon=${mute.icon}></ha-icon>
        </button>
      </div>
      <button class="icon-btn step" ?disabled=${!up.enabled} @click=${up.run} aria-label=${up.label} title=${up.label}>
        <ha-icon .icon=${up.icon}></ha-icon>
      </button>
    </section>
  `;
}

/* ---------------- Source ---------------- */

function renderSource(model: HomeModel): TemplateResult | typeof nothing {
  const source = model.source;
  if (!source || !source.options.length) return nothing;
  return html`
    <section class="src">
      <div class="seg" role="radiogroup" aria-label=${source.title}>
        ${source.options.map(
          (o) => html`
            <button
              role="radio"
              aria-checked=${String(o.active)}
              aria-busy=${o.pending ? "true" : "false"}
              class="${o.active ? "active" : ""} ${o.pending ? "pending" : ""}"
              ?disabled=${!o.enabled}
              @click=${o.select}
            >
              <ha-icon .icon=${sourceIcon(o.value)}></ha-icon><span>${o.label}</span>
            </button>
          `,
        )}
      </div>
    </section>
  `;
}

/* ---------------- Smart mode, Night ---------------- */

function chip(c: HomeToggle | HomeButton | undefined): TemplateResult | typeof nothing {
  if (!c) return nothing;
  if (c.kind === "button") {
    return html`<button
      class="chip ${c.pending ? "pending" : ""}"
      ?disabled=${!c.enabled}
      aria-busy=${c.pending ? "true" : "false"}
      @click=${c.run}
    >
      <ha-icon .icon=${c.icon}></ha-icon><span>${c.label}</span>
    </button>`;
  }
  return html`
    <button
      class="chip ${c.on ? "on" : ""} ${c.pending ? "pending" : ""}"
      role="switch"
      aria-checked=${String(c.on)}
      aria-busy=${c.pending ? "true" : "false"}
      ?disabled=${!c.enabled}
      @click=${c.run}
    >
      <ha-icon .icon=${c.icon}></ha-icon>
      <span>${c.label}</span>
      <span class="switch-knob" aria-hidden="true"></span>
    </button>
  `;
}

function renderModes(model: HomeModel): TemplateResult | typeof nothing {
  if (!model.modes) return nothing;
  return html`<div class="modes">${chip(model.modes.smart)}${chip(model.modes.night)}</div>`;
}

/* ---------------- Why controls are disabled ---------------- */

function renderReasons(model: HomeModel): TemplateResult | typeof nothing {
  const disabled: (HomeAction | { enabled: boolean; reason?: string } | undefined)[] = [
    model.source,
    model.volume?.down,
    model.volume?.up,
    model.volume?.mute,
    model.volume ? { enabled: model.volume.slider.enabled, reason: model.volume.reason } : undefined,
    model.modes?.smart,
    model.modes?.night,
    ...(model.playback?.actions ?? []),
  ];
  // The standby hint is already in the now playing panel.
  const shown = new Set([model.standby ? model.standbyHint : undefined]);
  const reasons: string[] = [];
  for (const item of disabled) {
    if (!item || item.enabled || !item.reason || shown.has(item.reason)) continue;
    shown.add(item.reason);
    reasons.push(item.reason);
  }
  if (!reasons.length) return nothing;
  return html`<div class="reasons">${reasons.map((r) => html`<div class="hint">${r}</div>`)}</div>`;
}

// Sections: status line, now playing, volume knob, source, Smart mode / Night, reasons.
// No comments inside the CSS: tests split the selectors with a plain regex.
export const mediaStyles = css`
  .home-media {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .home-media .status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 32px;
  }
  .home-media .batts {
    display: flex;
    flex: none;
    gap: 8px;
  }
  .home-media .m-batt {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    box-sizing: border-box;
    min-height: 32px;
    border: 0;
    border-radius: 999px;
    padding: 3px 10px 3px 7px;
    background: var(--jbl-surface);
    font-size: 0.8rem;
    line-height: 1.2;
    cursor: pointer;
    white-space: nowrap;
  }
  .home-media .m-batt:disabled {
    cursor: default;
  }
  .home-media .m-batt ha-icon {
    --mdc-icon-size: 16px;
    color: var(--jbl-muted);
  }
  .home-media .m-batt .side {
    color: var(--jbl-muted);
  }
  .home-media .m-batt .level {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .home-media .m-batt.low {
    background: rgba(255, 166, 0, 0.16);
    box-shadow: inset 0 0 0 1px var(--jbl-warning);
  }
  .home-media .m-batt.low ha-icon {
    color: var(--jbl-warning);
  }
  .home-media .m-batt.low .level {
    font-weight: 700;
  }
  .home-media .m-batt.low .alert {
    --mdc-icon-size: 14px;
    color: var(--jbl-text);
  }
  .home-media .dock {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    color: var(--jbl-muted);
  }
  .home-media .dock ha-icon {
    --mdc-icon-size: 20px;
  }
  .home-media .dock.docked {
    color: var(--jbl-accent-text);
    background: rgba(var(--jbl-accent-rgb), 0.14);
  }
  .home-media .hero {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: clamp(12px, 3.6cqi, 16px);
    border-radius: var(--jbl-radius);
    background: linear-gradient(140deg, rgba(var(--jbl-accent-rgb), 0.24), rgba(var(--jbl-accent-rgb), 0.05) 75%);
    border: 1px solid rgba(var(--jbl-accent-rgb), 0.28);
    min-width: 0;
  }
  .home-media .hero.m-standby {
    background: var(--jbl-surface);
    border-color: var(--jbl-border);
  }
  .home-media .hero-main {
    display: flex;
    align-items: center;
    gap: clamp(12px, 3.6cqi, 16px);
    min-width: 0;
  }
  .home-media .art {
    flex: none;
    width: clamp(64px, 19cqi, 84px);
    height: clamp(64px, 19cqi, 84px);
    border-radius: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--jbl-accent-fill);
    color: var(--jbl-on-accent);
    box-shadow: 0 8px 20px rgba(var(--jbl-accent-rgb), 0.35);
  }
  .home-media .art ha-icon {
    --mdc-icon-size: clamp(36px, 10.5cqi, 46px);
  }
  .home-media .hero.m-standby .art {
    background: var(--jbl-card-bg);
    color: var(--jbl-muted);
    box-shadow: none;
    border: 1px solid var(--jbl-border);
  }
  .home-media .meta {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .home-media .eyebrow {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--jbl-accent-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .home-media .hero.m-standby .eyebrow {
    color: var(--jbl-muted);
  }
  .home-media .m-title {
    font-size: 1.3rem;
    font-weight: 500;
    line-height: 1.25;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .home-media .hero.source .m-title {
    font-size: clamp(1.45rem, 6.4cqi, 1.8rem);
    font-weight: 400;
  }
  .home-media .m-sub {
    font-size: 0.88rem;
    color: var(--jbl-muted);
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  .home-media .hero.track .m-sub {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .home-media .m-transport {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }
  .home-media .m-transport .icon-btn {
    width: 44px;
    height: 44px;
    background: var(--jbl-card-bg);
  }
  .home-media .m-transport .icon-btn ha-icon {
    --mdc-icon-size: 24px;
  }
  .home-media .m-transport .icon-btn.primary {
    width: 58px;
    height: 58px;
    background: var(--jbl-accent-fill);
    border-color: var(--jbl-accent-fill);
    color: var(--jbl-on-accent);
    box-shadow: 0 6px 16px rgba(var(--jbl-accent-rgb), 0.35);
  }
  .home-media .m-transport .icon-btn.primary ha-icon {
    --mdc-icon-size: 32px;
  }

  .home-media .dial {
    display: grid;
    grid-template-columns: auto clamp(150px, 48cqi, 210px) auto;
    justify-content: center;
    align-items: center;
    gap: clamp(8px, 3cqi, 14px);
    margin-top: 4px;
  }
  .home-media .dial .step {
    width: clamp(40px, 10cqi, 46px);
    height: clamp(40px, 10cqi, 46px);
  }
  .home-media .dial .step ha-icon {
    --mdc-icon-size: 24px;
  }
  .home-media .knob {
    position: relative;
    width: 100%;
    height: auto;
    aspect-ratio: 1 / 1;
  }
  .home-media .ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    touch-action: none;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
  }
  .home-media .ring:focus-visible {
    outline: 2px solid var(--jbl-accent);
    outline-offset: 2px;
  }
  .home-media .knob.off .ring {
    cursor: default;
  }
  .home-media .ring svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .home-media .ring .track,
  .home-media .ring .value {
    fill: none;
    stroke-width: 14;
    stroke-linecap: round;
  }
  .home-media .ring .track {
    stroke: var(--jbl-surface);
  }
  .home-media .ring .value {
    stroke: var(--jbl-accent);
  }
  .home-media .knob.muted .ring .value {
    stroke: var(--jbl-muted);
  }
  .home-media .knob.off .ring .value {
    stroke: var(--jbl-disabled);
  }
  .home-media .ring .thumb {
    fill: var(--jbl-card-bg);
    stroke: var(--jbl-accent);
    stroke-width: 4;
  }
  .home-media .knob.muted .ring .thumb {
    stroke: var(--jbl-muted);
  }
  .home-media .ring .tick {
    stroke: var(--jbl-border);
    stroke-width: 2;
    stroke-linecap: round;
  }
  .home-media .readout {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    pointer-events: none;
    padding-bottom: 8%;
  }
  .home-media .m-num {
    font-size: clamp(2.6rem, 12cqi, 3.4rem);
    font-weight: 300;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }
  .home-media .knob.muted .m-num {
    color: var(--jbl-muted);
  }
  .home-media .knob.off .m-num {
    color: var(--jbl-muted);
  }
  .home-media .m-max {
    font-size: 0.95rem;
    color: var(--jbl-muted);
    margin-left: 2px;
    letter-spacing: 0;
  }
  .home-media .m-caption {
    font-size: 0.72rem;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--jbl-muted);
  }
  .home-media .mute {
    position: absolute;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    width: 42px;
    height: 42px;
  }
  .home-media .src .seg button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    font-size: 0.85rem;
    padding: 6px 4px;
  }
  .home-media .src .seg ha-icon {
    --mdc-icon-size: 16px;
    flex: none;
  }
  .home-media .modes {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }
  .home-media .modes .chip {
    min-height: 32px;
    font-size: 0.8rem;
    padding: 4px 10px;
    gap: 5px;
  }
  .home-media .modes .chip.on ha-icon {
    color: var(--jbl-accent-text);
  }
  .home-media .modes .chip ha-icon {
    --mdc-icon-size: 16px;
  }
  .home-media .modes .switch-knob {
    width: 22px;
    height: 12px;
  }
  .home-media .modes .switch-knob::after {
    width: 8px;
    height: 8px;
  }
  .home-media .modes .on > .switch-knob::after,
  .home-media .modes [aria-checked="true"] > .switch-knob::after {
    transform: translateX(10px);
  }

  .home-media .reasons {
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-align: center;
  }
`;
