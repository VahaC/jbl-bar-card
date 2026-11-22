import { css, html, nothing, svg } from "lit";
import type { TemplateResult } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";
import type { TabContext } from "../../types";
import { snapToStep } from "../sound-model";
import type {
  SoundAction,
  SoundBadge,
  SoundBand,
  SoundBassOffset,
  SoundEq,
  SoundLevel,
  SoundModel,
  SoundPreset,
  SoundStepper,
} from "../sound-model";

/**
 * "cards" layout of the Sound tab: a grid of compact cards (one value each, big, with - / +)
 * and a wide Front EQ card with a draggable curve. Renders the model only (docs/layouts-sound.md);
 * strings are "sound_cards.<key>", every selector starts with .sound-cards.
 */
export function renderSoundCards(ctx: TabContext, model: SoundModel): TemplateResult {
  if (model.empty) return html`<div class="sound-cards hint">${model.emptyText}</div>`;
  return html`
    <div class="sound-cards">
      <div class="sound-cards-grid">
        ${model.levels.map((level) => renderLevel(ctx, level))}
        ${model.audioSync ? renderStepperTile(ctx, model.audioSync, "sync") : nothing}
        ${model.bassOffset ? renderStepperTile(ctx, model.bassOffset, "offset") : nothing}
        ${model.eq ? renderEq(ctx, model.eq) : nothing}
      </div>
    </div>
  `;
}

const badgeClass = (badge: SoundBadge): string => (badge.tone === "neutral" ? "" : badge.tone);

/**
 * The tile's explanation lines (why it is disabled, hints, errors). Rendered above the buttons so
 * the buttons stay on the bottom edge of every tile in a grid row.
 */
function notes(lines: (TemplateResult | typeof nothing)[]): TemplateResult | typeof nothing {
  return lines.some((line) => line !== nothing) ? html`<div class="sound-cards-msg">${lines}</div>` : nothing;
}

function spinner(ctx: TabContext, pending: boolean): TemplateResult | typeof nothing {
  return pending
    ? html`<span class="spinner sound-cards-spinner" role="img" aria-label=${ctx.t("sound_cards.sending")}></span>`
    : nothing;
}

/** A round - / + / < / > button. `locked`: still focusable, but announced as disabled (audio sync). */
function stepButton(
  label: string,
  icon: string,
  cls: string,
  enabled: boolean,
  run: () => void,
  locked?: boolean,
): TemplateResult {
  return html`
    <button
      class="sound-cards-btn ${cls}"
      ?disabled=${!enabled}
      aria-disabled=${ifDefined(locked === undefined ? undefined : locked ? "true" : "false")}
      aria-label=${label}
      title=${label}
      @click=${run}
    >
      <ha-icon .icon=${icon}></ha-icon>
    </button>
  `;
}

/* ---------------- Level cards (bass, center, atmos, rear) ---------------- */

/** Atmos and rear have named options: their buttons cycle; bass and center step and stop at the ends. */
const CYCLES = new Set(["atmos", "rear"]);

function renderLevel(ctx: TabContext, level: SoundLevel): TemplateResult {
  const { options, shownIndex } = level;
  const count = options.length;
  const cycles = CYCLES.has(level.role);
  const known = shownIndex >= 0;
  const shown = known ? options[shownIndex] : undefined;
  const unknown = ctx.t("common.unknown");

  let prevIndex: number;
  let nextIndex: number;
  if (cycles) {
    prevIndex = known ? (shownIndex - 1 + count) % count : count - 1;
    nextIndex = known ? (shownIndex + 1) % count : 0;
  } else {
    prevIndex = known ? shownIndex - 1 : -1;
    nextIndex = known && shownIndex < count - 1 ? shownIndex + 1 : -1;
  }
  const canPrev = level.enabled && count > 1 && prevIndex >= 0;
  const canNext = level.enabled && count > 1 && nextIndex >= 0;
  const titleId = `sound-cards-${level.role}-title`;

  let value: TemplateResult;
  let sub: TemplateResult | typeof nothing = nothing;
  if (level.role === "bass") {
    value = html`${shown?.label ?? unknown}${known ? html`<span class="sound-cards-unit">/${count}</span>` : nothing}`;
  } else if (level.role === "center") {
    value = html`${level.extra ?? unknown}`;
    if (known) sub = html`<div class="sound-cards-sub">${ctx.t("sound_cards.level_of", { value: shownIndex + 1, total: count })}</div>`;
  } else {
    value = html`${shown?.label ?? unknown}`;
  }

  const prevLabel = ctx.t(cycles ? "sound_cards.previous" : "sound_cards.less", { name: level.label });
  const nextLabel = ctx.t(cycles ? "sound_cards.next" : "sound_cards.more", { name: level.label });
  return html`
    <section
      class="sound-cards-tile sound-cards-level sound-cards-${level.role} ${level.enabled ? "" : "blocked"}"
      role="group"
      aria-labelledby=${titleId}
      data-role=${level.role}
    >
      <div class="sound-cards-head">
        <span class="sound-cards-title" id=${titleId} title=${level.label}>${level.label}</span>
        ${spinner(ctx, level.pending)}
      </div>
      <div class="sound-cards-value ${level.pending ? "pending" : ""}" aria-live="polite">${value}</div>
      ${sub} ${notes([level.reason ? html`<div class="hint sound-cards-reason">${level.reason}</div>` : nothing])}
      <div class="sound-cards-controls">
        ${stepButton(prevLabel, cycles ? "mdi:chevron-left" : "mdi:minus", "sound-cards-prev", canPrev, () =>
          level.choose(options[prevIndex].value),
        )}
        <span class="sound-cards-pips ${cycles ? "dots" : "bars"}" aria-hidden="true">
          ${options.map(
            (option, i) =>
              html`<span
                class="sound-cards-pip ${i <= shownIndex && !cycles ? "on" : ""} ${i === shownIndex ? "shown" : ""} ${option.active
                  ? "active"
                  : ""} ${option.pending ? "pending" : ""}"
                style=${cycles ? "" : `height: ${34 + Math.round((i / Math.max(1, count - 1)) * 66)}%`}
              ></span>`,
          )}
        </span>
        ${stepButton(nextLabel, cycles ? "mdi:chevron-right" : "mdi:plus", "sound-cards-next", canNext, () =>
          level.choose(options[nextIndex].value),
        )}
      </div>
    </section>
  `;
}

/* ---------------- Stepper cards (audio sync, bass offset) ---------------- */

function isBassOffset(stepper: SoundStepper): stepper is SoundBassOffset {
  return "status" in stepper || "error" in stepper;
}

/** A thin meter of the value inside its range: bipolar ranges fill from zero. */
function meter(stepper: SoundStepper): TemplateResult {
  const { min, max, value } = stepper;
  const span = max - min || 1;
  const frac = (v: number): number => Math.min(1, Math.max(0, (v - min) / span));
  const origin = min < 0 && max > 0 ? frac(0) : 0;
  const at = value === undefined ? origin : frac(value);
  const from = Math.min(origin, at);
  const width = Math.abs(at - origin);
  return html`
    <span class="sound-cards-meter ${value === undefined ? "unknown" : ""}" aria-hidden="true">
      ${origin > 0 ? html`<span class="sound-cards-meter-zero" style="left: ${origin * 100}%"></span>` : nothing}
      <span class="sound-cards-meter-fill" style="left: ${from * 100}%; width: ${width * 100}%"></span>
      ${value !== undefined ? html`<span class="sound-cards-meter-dot" style="left: ${at * 100}%"></span>` : nothing}
    </span>
  `;
}

function renderStepperTile(ctx: TabContext, stepper: SoundStepper, name: "sync" | "offset"): TemplateResult {
  const offset = isBassOffset(stepper) ? stepper : undefined;
  const titleId = `sound-cards-${name}-title`;
  const action = (a: SoundAction, cls: string): TemplateResult =>
    stepButton(a.label, a.icon, cls, a.enabled, () => a.run(), stepper.locked);
  // Why the control is disabled, else the model's hint (audio sync re-syncing).
  const reason = stepper.reason ?? stepper.hint;
  return html`
    <section
      class="sound-cards-tile sound-cards-${name} ${stepper.locked ? "locked" : ""}"
      role="group"
      aria-labelledby=${titleId}
    >
      <div class="sound-cards-head">
        <span class="sound-cards-title" id=${titleId} title=${stepper.label}>${stepper.label}</span>
        ${spinner(ctx, stepper.pending)}
        ${offset?.status
          ? html`<span class="badge sound-cards-badge ${badgeClass(offset.status)}">${offset.status.label}</span>`
          : nothing}
      </div>
      <div class="sound-cards-value ${stepper.pending ? "pending" : ""}" aria-live="polite">${stepper.valueText}</div>
      ${notes([
        reason ? html`<div class="hint sound-cards-reason">${reason}</div>` : nothing,
        offset?.error ? html`<div class="hint warn-text sound-cards-error">${offset.error}</div>` : nothing,
      ])}
      <div class="sound-cards-controls">
        ${action(stepper.less, "sound-cards-less")} ${meter(stepper)} ${action(stepper.more, "sound-cards-more")}
      </div>
    </section>
  `;
}

/* ---------------- Front EQ card ---------------- */

function renderEq(ctx: TabContext, eq: SoundEq): TemplateResult {
  return html`
    <section class="sound-cards-tile sound-cards-eq" role="group" aria-labelledby="sound-cards-eq-title">
      <div class="sound-cards-head">
        <span class="sound-cards-title" id="sound-cards-eq-title" title=${eq.title}>${eq.title}</span>
        ${spinner(ctx, eq.pending)}
        ${eq.status
          ? html`<span class="badge sound-cards-badge sound-cards-eq-status ${badgeClass(eq.status)}" aria-live="polite"
              >${eq.status.label}</span
            >`
          : nothing}
      </div>
      ${eq.reason ? html`<div class="hint sound-cards-reason sound-cards-eq-reason">${eq.reason}</div>` : nothing}
      ${eq.preset ? renderPreset(eq.preset, eq.bandsReason) : nothing} ${eq.bands.length ? renderCurve(ctx, eq) : nothing}
    </section>
  `;
}

/** `bandsReason`: already written under the graph, so not repeated for the preset. */
function renderPreset(preset: SoundPreset, bandsReason: string | undefined): TemplateResult {
  const selectId = "sound-cards-preset";
  const onChange = (ev: Event): void => {
    const select = ev.target as HTMLSelectElement;
    if (!preset.select(select.value)) select.value = preset.shown ?? "";
  };
  return html`
    <div class="sound-cards-preset-row">
      <label class="sound-cards-preset-label" for=${selectId}>${preset.label}</label>
      <select
        id=${selectId}
        class="select sound-cards-preset ${preset.pending ? "pending" : ""}"
        ?disabled=${!preset.enabled}
        aria-busy=${preset.busy ? "true" : "false"}
        title=${ifDefined(preset.busy ? preset.busyReason : undefined)}
        .value=${live(preset.shown ?? "")}
        @change=${onChange}
      >
        ${preset.placeholder !== undefined ? html`<option value="" disabled selected>${preset.placeholder}</option>` : nothing}
        ${preset.options.map((option) => html`<option value=${option.value} ?selected=${option.selected}>${option.label}</option>`)}
      </select>
      ${preset.reset
        ? html`<button
            class="btn small primary sound-cards-reset"
            ?disabled=${!preset.reset.enabled}
            @click=${() => preset.reset!.run()}
          >
            <ha-icon .icon=${preset.reset.icon}></ha-icon>${preset.reset.label}
          </button>`
        : nothing}
    </div>
    ${preset.reason && preset.reason !== bandsReason
      ? html`<div class="hint sound-cards-reason sound-cards-preset-reason">${preset.reason}</div>`
      : nothing}
  `;
}

interface Point {
  x: number;
  y: number;
}

/**
 * A smooth path through the points in a 0..100 box, flat out to both edges. Monotone cubic
 * (Fritsch-Carlson): the curve never swings above or below its points, so 0 dB stays the ceiling.
 */
function smoothPath(points: Point[]): string {
  const p = [{ x: 0, y: points[0].y }, ...points, { x: 100, y: points[points.length - 1].y }];
  const n = p.length;
  const d = p.slice(0, -1).map((a, i) => (p[i + 1].y - a.y) / (p[i + 1].x - a.x || 1));
  const m = p.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  const f = (v: number): string => String(Math.round(v * 100) / 100);
  let path = `M ${f(p[0].x)} ${f(p[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (p[i + 1].x - p[i].x) / 3;
    path += ` C ${f(p[i].x + h)} ${f(p[i].y + m[i] * h)} ${f(p[i + 1].x - h)} ${f(p[i + 1].y - m[i + 1] * h)} ${f(p[i + 1].x)} ${f(p[i + 1].y)}`;
  }
  return path;
}

function renderCurve(ctx: TabContext, eq: SoundEq): TemplateResult {
  const { bands } = eq;
  const n = bands.length;
  const hi = Math.max(...bands.map((b) => b.max));
  const lo = Math.min(...bands.map((b) => b.min));
  const span = hi - lo || 1;
  const fracOf = (v: number): number => Math.min(1, Math.max(0, (hi - v) / span));
  const points = bands.map((band, i) => ({ x: ((i + 0.5) / n) * 100, y: fracOf(band.position) * 100 }));
  const line = smoothPath(points);

  // Grid every 1 dB (or a sixth of the range for wide ranges); labels every 3 dB.
  const gridStep = span <= 12 ? 1 : span / 6;
  const grid: number[] = [];
  for (let v = hi; v >= lo - 1e-9; v -= gridStep) grid.push(Math.round(v * 100) / 100);
  const labelled = (v: number): boolean => v === hi || v === lo || Math.abs(v % 3) < 1e-9;

  /*
   * Pointer drags start only on a knob (its 44 px hit area), never on the rest of the graph: a
   * swipe over the graph scrolls the page and a tap beside a point changes nothing. The value moves
   * with the pointer relative to where the drag started, so grabbing a point never makes it jump.
   * The drag state lives on the knob element (several cards per dashboard, no module state).
   */
  const valueFrom = (drag: KnobDrag, clientY: number, band: SoundBand): number =>
    snapToStep(drag.startValue - ((clientY - drag.startY) / drag.height) * span, band.min, band.max, band.step);
  const takeDrag = (ev: PointerEvent): KnobDrag | undefined => {
    const knob = ev.currentTarget as DragKnob;
    const drag = knob.soundCardsDrag;
    if (!drag || drag.pointerId !== ev.pointerId) return undefined;
    knob.soundCardsDrag = undefined;
    return drag;
  };
  const onDown = (band: SoundBand) => (ev: PointerEvent) => {
    const knob = ev.currentTarget as DragKnob;
    // An unknown value has nothing to drag from (and no preview could be dropped): keys only.
    if (!band.enabled || band.value === undefined || ev.button > 0 || knob.soundCardsDrag) return;
    const height = knob.closest(".sound-cards-area")?.getBoundingClientRect().height ?? 0;
    if (height <= 0) return;
    ev.preventDefault();
    try {
      knob.setPointerCapture?.(ev.pointerId);
    } catch {
      // The pointer is already gone: the move and up handlers still work while it is over the knob.
    }
    knob.focus({ preventScroll: true });
    knob.soundCardsDrag = { pointerId: ev.pointerId, startY: ev.clientY, startValue: band.value, height };
  };
  const onMove = (band: SoundBand) => (ev: PointerEvent) => {
    const drag = (ev.currentTarget as DragKnob).soundCardsDrag;
    if (!drag || drag.pointerId !== ev.pointerId) return;
    if (!band.enabled) {
      if (takeDrag(ev)) band.cancel();
      return;
    }
    const value = valueFrom(drag, ev.clientY, band);
    if (value === (drag.last ?? drag.startValue)) return;
    drag.last = value;
    band.preview(value);
  };
  const onUp = (band: SoundBand) => (ev: PointerEvent) => {
    const drag = takeDrag(ev);
    if (!drag) return;
    try {
      (ev.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
    } catch {
      // Already released.
    }
    if (drag.last === undefined) return; // a tap: nothing changed, nothing to send
    if (!band.enabled) band.cancel();
    else band.commit(valueFrom(drag, ev.clientY, band));
  };
  /** pointercancel, or capture lost without a pointerup: drop the preview, send nothing. */
  const onCancel = (band: SoundBand) => (ev: PointerEvent) => {
    if (takeDrag(ev)) band.cancel();
  };
  const onKey = (band: SoundBand) => (ev: KeyboardEvent) => {
    if (!band.enabled) return;
    const base = band.value ?? band.position;
    const big = band.step * 2;
    const next: Record<string, number> = {
      ArrowUp: base + band.step,
      ArrowRight: base + band.step,
      ArrowDown: base - band.step,
      ArrowLeft: base - band.step,
      PageUp: base + big,
      PageDown: base - big,
      Home: band.max,
      End: band.min,
    };
    if (!(ev.key in next)) return;
    ev.preventDefault();
    const value = snapToStep(next[ev.key], band.min, band.max, band.step);
    // The model debounces commits: quick or held key presses send only the last value.
    if (value !== base) band.commit(value);
  };

  return html`
    <div class="sound-cards-plot">
      <div class="sound-cards-area">
        <svg class="sound-cards-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          ${grid.map(
            (v) =>
              svg`<line class="sound-cards-grid-line ${v === 0 ? "zero" : labelled(v) ? "major" : ""}" x1="0" x2="100"
                y1=${fracOf(v) * 100} y2=${fracOf(v) * 100} vector-effect="non-scaling-stroke"></line>`,
          )}
          ${points.map(
            (p) =>
              svg`<line class="sound-cards-grid-col" x1=${p.x} x2=${p.x} y1="0" y2="100" vector-effect="non-scaling-stroke"></line>`,
          )}
          <path class="sound-cards-fill" d="${line} L 100 100 L 0 100 Z"></path>
          <path class="sound-cards-line" d=${line} vector-effect="non-scaling-stroke"></path>
        </svg>
        ${grid.filter(labelled).map(
          (v) =>
            html`<span class="sound-cards-db" style="top: ${fracOf(v) * 100}%" aria-hidden="true"
              >${ctx.formatNumber(v, { maximumFractionDigits: 1 })}</span
            >`,
        )}
        ${bands.map((band, i) => renderPoint(band, i, n, fracOf(band.position), onDown, onMove, onUp, onCancel, onKey))}
      </div>
    </div>
    <div class="sound-cards-freqs" style="grid-template-columns: repeat(${n}, minmax(0, 1fr))" aria-hidden="true">
      ${bands.map((band) => html`<span class="sound-cards-freq">${band.label}</span>`)}
    </div>
    ${eq.bandsReason
      ? html`<div class="hint sound-cards-reason sound-cards-bands-reason">${eq.bandsReason}</div>`
      : bands.some((band) => band.enabled)
        ? html`<div class="hint sound-cards-eq-hint">${ctx.t("sound_cards.eq_hint")}</div>`
        : nothing}
  `;
}

/** A pointer drag of one EQ point, kept on its knob element between renders. */
interface KnobDrag {
  pointerId: number;
  startY: number;
  /** The band's value when the drag started. */
  startValue: number;
  /** Height of the plot area in px (the full dB range). */
  height: number;
  /** The last previewed value; undefined until the pointer moved the value. */
  last?: number;
}

type DragKnob = HTMLElement & { soundCardsDrag?: KnobDrag };

type Handler<E extends Event> = (band: SoundBand) => (ev: E) => void;

function renderPoint(
  band: SoundBand,
  i: number,
  n: number,
  frac: number,
  onDown: Handler<PointerEvent>,
  onMove: Handler<PointerEvent>,
  onUp: Handler<PointerEvent>,
  onCancel: Handler<PointerEvent>,
  onKey: Handler<KeyboardEvent>,
): TemplateResult {
  const state = [
    band.enabled ? "" : "disabled",
    band.pending ? "pending" : "",
    band.dragging ? "dragging" : "",
    band.value === undefined ? "unknown" : "",
  ].join(" ");
  return html`
    <div
      class="sound-cards-col ${state}"
      data-band=${band.index}
      style="left: ${(i / n) * 100}%; width: ${100 / n}%"
    >
      <span class="sound-cards-tag" style="top: ${frac * 100}%" aria-hidden="true">${band.shortText}</span>
      <span
        class="sound-cards-knob"
        style="top: ${frac * 100}%"
        role="slider"
        tabindex=${band.enabled ? "0" : "-1"}
        aria-orientation="vertical"
        aria-label=${band.ariaLabel}
        aria-valuemin=${band.min}
        aria-valuemax=${band.max}
        aria-valuenow=${ifDefined(band.value)}
        aria-valuetext=${band.valueText}
        aria-disabled=${band.enabled ? "false" : "true"}
        @keydown=${onKey(band)}
        @pointerdown=${onDown(band)}
        @pointermove=${onMove(band)}
        @pointerup=${onUp(band)}
        @pointercancel=${onCancel(band)}
        @lostpointercapture=${onCancel(band)}
      ></span>
    </div>
  `;
}

export const soundCardsStyles = css`
  .sound-cards-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  /*
   * One column on narrow cards: value on the left, the two buttons on the right with the option
   * pips (or the range meter) under them, so the tiles stay short and the value keeps its width.
   */
  @container (max-width: 340px) {
    .sound-cards-grid {
      grid-template-columns: minmax(0, 1fr);
      gap: 8px;
    }
    .sound-cards-tile:not(.sound-cards-eq) {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      column-gap: 6px;
      row-gap: 4px;
      align-items: center;
    }
    .sound-cards-tile:not(.sound-cards-eq) > * {
      grid-column: 1 / -1;
    }
    .sound-cards-tile:not(.sound-cards-eq) > .sound-cards-head {
      grid-row: 1;
    }
    /* The explanation goes under the buttons here: full width, below the pips. */
    .sound-cards-tile:not(.sound-cards-eq) > .sound-cards-msg {
      grid-row: 4;
    }
    .sound-cards-tile:not(.sound-cards-eq) > .sound-cards-value {
      grid-column: 1;
      grid-row: 2;
    }
    .sound-cards-tile:not(.sound-cards-eq) > .sound-cards-sub {
      grid-column: 1;
      grid-row: 3;
      margin-top: 0;
    }
    .sound-cards-tile:not(.sound-cards-eq) > .sound-cards-controls {
      display: contents;
    }
    .sound-cards-prev,
    .sound-cards-less {
      grid-column: 2;
      grid-row: 2;
    }
    .sound-cards-next,
    .sound-cards-more {
      grid-column: 3;
      grid-row: 2;
    }
    .sound-cards-pips,
    .sound-cards-meter {
      grid-column: 2 / 4;
      grid-row: 3;
      align-self: center;
    }
    .sound-cards-pips {
      height: 14px;
      gap: 3px;
    }
    .sound-cards-meter {
      margin: 0 4px;
    }
    .sound-cards-value {
      font-size: 1.4rem;
    }
  }
  .sound-cards-tile {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    padding: 10px 12px 12px;
    border-radius: var(--jbl-radius-sm);
    background: var(--jbl-surface);
    border: 1px solid var(--jbl-border);
    box-sizing: border-box;
  }
  .sound-cards-eq {
    grid-column: 1 / -1;
    gap: 8px;
  }
  .sound-cards-head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 20px;
    flex-wrap: nowrap;
  }
  /* A long title ellipsizes (full text in its title attribute); the badge stays on the line. */
  .sound-cards-title {
    flex: 1 1 0;
    min-width: 0;
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--jbl-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sound-cards-badge {
    flex: none;
  }
  .sound-cards-value {
    font-size: 1.6rem;
    line-height: 1.15;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sound-cards-unit {
    font-size: 0.95rem;
    font-weight: 400;
    color: var(--jbl-muted);
    margin-inline-start: 1px;
  }
  .sound-cards-sub {
    font-size: 0.8rem;
    color: var(--jbl-muted);
    margin-top: -4px;
  }
  .sound-cards-tile.blocked .sound-cards-value {
    color: var(--jbl-muted);
  }
  .sound-cards-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: auto;
    padding-top: 2px;
  }
  .sound-cards-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 40px;
    height: 40px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--jbl-border);
    background: var(--jbl-card-bg);
    cursor: pointer;
  }
  .sound-cards-btn:hover:not(:disabled):not([aria-disabled="true"]) {
    border-color: var(--jbl-accent);
    background: rgba(var(--jbl-accent-rgb), 0.12);
  }
  .sound-cards-btn:disabled,
  .sound-cards-btn[aria-disabled="true"] {
    cursor: default;
    opacity: 0.4;
  }
  .sound-cards-msg {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .sound-cards-reason,
  .sound-cards-error {
    font-size: 0.8rem;
  }

  /* Option pips between the buttons: rising bars for bass/center, dots for atmos/rear. */
  .sound-cards-pips {
    flex: 1 1 auto;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 4px;
    height: 18px;
    min-width: 0;
  }
  .sound-cards-pips.dots {
    align-items: center;
    gap: 6px;
  }
  .sound-cards-pip {
    flex: 0 1 8px;
    min-width: 3px;
    border-radius: 2px;
    background: rgba(127, 127, 127, 0.3);
  }
  .sound-cards-pips.dots .sound-cards-pip {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .sound-cards-pip.on,
  .sound-cards-pip.shown {
    background: var(--jbl-accent);
  }
  /* The option the bar confirms, while another one is pending (stepping down, or cycling). */
  .sound-cards-pip.active:not(.shown):not(.on) {
    background: rgba(var(--jbl-accent-rgb), 0.45);
  }
  .sound-cards-pip.pending {
    background: transparent;
    box-shadow: inset 0 0 0 2px var(--jbl-accent);
    animation: jbl-pulse 1.1s ease-in-out infinite;
  }
  .sound-cards-tile.blocked .sound-cards-pip.on {
    background: var(--jbl-disabled);
  }
  /* Greyed out, but the current option stays visible. */
  .sound-cards-tile.blocked .sound-cards-pip.shown {
    background: var(--jbl-muted);
  }
  .sound-cards-tile.blocked .sound-cards-pips.dots .sound-cards-pip.shown {
    width: 10px;
    height: 10px;
  }

  /* Range meter of the steppers. */
  .sound-cards-meter {
    position: relative;
    flex: 1 1 auto;
    height: 4px;
    border-radius: 2px;
    background: rgba(127, 127, 127, 0.3);
    min-width: 24px;
  }
  .sound-cards-meter-fill {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 2px;
    background: var(--jbl-accent);
  }
  .sound-cards-meter-zero {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 2px;
    margin-left: -1px;
    background: var(--jbl-muted);
  }
  .sound-cards-meter-dot {
    position: absolute;
    top: 50%;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--jbl-accent);
    transform: translate(-50%, -50%);
  }
  .sound-cards-tile.locked .sound-cards-meter-dot {
    animation: jbl-pulse 1.1s ease-in-out infinite;
  }

  /* Front EQ */
  .sound-cards-preset-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .sound-cards-preset-label {
    font-size: 0.85rem;
    color: var(--jbl-muted);
  }
  .sound-cards-preset {
    flex: 1 1 140px;
  }
  .sound-cards-reset ha-icon {
    --mdc-icon-size: 16px;
  }
  .sound-cards-plot {
    position: relative;
    height: 168px;
    margin-top: 2px;
    border-radius: 6px;
    background: var(--jbl-card-bg);
    border: 1px solid var(--jbl-border);
  }
  .sound-cards-area {
    position: absolute;
    top: 30px;
    bottom: 12px;
    left: 30px;
    right: 8px;
  }
  .sound-cards-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .sound-cards-grid-line {
    stroke: var(--jbl-border);
    stroke-width: 1;
  }
  .sound-cards-grid-line.major {
    stroke: rgba(127, 127, 127, 0.4);
  }
  .sound-cards-grid-line.zero {
    stroke: var(--jbl-muted);
    stroke-dasharray: 3 3;
  }
  .sound-cards-grid-col {
    stroke: var(--jbl-border);
    stroke-width: 1;
    stroke-dasharray: 2 4;
  }
  .sound-cards-fill {
    fill: var(--jbl-accent);
    fill-opacity: 0.16;
    stroke: none;
  }
  .sound-cards-line {
    fill: none;
    stroke: var(--jbl-accent);
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .sound-cards-db {
    position: absolute;
    right: calc(100% + 6px);
    transform: translateY(-50%);
    font-size: 0.7rem;
    color: var(--jbl-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  /*
   * Columns only place the points: they take no pointer input, so a swipe over the graph scrolls
   * the page. Only the knob (with its 44 px hit area) captures touch.
   */
  .sound-cards-col {
    position: absolute;
    top: 0;
    bottom: 0;
    pointer-events: none;
  }
  .sound-cards-tag,
  .sound-cards-knob {
    position: absolute;
    left: 50%;
  }
  .sound-cards-tag {
    transform: translate(-50%, calc(-100% - 12px));
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    background: var(--jbl-card-bg);
    box-shadow: inset 0 0 0 1px var(--jbl-border);
    color: var(--jbl-text);
    pointer-events: none;
  }
  .sound-cards-col.dragging .sound-cards-tag {
    background: var(--jbl-accent-fill);
    color: var(--jbl-on-accent);
  }
  .sound-cards-knob {
    width: 18px;
    height: 18px;
    box-sizing: border-box;
    border-radius: 50%;
    background: var(--jbl-accent-fill);
    border: 3px solid var(--jbl-card-bg);
    box-shadow: 0 0 0 1px var(--jbl-accent), 0 1px 3px rgba(0, 0, 0, 0.35);
    transform: translate(-50%, -50%);
    transition: width 100ms ease, height 100ms ease;
    outline: none;
    pointer-events: auto;
    touch-action: none;
    cursor: ns-resize;
  }
  /* A 44 x 44 px transparent hit area around the point. */
  .sound-cards-knob::before {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 44px;
    height: 44px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    touch-action: none;
  }
  .sound-cards-col:not(.disabled) .sound-cards-knob:hover,
  .sound-cards-col.dragging .sound-cards-knob {
    width: 22px;
    height: 22px;
  }
  .sound-cards-col.pending .sound-cards-knob {
    animation: jbl-pulse 1.1s ease-in-out infinite;
  }
  .sound-cards-col.disabled .sound-cards-knob,
  .sound-cards-col.unknown .sound-cards-knob {
    background: var(--jbl-disabled);
    box-shadow: 0 0 0 1px var(--jbl-border);
  }
  .sound-cards-col.disabled .sound-cards-knob {
    cursor: default;
  }
  /* After the disabled/unknown rules, so an enabled point with an unknown value keeps its ring. */
  .sound-cards-col .sound-cards-knob:focus-visible {
    box-shadow: 0 0 0 1px var(--jbl-accent), 0 0 0 4px rgba(var(--jbl-accent-rgb), 0.45);
  }
  .sound-cards-freqs {
    display: grid;
    margin: -2px 8px 0 30px;
  }
  .sound-cards-freq {
    text-align: center;
    font-size: 0.72rem;
    color: var(--jbl-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sound-cards-eq-hint {
    font-size: 0.75rem;
  }
`;
