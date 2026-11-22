import { css, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";
import type { TabContext } from "../../types";
import type {
  SoundAction,
  SoundBadge,
  SoundBand,
  SoundBassOffset,
  SoundEq,
  SoundLevel,
  SoundLevelOption,
  SoundModel,
  SoundPreset,
  SoundStepper,
} from "../sound-model";

/**
 * "mixer" layout of the Sound tab: a studio mixing console. One horizontal row of vertical
 * faders in the same visual language: the levels (bass, center, atmos, rear), a divider, then the
 * Front EQ bands and the bass offset, with the EQ status and preset above the EQ group. Audio sync
 * is a compact stepper under the console, and every reason why a fader cannot move is written out
 * under it.
 *
 * The whole console fits a normal full-width card (about 400 px) and stretches to fill wider
 * ones. Only on narrower cards does it switch to wider strips and scroll sideways (container query), with the EQ title, preset and dB
 * scale pinned while the bands scroll under them, and an edge fade on the side with hidden faders.
 *
 * Renders the model only (docs/layouts-sound.md). Dragging only previews: every fader calls the
 * model's `preview` on `input` and `commit` on `change` (release, or each keyboard step), so only
 * the released value is sent. Audio sync goes through `less` / `more`.
 */
export function renderSoundMixer(ctx: TabContext, model: SoundModel): TemplateResult {
  if (model.empty) return html`<div class="sound-mixer hint">${model.emptyText}</div>`;

  const notes = collectNotes(model);
  const levelFaders = model.levels.map((level) => levelFader(ctx, level, notes));
  const hasEqGroup = model.eq !== undefined || model.bassOffset !== undefined;

  return html`
    <div class="sound-mixer">
      ${levelFaders.length || hasEqGroup
        ? html`
            <div class="sound-mixer-console" role="group" aria-label=${ctx.t("sound_mixer.console")} @scroll=${onConsoleScroll}>
              <div class="sound-mixer-desk">
                ${levelFaders.length
                  ? html`
                      <div class="sound-mixer-group sound-mixer-levels" role="group" aria-label=${ctx.t("sound_mixer.levels")}>
                        <div class="sound-mixer-head">
                          <div class="section-title"><span>${ctx.t("sound_mixer.levels")}</span></div>
                        </div>
                        <div class="sound-mixer-strips">${levelFaders.map(renderFader)}</div>
                      </div>
                    `
                  : nothing}
                ${levelFaders.length && hasEqGroup ? html`<span class="sound-mixer-divider" aria-hidden="true"></span>` : nothing}
                ${hasEqGroup ? renderEqGroup(ctx, model.eq, model.bassOffset, notes) : nothing}
              </div>
            </div>
          `
        : nothing}
      ${renderNotes(notes)} ${model.audioSync ? renderAudioSync(model.audioSync) : nothing}
    </div>
  `;
}

/**
 * Marks which side of the scrolled console hides faders (data-scroll = start | mid | end | none),
 * and whether the EQ group's start has scrolled past the left edge (data-eq-stuck: its title and
 * scale are pinned). CSS draws the edge fade from these; the DOM is the only state.
 */
function onConsoleScroll(ev: Event): void {
  const el = ev.currentTarget as HTMLElement;
  const max = el.scrollWidth - el.clientWidth;
  const x = el.scrollLeft;
  el.dataset.scroll = max <= 1 ? "none" : x <= 1 ? "start" : x >= max - 1 ? "end" : "mid";
  const eq = el.querySelector<HTMLElement>(".sound-mixer-eq");
  el.toggleAttribute("data-eq-stuck", eq !== null && max > 1 && x > eq.offsetLeft + 1);
}

/* ------------------------------------------------------------------ */
/* Reasons written under the console                                   */
/* ------------------------------------------------------------------ */

interface Note {
  id: string;
  title: string;
  text: string;
  icon: string;
  warn?: boolean;
  /** A button next to the text (the EQ reset). */
  action?: SoundAction;
}

interface Notes {
  list: Note[];
  /** Note id per general reason text (unreachable, standby, unavailable): one note per reason. */
  byReason: Map<string, string>;
}

const NOTE_PRESET = "sound-mixer-note-preset";

/** A disabled control and the model's reason, to be named in a grouped note. */
interface Off {
  name: string;
  reason?: string;
}

function collectNotes(model: SoundModel): Notes {
  const list: Note[] = [];
  const notes: Notes = { list, byReason: new Map() };

  for (const level of model.levels) {
    if (level.reason && level.reasonKind === "blocked") {
      list.push({ id: `sound-mixer-note-${level.role}`, title: level.label, text: level.reason, icon: "mdi:lock-outline" });
    }
  }
  const eq = model.eq;
  const reset = eq?.preset?.reset;
  if (eq && (eq.reason || reset)) {
    list.push({
      id: "sound-mixer-note-eq",
      title: eq.title,
      text: eq.reason ?? eq.status?.label ?? "",
      icon: "mdi:information-outline",
      action: reset,
    });
  }
  const busyBand = eq?.bands.find((band) => !band.enabled && band.reasonKind === "busy");
  if (eq && busyBand?.reason) list.push({ id: NOTE_PRESET, title: eq.title, text: busyBand.reason, icon: "mdi:timer-sand" });
  const offset = model.bassOffset;
  if (offset?.error) list.push({ id: "sound-mixer-note-offset", title: offset.label, text: offset.error, icon: "mdi:alert-outline", warn: true });

  // Controls held back for a general reason (unreachable, standby, unavailable): one note per reason.
  const off: Off[] = [];
  for (const level of model.levels) if (!level.enabled && level.reasonKind !== "blocked") off.push({ name: level.label, reason: level.reason });
  if (eq) {
    const bandsOff = eq.bands.filter((band) => !band.enabled && band.reasonKind !== "busy");
    const preset = eq.preset;
    const presetOff = preset !== undefined && !preset.enabled;
    if (eq.bandsReason && bandsOff.length === eq.bands.length && (!preset || (presetOff && preset.reason === eq.bandsReason))) {
      // The whole EQ is out for one reason: name it once instead of every band.
      off.push({ name: eq.title, reason: eq.bandsReason });
    } else {
      if (presetOff) off.push({ name: preset.label, reason: preset.reason });
      for (const band of bandsOff) off.push({ name: band.ariaLabel, reason: band.reason });
    }
  }
  if (offset && !offset.enabled) off.push({ name: offset.label, reason: offset.reason });

  const groups = new Map<string, string[]>();
  for (const item of off) {
    if (!item.reason) continue;
    groups.set(item.reason, [...(groups.get(item.reason) ?? []), item.name]);
  }
  let n = 0;
  for (const [reason, names] of groups) {
    const id = `sound-mixer-note-off-${n++}`;
    notes.byReason.set(reason, id);
    list.push({ id, title: names.join(", "), text: reason, icon: "mdi:power-plug-off-outline" });
  }
  return notes;
}

/** Id of the note that explains `reason`, when it is a grouped (general) one. */
const offNote = (notes: Notes, reason: string | undefined): string | undefined =>
  reason === undefined ? undefined : notes.byReason.get(reason);

function renderNotes(notes: Notes): TemplateResult | typeof nothing {
  if (!notes.list.length) return nothing;
  return html`
    <div class="sound-mixer-notes">
      ${notes.list.map(
        (note) => html`
          <p class="hint sound-mixer-note ${note.warn ? "is-warn" : ""}" id=${note.id}>
            <ha-icon .icon=${note.icon} aria-hidden="true"></ha-icon>
            <span class="sound-mixer-note-text"><strong>${note.title}:</strong> ${note.text}</span>
            ${note.action ? renderNoteAction(note.action) : nothing}
          </p>
        `,
      )}
    </div>
  `;
}

function renderNoteAction(action: SoundAction): TemplateResult {
  return html`
    <button class="btn small sound-mixer-reset ${action.pending ? "pending" : ""}" ?disabled=${!action.enabled} @click=${() => action.run()}>
      <ha-icon .icon=${action.icon} aria-hidden="true"></ha-icon>${action.label}
    </button>
  `;
}

/* ------------------------------------------------------------------ */
/* Faders                                                              */
/* ------------------------------------------------------------------ */

interface Tick {
  /** 0 = bottom of the travel, 1 = top. */
  p: number;
  /** A reference mark (0 dB). */
  strong?: boolean;
  /** The position the bar reports (a level fader shows it next to the dragged target). */
  on?: boolean;
}

interface Fader {
  id: string;
  /** Extra class of the strip (sound-mixer-level-bass, sound-mixer-band ...). */
  cls: string;
  /** Short name under the fader. */
  name: string;
  ariaLabel: string;
  /** Value on top of the strip. */
  valueText: string;
  /** Full value when `valueText` is a shortened form (tooltip). */
  valueTitle?: string;
  /** Small second line under the value (center gain). */
  subText?: string;
  ariaValueText: string;
  min: number;
  max: number;
  step: number;
  position: number;
  ticks: Tick[];
  enabled: boolean;
  pending: boolean;
  dragging: boolean;
  /** The bar does not report a value: no cap is drawn. */
  unknown?: boolean;
  /** Blocked with a reason: a lock in the LED slot. */
  blocked?: boolean;
  describedBy?: string;
  badge?: SoundBadge;
  data?: string;
  /** Dragging (input event): the model previews the value, nothing is sent. */
  onInput(value: number): void;
  /** Release (change event: pointer up, or each keyboard step): send the value. */
  onCommit(value: number): void;
}

const frac = (value: number, min: number, max: number): number => (max > min ? (value - min) / (max - min) : 0);

/** Long values get a smaller font so they stay inside a narrow strip. */
const isLong = (text: string): boolean => text.length > 4;

/** A layout string, or `fallback` when the layout has no string for this key. */
function tOr(ctx: TabContext, key: string, fallback: string): string {
  const text = ctx.t(key);
  return text === key || text.startsWith("sound_mixer.") ? fallback : text;
}

/** One tick per whole dB between min and max; 0 dB is the reference mark. */
function dbTicks(min: number, max: number): Tick[] {
  const ticks: Tick[] = [];
  for (let v = Math.ceil(min); v <= Math.floor(max); v++) ticks.push({ p: frac(v, min, max), strong: v === 0 });
  return ticks;
}

/** Fader order of a level: low to high from the bottom, with mute (silence) at the very bottom. */
function levelOrder(level: SoundLevel): number[] {
  const order = level.options.map((_, i) => i);
  const muted = level.options.findIndex((option) => option.value === "muted");
  if (muted > 0) order.splice(order.indexOf(muted), 1).forEach((i) => order.unshift(i));
  return order;
}

function levelFader(ctx: TabContext, level: SoundLevel, notes: Notes): Fader {
  const order = levelOrder(level);
  const shown = level.shownIndex >= 0 ? level.options[level.shownIndex] : undefined;
  const last = Math.max(order.length - 1, 0);
  const unknown = ctx.t("common.unknown");
  const valueText = shown?.shortLabel ?? unknown;
  const label = shown?.label ?? unknown;
  const optionAt = (pos: number): SoundLevelOption | undefined => level.options[order[pos]];
  const blocked = level.reasonKind === "blocked";
  return {
    id: `sound-mixer-${level.role}`,
    cls: `sound-mixer-level sound-mixer-level-${level.role}`,
    name: tOr(ctx, `sound_mixer.short_${level.role}`, level.label),
    ariaLabel: level.label,
    valueText,
    valueTitle: valueText !== label ? label : undefined,
    subText: level.extra,
    ariaValueText: level.extra ? `${label}, ${level.extra}` : label,
    min: 0,
    max: last,
    step: 1,
    position: Math.max(order.indexOf(level.shownIndex), 0),
    ticks: order.map((i, pos) => ({ p: frac(pos, 0, last), on: level.options[i].active })),
    enabled: level.enabled && order.length > 0,
    pending: level.pending,
    dragging: level.dragging,
    unknown: level.shownIndex < 0,
    blocked,
    describedBy: blocked ? `sound-mixer-note-${level.role}` : offNote(notes, level.reason),
    data: level.role,
    onInput: (pos) => {
      const option = optionAt(pos);
      if (option) level.preview(option.value);
    },
    onCommit: (pos) => {
      const option = optionAt(pos);
      if (option) level.commit(option.value);
      else level.cancel();
    },
  };
}

function bandFader(ctx: TabContext, band: SoundBand, notes: Notes): Fader {
  return {
    id: `sound-mixer-band-${band.index}`,
    cls: "sound-mixer-band",
    name: tOr(ctx, `sound_mixer.band_${band.index}`, band.label),
    ariaLabel: band.ariaLabel,
    valueText: band.shortText,
    ariaValueText: band.valueText,
    min: band.min,
    max: band.max,
    step: band.step,
    position: band.position,
    ticks: dbTicks(band.min, band.max),
    enabled: band.enabled,
    pending: band.pending,
    dragging: band.dragging,
    describedBy: band.reasonKind === "busy" ? NOTE_PRESET : offNote(notes, band.reason),
    data: String(band.index),
    onInput: (value) => band.preview(value),
    onCommit: (value) => band.commit(value),
  };
}

function offsetFader(ctx: TabContext, offset: SoundBassOffset, notes: Notes): Fader {
  const describedBy = [offset.error ? "sound-mixer-note-offset" : undefined, offNote(notes, offset.reason)].filter(Boolean).join(" ");
  return {
    id: "sound-mixer-offset",
    cls: "sound-mixer-offset",
    name: ctx.t("sound_mixer.short_bass_offset"),
    ariaLabel: offset.label,
    // A number only on the strip: the unit is written once, in the scale column.
    valueText: offset.shortText,
    ariaValueText: offset.valueText,
    min: offset.min,
    max: offset.max,
    step: offset.step,
    position: offset.value ?? 0,
    ticks: dbTicks(offset.min, offset.max),
    enabled: offset.enabled,
    pending: offset.pending,
    dragging: offset.dragging,
    unknown: offset.value === undefined,
    describedBy: describedBy || undefined,
    badge: offset.status,
    onInput: (value) => offset.preview(value),
    onCommit: (value) => offset.commit(value),
  };
}

const badgeTone = (badge: SoundBadge): string => (badge.tone === "neutral" ? "" : badge.tone);

function renderFader(f: Fader): TemplateResult {
  const valueOf = (ev: Event): number => Number((ev.target as HTMLInputElement).value);
  const onInput = (ev: Event): void => f.onInput(valueOf(ev));
  const onChange = (ev: Event): void => f.onCommit(valueOf(ev));
  // With no reported value the input still sits at the bottom, where a click fires no change.
  const onClick = f.unknown ? onChange : undefined;
  return html`
    <div
      class="sound-mixer-strip ${f.cls} ${f.pending ? "is-pending" : ""} ${f.enabled ? "" : "is-off"} ${f.unknown ? "is-unknown" : ""}"
      data-strip=${ifDefined(f.data)}
    >
      <span class="sound-mixer-led" aria-hidden="true">
        ${f.pending
          ? html`<span class="spinner"></span>`
          : f.blocked
            ? html`<ha-icon class="sound-mixer-lock" .icon=${"mdi:lock-outline"}></ha-icon>`
            : nothing}
      </span>
      <span
        class="sound-mixer-value ${isLong(f.valueText) ? "is-long" : ""} ${f.pending ? "pending" : ""} ${f.dragging ? "is-dragging" : ""}"
        title=${ifDefined(f.valueTitle)}
        .textContent=${f.valueText}
      ></span>
      <span class="sound-mixer-sub">${f.subText ?? nothing}</span>
      <span class="sound-mixer-track">
        ${f.ticks.map(
          (tick) => html`<span
            class="sound-mixer-tick ${tick.strong ? "strong" : ""} ${tick.on ? "on" : ""}"
            style="--p: ${tick.p}"
          ></span>`,
        )}
        <input
          id=${f.id}
          class="sound-mixer-fader"
          type="range"
          aria-orientation="vertical"
          min=${f.min}
          max=${f.max}
          step=${f.step}
          .value=${live(String(f.position))}
          ?disabled=${!f.enabled}
          aria-label=${f.ariaLabel}
          aria-valuetext=${f.ariaValueText}
          aria-describedby=${ifDefined(f.describedBy)}
          aria-busy=${f.pending ? "true" : "false"}
          @input=${onInput}
          @change=${onChange}
          @click=${ifDefined(onClick)}
        />
      </span>
      <label class="sound-mixer-name" for=${f.id}>${f.name}</label>
      <span class="sound-mixer-foot">
        ${f.badge
          ? html`<span class="badge sound-mixer-badge ${badgeTone(f.badge)}" title=${f.badge.label}>${f.badge.label}</span>`
          : nothing}
      </span>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Front EQ group                                                      */
/* ------------------------------------------------------------------ */

function renderEqGroup(ctx: TabContext, eq: SoundEq | undefined, offset: SoundBassOffset | undefined, notes: Notes): TemplateResult {
  const title = eq?.title ?? offset?.label ?? "";
  const bands = eq?.bands ?? [];
  const scale = bands[0] ?? offset;
  return html`
    <div class="sound-mixer-group sound-mixer-eq" role="group" aria-label=${title}>
      <div class="sound-mixer-head">
        <div class="section-title">
          <span class="sound-mixer-eq-title">${title}</span>
          ${eq?.status
            ? html`<span class="badge sound-mixer-eq-status ${badgeTone(eq.status)}" aria-live="polite">${eq.status.label}</span>`
            : nothing}
        </div>
        ${eq?.preset ? renderPreset(eq.preset) : nothing}
      </div>
      <div class="sound-mixer-strips">
        ${scale ? renderScale(ctx, scale.min, scale.max, bands.length > 0) : nothing}
        ${bands.map((band) => renderFader(bandFader(ctx, band, notes)))}
        ${offset ? renderFader(offsetFader(ctx, offset, notes)) : nothing}
      </div>
    </div>
  `;
}

/** dB scale at the left of the EQ group, lined up with the fader travel; it carries the units. */
function renderScale(ctx: TabContext, min: number, max: number, hz: boolean): TemplateResult {
  const marks = [max, Math.round((min + max) / 2), min].filter((v, i, all) => all.indexOf(v) === i);
  return html`
    <div class="sound-mixer-scale" aria-hidden="true">
      <span class="sound-mixer-led"></span>
      <span class="sound-mixer-value">${ctx.t("sound_mixer.db")}</span>
      <span class="sound-mixer-sub"></span>
      <span class="sound-mixer-track">
        ${marks.map(
          (v) => html`<span class="sound-mixer-mark" style="--p: ${frac(v, min, max)}">${ctx.formatNumber(v, { maximumFractionDigits: 1 })}</span>`,
        )}
      </span>
      <span class="sound-mixer-name">${hz ? ctx.t("sound_mixer.hz") : nothing}</span>
      <span class="sound-mixer-foot"></span>
    </div>
  `;
}

function renderPreset(preset: SoundPreset): TemplateResult {
  const id = "sound-mixer-preset";
  const onChange = (ev: Event): void => {
    const select = ev.target as HTMLSelectElement;
    if (!preset.select(select.value)) select.value = preset.shown ?? "";
  };
  return html`
    <div class="sound-mixer-preset">
      <label class="sr-only" for=${id}>${preset.label}</label>
      <select
        id=${id}
        class="select ${preset.pending ? "pending" : ""}"
        ?disabled=${!preset.enabled}
        aria-busy=${preset.busy ? "true" : "false"}
        title=${ifDefined(preset.busy ? preset.busyReason : undefined)}
        .value=${live(preset.shown ?? "")}
        @change=${onChange}
      >
        ${preset.placeholder !== undefined ? html`<option value="" disabled selected>${preset.placeholder}</option>` : nothing}
        ${preset.options.map((option) => html`<option value=${option.value} ?selected=${option.selected}>${option.label}</option>`)}
      </select>
      ${preset.pending ? html`<span class="spinner" aria-hidden="true"></span>` : nothing}
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Audio sync                                                          */
/* ------------------------------------------------------------------ */

function stepButton(action: SoundAction, cls: string, locked: boolean | undefined): TemplateResult {
  return html`
    <button
      class=${cls}
      ?disabled=${!action.enabled}
      aria-disabled=${ifDefined(locked === undefined ? undefined : locked ? "true" : "false")}
      aria-label=${action.label}
      title=${action.label}
      @click=${() => action.run()}
    >
      <ha-icon .icon=${action.icon}></ha-icon>
    </button>
  `;
}

function renderAudioSync(sync: SoundStepper): TemplateResult {
  return html`
    <div class="sound-mixer-sync ${sync.locked ? "is-locked" : ""}">
      <div class="sound-mixer-sync-row">
        <span class="sound-mixer-sync-label">
          <ha-icon .icon=${"mdi:timer-sync-outline"} aria-hidden="true"></ha-icon>
          <span>${sync.label}</span>
        </span>
        <div class="stepper ${sync.pending ? "pending" : ""}" role="group" aria-label=${sync.label}>
          ${stepButton(sync.less, "sound-mixer-sync-down", sync.locked)}
          <span class="stepper-value" aria-live="polite">${sync.valueText}</span>
          ${stepButton(sync.more, "sound-mixer-sync-up", sync.locked)}
        </div>
      </div>
      ${sync.reason ?? sync.hint ? html`<div class="hint sound-mixer-sync-hint">${sync.reason ?? sync.hint}</div>` : nothing}
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

export const soundMixerStyles = css`
  .sound-mixer {
    /* The console geometry follows the width of this block (container query below). */
    container-type: inline-size;
    display: flex;
    flex-direction: column;
  }

  /*
   * Console: one row of faders. The default geometry fits a full-width card (the strips add up to
   * 402 px); below that the strips widen to 58 px and the row scrolls sideways with snapping.
   */
  .sound-mixer .sound-mixer-console {
    --sound-mixer-w-bass: 40px;
    --sound-mixer-w-center: 50px;
    --sound-mixer-w-text: 44px;
    --sound-mixer-w-band: 32px;
    --sound-mixer-w-offset: 38px;
    --sound-mixer-w-scale: 18px;
    --sound-mixer-gap: 3px;
    --sound-mixer-travel: 136px;
    /* Fader cap: length along the travel (its centre is where the ticks sit) and colours. */
    --sound-mixer-cap: 16px;
    --sound-mixer-cap-bg: var(--jbl-text);
    --sound-mixer-cap-ring: var(--jbl-card-bg);
    --sound-mixer-groove: var(--jbl-disabled);
    --sound-mixer-tick: var(--jbl-disabled);
    --sound-mixer-fade: 28px;
    position: relative;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x proximity;
    scrollbar-width: thin;
  }
  .sound-mixer .sound-mixer-desk {
    display: flex;
    align-items: stretch;
    gap: var(--sound-mixer-gap);
    width: max-content;
    padding-bottom: 6px;
  }
  .sound-mixer .sound-mixer-group {
    scroll-snap-align: start;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sound-mixer .sound-mixer-head {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    /* The EQ title, status and preset stay pinned while its bands scroll under them. */
    position: sticky;
    left: 0;
    align-self: flex-start;
    /* The strips set the group's width; the head wraps inside it instead of widening it. */
    width: 0;
    min-width: 100%;
    box-sizing: border-box;
  }
  .sound-mixer .sound-mixer-head .section-title {
    justify-content: flex-start;
    flex-wrap: wrap;
    min-height: 24px;
    row-gap: 4px;
    column-gap: 6px;
  }
  .sound-mixer .sound-mixer-head .badge {
    text-transform: none;
    letter-spacing: 0;
  }
  .sound-mixer .sound-mixer-strips {
    display: flex;
    margin-top: auto;
    border-radius: var(--jbl-radius-sm);
    background: var(--jbl-surface);
  }
  .sound-mixer .sound-mixer-divider {
    flex: none;
    width: 2px;
    border-radius: 1px;
    background: var(--jbl-border);
  }

  /* Channel strip: hairline separators between channels, no box of its own. */
  .sound-mixer .sound-mixer-strip,
  .sound-mixer .sound-mixer-scale {
    --sound-mixer-w: var(--sound-mixer-w-band);
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    width: var(--sound-mixer-w);
    padding: 4px 0 6px;
    box-sizing: border-box;
    scroll-snap-align: start;
  }
  .sound-mixer .sound-mixer-strips > * + * {
    border-left: 1px solid var(--jbl-border);
  }
  .sound-mixer .sound-mixer-level-bass {
    --sound-mixer-w: var(--sound-mixer-w-bass);
  }
  .sound-mixer .sound-mixer-level-center {
    --sound-mixer-w: var(--sound-mixer-w-center);
  }
  .sound-mixer .sound-mixer-level-atmos,
  .sound-mixer .sound-mixer-level-rear {
    --sound-mixer-w: var(--sound-mixer-w-text);
  }
  .sound-mixer .sound-mixer-offset {
    --sound-mixer-w: var(--sound-mixer-w-offset);
  }
  /* EQ strips snap clear of the pinned scale. */
  .sound-mixer .sound-mixer-eq .sound-mixer-strip {
    scroll-margin-left: var(--sound-mixer-w-scale);
  }
  .sound-mixer .sound-mixer-strip.is-pending {
    border-radius: var(--jbl-radius-sm);
    box-shadow: inset 0 0 0 2px rgba(var(--jbl-accent-rgb), 0.55);
  }
  /* The scale is a frozen first column: opaque, above the bands that scroll under it. */
  .sound-mixer .sound-mixer-scale {
    --sound-mixer-w: var(--sound-mixer-w-scale);
    position: sticky;
    left: 0;
    z-index: 1;
    border-radius: var(--jbl-radius-sm) 0 0 var(--jbl-radius-sm);
    background: linear-gradient(var(--jbl-surface), var(--jbl-surface)), var(--jbl-card-bg);
  }
  .sound-mixer .sound-mixer-led {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 14px;
  }
  .sound-mixer .sound-mixer-lock {
    --mdc-icon-size: 14px;
    color: var(--jbl-muted);
  }
  .sound-mixer .sound-mixer-value {
    max-width: calc(100% - 2px);
    font-size: 0.82rem;
    font-weight: 600;
    line-height: 1.2;
    min-height: 1.2em;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sound-mixer .sound-mixer-value.is-long {
    font-size: 0.7rem;
    line-height: 1.4;
  }
  .sound-mixer .sound-mixer-value.is-dragging {
    color: var(--jbl-accent-text);
  }
  .sound-mixer .sound-mixer-scale .sound-mixer-value,
  .sound-mixer .sound-mixer-scale .sound-mixer-name {
    font-size: 0.7rem;
    font-weight: 500;
    line-height: 1.4;
    color: var(--jbl-muted);
  }
  .sound-mixer .sound-mixer-sub {
    max-width: calc(100% - 2px);
    font-size: 0.7rem;
    line-height: 1.2;
    min-height: 1.2em;
    color: var(--jbl-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sound-mixer .sound-mixer-strip.is-off .sound-mixer-value {
    color: var(--jbl-muted);
  }

  /*
   * Fader: a horizontal range turned by -90deg inside a fixed box (writing-mode on range inputs
   * needs Chromium 124 / Safari 17.4, which older wall-panel tablets lack). Vertical drags belong to
   * the fader, sideways swipes scroll the console.
   */
  .sound-mixer .sound-mixer-track {
    position: relative;
    flex: none;
    width: 100%;
    height: var(--sound-mixer-travel);
    margin: 4px 0;
    touch-action: pan-x;
  }
  .sound-mixer .sound-mixer-tick {
    position: absolute;
    left: 22%;
    right: 22%;
    height: 1px;
    bottom: calc(var(--sound-mixer-cap) / 2 + var(--p) * (100% - var(--sound-mixer-cap)));
    background: linear-gradient(to right, var(--sound-mixer-tick) 0 30%, transparent 30% 70%, var(--sound-mixer-tick) 70%);
    pointer-events: none;
  }
  .sound-mixer .sound-mixer-tick.strong {
    left: 12%;
    right: 12%;
    background: linear-gradient(to right, var(--jbl-muted) 0 34%, transparent 34% 66%, var(--jbl-muted) 66%);
  }
  .sound-mixer .sound-mixer-tick.on {
    left: 12%;
    right: 12%;
    height: 2px;
    background: linear-gradient(to right, var(--jbl-accent) 0 34%, transparent 34% 66%, var(--jbl-accent) 66%);
  }
  .sound-mixer .sound-mixer-mark {
    position: absolute;
    right: 3px;
    bottom: calc(var(--sound-mixer-cap) / 2 + var(--p) * (100% - var(--sound-mixer-cap)));
    transform: translateY(50%);
    font-size: 0.7rem;
    line-height: 1;
    color: var(--jbl-muted);
    font-variant-numeric: tabular-nums;
  }
  .sound-mixer input[type="range"].sound-mixer-fader {
    --sound-mixer-cap-w: min(28px, calc(var(--sound-mixer-w) - 10px));
    position: absolute;
    top: 50%;
    left: 50%;
    width: var(--sound-mixer-travel);
    height: calc(var(--sound-mixer-w) - 4px);
    margin: 0;
    padding: 0;
    transform: translate(-50%, -50%) rotate(-90deg);
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    cursor: pointer;
  }
  .sound-mixer input[type="range"].sound-mixer-fader:disabled {
    cursor: default;
  }
  .sound-mixer input[type="range"].sound-mixer-fader::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
    background: var(--sound-mixer-groove);
  }
  .sound-mixer input[type="range"].sound-mixer-fader::-moz-range-track {
    height: 4px;
    border-radius: 2px;
    background: var(--sound-mixer-groove);
  }
  /* The cap: a solid block with an accent line across it, like a console fader knob. */
  .sound-mixer input[type="range"].sound-mixer-fader::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: var(--sound-mixer-cap);
    height: var(--sound-mixer-cap-w);
    margin-top: calc((4px - var(--sound-mixer-cap-w)) / 2);
    border: 0;
    border-radius: 3px;
    background: linear-gradient(
      to right,
      var(--sound-mixer-cap-bg) 0 40%,
      var(--jbl-accent) 40% 60%,
      var(--sound-mixer-cap-bg) 60%
    );
    box-shadow: 0 0 0 1px var(--sound-mixer-cap-ring);
  }
  .sound-mixer input[type="range"].sound-mixer-fader::-moz-range-thumb {
    width: var(--sound-mixer-cap);
    height: var(--sound-mixer-cap-w);
    border: 0;
    border-radius: 3px;
    background: linear-gradient(
      to right,
      var(--sound-mixer-cap-bg) 0 40%,
      var(--jbl-accent) 40% 60%,
      var(--sound-mixer-cap-bg) 60%
    );
    box-shadow: 0 0 0 1px var(--sound-mixer-cap-ring);
  }
  .sound-mixer input[type="range"].sound-mixer-fader:disabled::-webkit-slider-thumb {
    background: var(--jbl-disabled);
  }
  .sound-mixer input[type="range"].sound-mixer-fader:disabled::-moz-range-thumb {
    background: var(--jbl-disabled);
  }
  /* No reported value: no cap, so the fader does not pretend to sit at the bottom option. */
  .sound-mixer .sound-mixer-strip.is-unknown input[type="range"].sound-mixer-fader::-webkit-slider-thumb {
    opacity: 0;
  }
  .sound-mixer .sound-mixer-strip.is-unknown input[type="range"].sound-mixer-fader::-moz-range-thumb {
    opacity: 0;
  }
  .sound-mixer input[type="range"].sound-mixer-fader:focus-visible {
    outline: 2px solid var(--jbl-accent);
    outline-offset: 0;
    border-radius: 4px;
  }

  .sound-mixer .sound-mixer-name {
    max-width: 100%;
    min-height: 2.3em;
    font-size: 0.7rem;
    line-height: 1.15;
    text-align: center;
    color: var(--jbl-muted);
    overflow-wrap: break-word;
  }
  .sound-mixer .sound-mixer-foot {
    display: flex;
    justify-content: center;
    width: 100%;
    min-height: 18px;
  }
  /* The bass offset status may reach under the empty foot of the band next to it. */
  .sound-mixer .sound-mixer-offset .sound-mixer-foot {
    justify-content: flex-end;
    padding-right: 2px;
    box-sizing: border-box;
  }
  .sound-mixer .sound-mixer-badge {
    flex: none;
    padding: 1px 6px;
    font-size: 0.7rem;
  }

  /* Title, status and preset above the EQ group; the preset gets its own row. */
  .sound-mixer .sound-mixer-preset {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .sound-mixer .sound-mixer-preset select {
    flex: 1 1 auto;
    min-width: 0;
    max-width: 220px;
    padding: 4px 8px;
    font-size: 0.85rem;
  }
  .sound-mixer .sound-mixer-reset ha-icon {
    --mdc-icon-size: 16px;
  }

  /* Reasons under the console */
  .sound-mixer .sound-mixer-notes {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 6px;
  }
  .sound-mixer .sound-mixer-note {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    flex-wrap: wrap;
    margin: 0;
  }
  .sound-mixer .sound-mixer-note-text {
    flex: 1 1 160px;
    min-width: 0;
  }
  .sound-mixer .sound-mixer-reset {
    flex: none;
    margin-left: auto;
  }
  .sound-mixer .sound-mixer-note ha-icon {
    --mdc-icon-size: 16px;
    flex: none;
    margin-top: 1px;
  }
  .sound-mixer .sound-mixer-note strong {
    font-weight: 500;
    color: var(--jbl-text);
  }
  .sound-mixer .sound-mixer-note.is-warn ha-icon {
    color: var(--jbl-warning);
  }

  /* Audio sync: a compact stepper under the console */
  .sound-mixer .sound-mixer-sync {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 10px;
    padding: 4px 4px 4px 10px;
    border-radius: var(--jbl-radius-sm);
    border: 1px solid var(--jbl-border);
  }
  .sound-mixer .sound-mixer-sync-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }
  .sound-mixer .sound-mixer-sync-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 0.9rem;
  }
  .sound-mixer .sound-mixer-sync-label ha-icon {
    color: var(--jbl-muted);
  }
  .sound-mixer .sound-mixer-sync .stepper button[aria-disabled="true"] {
    cursor: progress;
    opacity: 0.55;
  }
  .sound-mixer .sound-mixer-sync .stepper-value {
    min-width: 60px;
    font-size: 0.9rem;
  }
  .sound-mixer .sound-mixer-sync-hint {
    padding: 0 6px 4px 0;
  }

  /*
   * Cards wider than the console: the strips grow to fill the width instead of leaving an empty
   * gap on the right. Free space goes to the two groups in proportion to their strips (4 levels,
   * 5 bands + bass offset), then equally to the strips of each group; the dB scale stays narrow.
   */
  @container (width >= 402px) {
    .sound-mixer .sound-mixer-desk {
      width: 100%;
    }
    .sound-mixer .sound-mixer-levels {
      flex: 4 1 auto;
    }
    .sound-mixer .sound-mixer-eq {
      flex: 6 1 auto;
    }
    .sound-mixer .sound-mixer-strip {
      flex: 1 0 var(--sound-mixer-w);
      width: auto;
    }
  }

  /* Narrow cards: wider strips, sideways scrolling, an edge fade where faders are hidden. */
  @container (width < 402px) {
    .sound-mixer .sound-mixer-console {
      --sound-mixer-w-bass: 58px;
      --sound-mixer-w-center: 58px;
      --sound-mixer-w-text: 58px;
      --sound-mixer-w-band: 58px;
      --sound-mixer-w-offset: 58px;
      --sound-mixer-w-scale: 26px;
      --sound-mixer-gap: 10px;
      /* At the start (also before the first scroll event): faders hidden on the right. */
      -webkit-mask-image: linear-gradient(to right, #000 calc(100% - var(--sound-mixer-fade)), transparent);
      mask-image: linear-gradient(to right, #000 calc(100% - var(--sound-mixer-fade)), transparent);
    }
    .sound-mixer .sound-mixer-console[data-scroll="mid"]:not([data-eq-stuck]) {
      -webkit-mask-image: linear-gradient(
        to right,
        transparent,
        #000 var(--sound-mixer-fade),
        #000 calc(100% - var(--sound-mixer-fade)),
        transparent
      );
      mask-image: linear-gradient(
        to right,
        transparent,
        #000 var(--sound-mixer-fade),
        #000 calc(100% - var(--sound-mixer-fade)),
        transparent
      );
    }
    .sound-mixer .sound-mixer-console[data-scroll="end"] {
      -webkit-mask-image: linear-gradient(to right, transparent, #000 var(--sound-mixer-fade));
      mask-image: linear-gradient(to right, transparent, #000 var(--sound-mixer-fade));
    }
    /* The pinned scale already covers the bands scrolled away on the left: no fade over it. */
    .sound-mixer .sound-mixer-console[data-scroll="end"][data-eq-stuck],
    .sound-mixer .sound-mixer-console[data-scroll="none"] {
      -webkit-mask-image: none;
      mask-image: none;
    }
    .sound-mixer .sound-mixer-console[data-eq-stuck] .sound-mixer-scale {
      border-radius: 0;
      box-shadow: 1px 0 0 var(--jbl-border);
    }
    .sound-mixer .sound-mixer-eq .sound-mixer-head {
      min-width: min(100%, 260px, 100cqi);
    }
  }
`;
