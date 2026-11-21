import { css, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import { numericState } from "../format";
import { isBlankState, numAttr, selectOptions, textAttr } from "../state";
import type { TabContext } from "../types";

/**
 * Sound tab: level selects (bass, center, atmos, rear), audio sync, Front EQ (status, preset,
 * five bands) and bass offset. Every block is hidden when its entity is missing.
 *
 * Slow controls are debounced and sent one at a time: the user can click or drag several times,
 * only the last value is sent, and a value chosen while an earlier one is still on its way is
 * sent after it (the integration runs one command at a time anyway).
 */

/** Pending keys used by this tab. */
export const SOUND_KEYS = {
  bass: "sound.bass",
  center: "sound.center",
  atmos: "sound.atmos",
  rear: "sound.rear",
  audioSync: "sound.audio_sync",
  preset: "sound.eq_preset",
  bassOffset: "sound.bass_offset",
} as const;

/** Pending key of one Front EQ band (0 = 125 Hz ... 4 = 8 kHz). */
export function bandKey(index: number): string {
  return `sound.eq_band.${index}`;
}

/**
 * Debounce delays in ms (how long the card waits for more input before sending).
 * Constant configuration, not card state; tests set them to 0.
 */
export const SOUND_TIMING = {
  levelMs: 350,
  audioSyncMs: 900,
  eqMs: 400,
  bassOffsetMs: 400,
};

/** Center level gain per option index ("0" = original ... "5" = +12 dB). */
export const CENTER_DB: readonly number[] = [0, 2.4, 4.8, 7.2, 9.6, 12];

type LevelRole = "bass" | "center" | "atmos" | "rear";

const LEVEL_OPTIONS: Record<LevelRole, readonly string[]> = {
  bass: ["1", "2", "3", "4", "5"],
  center: ["0", "1", "2", "3", "4", "5"],
  atmos: ["low", "mid", "high"],
  rear: ["low", "mid", "high", "muted"],
};

export const EQ_PRESETS: readonly string[] = [
  "original",
  "less_bass",
  "clear_dialogue",
  "softer_treble",
  "warm",
  "bright",
  "vocal_focus",
];

/** Front EQ status -> badge class. "off", "ready" and anything unknown use the neutral badge. */
const STATUS_BADGE: Record<string, string> = {
  active: "ok",
  waiting: "warn",
  reset_needed: "err",
  updating: "info",
};

/* ------------------------------------------------------------------ */
/* Debounced, one-at-a-time sending                                    */
/* ------------------------------------------------------------------ */

interface SendQueue<T> {
  /** The latest TabContext this tab rendered with (a captured ctx would hold a stale hass). */
  ctx?: TabContext;
  /** Chosen by the user, not sent yet. */
  want?: T;
  /** Being sent right now. */
  inflight?: T;
  timer?: ReturnType<typeof setTimeout>;
}

type Sender<T> = (latest: () => TabContext, value: T) => Promise<unknown>;

function sendQueue<T>(ctx: TabContext, key: string): SendQueue<T> {
  const queue = ctx.local<SendQueue<T>>(`${key}.queue`, () => ({}));
  queue.ctx = ctx;
  return queue;
}

/** Remember `value` and send it once no new value came for `delayMs`; the latest value wins. */
function schedule<T>(queue: SendQueue<T>, value: T, delayMs: number, send: Sender<T>): void {
  queue.want = value;
  if (queue.timer !== undefined) clearTimeout(queue.timer);
  queue.timer = setTimeout(() => {
    queue.timer = undefined;
    void flush(queue, send);
  }, delayMs);
  queue.ctx?.requestUpdate();
}

async function flush<T>(queue: SendQueue<T>, send: Sender<T>): Promise<void> {
  if (queue.inflight !== undefined || queue.want === undefined || !queue.ctx) return;
  const value = queue.want;
  queue.want = undefined;
  queue.inflight = value;
  try {
    await send(() => queue.ctx!, value);
  } finally {
    queue.inflight = undefined;
    queue.ctx?.requestUpdate();
  }
  // A value chosen while this one was on its way: send it now unless its timer is still running.
  if (queue.want !== undefined && queue.timer === undefined) await flush(queue, send);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Translation, or `fallback` when the key has no text (t() returns the key itself then). */
function tOr(ctx: TabContext, key: string, fallback: string): string {
  const text = ctx.t(key);
  return text === key ? fallback : text;
}

/** "warm" -> "Warm", "less_bass" -> "Less bass" (for options the card has no translation for). */
function humanize(option: string): string {
  const text = option.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Snap to the entity's step grid and clamp to its range. */
export function snapToStep(value: number, min: number, max: number, step: number): number {
  const snapped = step > 0 ? Math.round((value - min) / step) * step + min : value;
  const clamped = Math.min(max, Math.max(min, snapped));
  return Math.round(clamped * 100) / 100;
}

function formatDb(ctx: TabContext, value: number, signed: boolean): string {
  const number = ctx.formatNumber(value, {
    maximumFractionDigits: 1,
    signDisplay: signed ? "exceptZero" : "auto",
  });
  return ctx.t("sound.db", { value: number });
}

function statusLabel(ctx: TabContext, status: string): string {
  return tOr(ctx, `sound.status.${status}`, humanize(status));
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

export function renderSoundTab(ctx: TabContext): TemplateResult {
  const blocks = [
    renderLevel(ctx, "bass"),
    renderLevel(ctx, "center"),
    renderLevel(ctx, "atmos"),
    renderLevel(ctx, "rear"),
    renderAudioSync(ctx),
    renderEq(ctx),
  ].filter((block): block is TemplateResult => block !== undefined);
  return html`
    <div class="sound">
      ${blocks.length ? blocks : html`<div class="hint">${ctx.t("sound.empty")}</div>`}
    </div>
  `;
}

/* ---------------- Level selects ---------------- */

function levelLabel(ctx: TabContext, role: LevelRole, option: string): string {
  switch (role) {
    case "bass":
      return option;
    case "center": {
      const index = Number(option);
      return Number.isInteger(index) ? String(index + 1) : option;
    }
    case "atmos":
    case "rear":
      return tOr(ctx, `sound.${role}_${option}`, humanize(option));
  }
}

/** Why the rear level cannot change now (the remote refuses while the rears are docked or unknown). */
function rearBlockedReason(ctx: TabContext): string | undefined {
  const dockedId = ctx.entities.rear_docked;
  if (!dockedId || ctx.barUnavailable) return undefined;
  const docked = ctx.stateOf(dockedId)?.state;
  if (docked === "off") return undefined;
  return ctx.t(docked === "on" ? "sound.rear_docked_hint" : "sound.rear_unknown_hint");
}

function renderLevel(ctx: TabContext, role: LevelRole): TemplateResult | undefined {
  const id = ctx.entities[role];
  if (!id) return undefined;
  const st = ctx.stateOf(id);
  const options = selectOptions(st, LEVEL_OPTIONS[role]);
  const current = st && options.includes(st.state) ? st.state : undefined;
  const key = SOUND_KEYS[role];
  const queue = sendQueue<string>(ctx, key);
  const target = queue.want ?? ctx.pendingValue<string>(key);
  const shown = target ?? current;
  const blocked = role === "rear" ? rearBlockedReason(ctx) : undefined;
  const disabled = !ctx.isAvailable(id) || blocked !== undefined;
  const label = ctx.t(`sound.${role}`);

  const send: Sender<string> = (latest, option) => {
    const c = latest();
    if (option === c.stateOf(id)?.state && !c.isPending(key)) return Promise.resolve();
    return c.call(key, () => c.services.selectOption(id, option), {
      value: option,
      until: (hass) => hass.states[id]?.state === option,
      // The integration cycles "<level>_next" with read-back, one action per step.
      timeoutMs: 45000,
    });
  };
  const choose = (option: string): void => {
    if (option === shown) return;
    schedule(queue, option, SOUND_TIMING.levelMs, send);
  };

  let extra: TemplateResult | typeof nothing = nothing;
  if (role === "center" && shown !== undefined) {
    const db = CENTER_DB[options.indexOf(shown)];
    if (db !== undefined) {
      extra = html`<span class="level-extra">${db === 0 ? ctx.t("sound.center_original") : formatDb(ctx, db, true)}</span>`;
    }
  }

  return html`
    <div class="section level level-${role}">
      <div class="section-title"><span>${label}</span>${extra}</div>
      <div class="seg" role="radiogroup" aria-label=${label}>
        ${options.map(
          (option) => html`
            <button
              role="radio"
              aria-checked=${String(option === current)}
              class="${option === current ? "active" : ""} ${target === option && option !== current ? "pending" : ""}"
              ?disabled=${disabled}
              data-option=${option}
              title=${levelLabel(ctx, role, option)}
              @click=${() => choose(option)}
            >
              ${levelLabel(ctx, role, option)}
            </button>
          `,
        )}
      </div>
      ${blocked ? html`<div class="hint">${blocked}</div>` : nothing}
    </div>
  `;
}

/* ---------------- Audio sync ---------------- */

function renderAudioSync(ctx: TabContext): TemplateResult | undefined {
  const id = ctx.entities.audio_sync;
  if (!id) return undefined;
  const st = ctx.stateOf(id);
  const available = ctx.isAvailable(id);
  const min = numAttr(st, "min", 0);
  const max = numAttr(st, "max", 250);
  const step = numAttr(st, "step", 10);
  const key = SOUND_KEYS.audioSync;
  const queue = sendQueue<number>(ctx, key);
  const sending = ctx.isPending(key);
  const current = available ? numericState(st?.state) : undefined;
  const shown = queue.want ?? ctx.pendingValue<number>(key) ?? current;

  const send: Sender<number> = (latest, value) => {
    const c = latest();
    if (value === numericState(c.stateOf(id)?.state) && !c.isPending(key)) return Promise.resolve();
    return c.call(key, () => c.services.setNumber(id, value), {
      value,
      until: (hass) => numericState(hass.states[id]?.state) === value,
      // One re-sync session on the bar: up to 75 s per request, plus the busy wait.
      timeoutMs: 90000,
    });
  };
  const change = (direction: 1 | -1): void => {
    if (shown === undefined || ctx.isPending(key)) return;
    const target = snapToStep(shown + direction * step, min, max, step);
    if (target === shown) return;
    schedule(queue, target, SOUND_TIMING.audioSyncMs, send);
  };

  let hint: string | undefined;
  if (!available && !ctx.barUnavailable) hint = ctx.t(ctx.barOn ? "sound.audio_sync_source_hint" : "sound.audio_sync_standby_hint");
  else if (sending) hint = ctx.t("sound.audio_sync_slow");
  const label = ctx.t("sound.audio_sync");
  // Do not send another value while the bar is still re-syncing (it can take tens of seconds).
  // The +/- buttons keep focus while sending (aria-disabled, clicks ignored) instead of being disabled.
  const locked = !available;

  return html`
    <div class="section audio-sync">
      <div class="sound-row">
        <span class="sound-row-label">${label}</span>
        <div class="stepper ${sending || queue.want !== undefined ? "pending" : ""}" role="group" aria-label=${label}>
          <button
            class="sync-down"
            ?disabled=${locked || shown === undefined || shown <= min}
            aria-disabled=${sending ? "true" : "false"}
            aria-label=${ctx.t("sound.audio_sync_less")}
            title=${ctx.t("sound.audio_sync_less")}
            @click=${() => change(-1)}
          >
            <ha-icon .icon=${"mdi:minus"}></ha-icon>
          </button>
          <span class="stepper-value" aria-live="polite">
            ${shown === undefined ? ctx.t("common.unknown") : ctx.t("sound.ms", { value: ctx.formatNumber(shown) })}
          </span>
          <button
            class="sync-up"
            ?disabled=${locked || shown === undefined || shown >= max}
            aria-disabled=${sending ? "true" : "false"}
            aria-label=${ctx.t("sound.audio_sync_more")}
            title=${ctx.t("sound.audio_sync_more")}
            @click=${() => change(1)}
          >
            <ha-icon .icon=${"mdi:plus"}></ha-icon>
          </button>
        </div>
      </div>
      ${hint ? html`<div class="hint">${hint}</div>` : nothing}
    </div>
  `;
}

/* ---------------- Front EQ + bass offset ---------------- */

interface EqStatus {
  status?: string;
  reason?: string;
}

function eqStatus(ctx: TabContext): EqStatus {
  const sensor = ctx.stateOf(ctx.entities.front_eq_status);
  const preset = ctx.stateOf(ctx.entities.eq_preset);
  let status: string | undefined;
  if (sensor && !isBlankState(sensor.state)) {
    status = sensor.state;
  } else {
    const raw = textAttr(preset, "status");
    status = raw === "reset_required" ? "reset_needed" : raw;
  }
  return { status, reason: textAttr(sensor, "reason") ?? textAttr(preset, "error") };
}

function renderEq(ctx: TabContext): TemplateResult | undefined {
  const { entities } = ctx;
  const offset = renderBassOffset(ctx);
  const hasBands = entities.eqBands.some(Boolean);
  if (!entities.eq_preset && !entities.front_eq_status && !hasBands) {
    return offset ? html`<div class="section bass-offset-only">${offset}</div>` : undefined;
  }
  const { status, reason } = eqStatus(ctx);
  return html`
    <div class="section eq">
      <div class="section-title">
        <span>${ctx.t("sound.eq")}</span>
        ${status
          ? html`<span class="badge eq-status ${STATUS_BADGE[status] ?? ""}" aria-live="polite">${statusLabel(ctx, status)}</span>`
          : nothing}
      </div>
      ${reason ? html`<div class="hint eq-reason">${reason}</div>` : nothing}
      ${renderPreset(ctx, status)} ${hasBands ? renderBands(ctx) : nothing} ${offset ?? nothing}
    </div>
  `;
}

function selectPreset(ctx: TabContext, id: string, option: string): void {
  void ctx.call(SOUND_KEYS.preset, () => ctx.services.selectOption(id, option), {
    value: option,
    until: (hass) => hass.states[id]?.state === option,
    timeoutMs: 30000,
  });
}

function bandsBusy(ctx: TabContext): boolean {
  const queue = sendQueue<Record<number, number>>(ctx, "sound.eq_bands");
  return queue.want !== undefined || queue.inflight !== undefined || ctx.entities.eqBands.some((_, i) => ctx.isPending(bandKey(i)));
}

function renderPreset(ctx: TabContext, status: string | undefined): TemplateResult | typeof nothing {
  const id = ctx.entities.eq_preset;
  if (!id) return nothing;
  const st = ctx.stateOf(id);
  const available = ctx.isAvailable(id);
  const options = selectOptions(st, EQ_PRESETS);
  const current = st && options.includes(st.state) ? st.state : undefined;
  const pending = ctx.isPending(SOUND_KEYS.preset);
  const shown = ctx.pendingValue<string>(SOUND_KEYS.preset) ?? current;
  const label = ctx.t("sound.eq_preset");
  const selectId = "sound-eq-preset";

  const busy = pending || bandsBusy(ctx);
  const onChange = (ev: Event): void => {
    const select = ev.target as HTMLSelectElement;
    const option = select.value;
    // While a preset is applying (up to 30 s) the select stays focused but ignores changes: an
    // arrow key on a closed select fires change on every press in Chromium on Windows.
    if (busy || !options.includes(option) || option === shown) {
      select.value = shown ?? "";
      return;
    }
    selectPreset(ctx, id, option);
  };

  return html`
    <div class="eq-preset-row">
      <div class="field eq-preset">
        <label for=${selectId}>${label}</label>
        <select
          id=${selectId}
          class="select ${pending ? "pending" : ""}"
          ?disabled=${!available}
          aria-busy=${busy ? "true" : "false"}
          .value=${live(shown ?? "")}
          @change=${onChange}
        >
          ${shown === undefined
            ? html`<option value="" disabled selected>${available ? ctx.t("sound.eq_custom") : ctx.t("common.unknown")}</option>`
            : nothing}
          ${options.map(
            (option) =>
              html`<option value=${option} ?selected=${option === shown}>
                ${tOr(ctx, `sound.preset_${option}`, humanize(option))}
              </option>`,
          )}
        </select>
      </div>
      ${status === "reset_needed" && options.includes("original")
        ? html`<button class="btn small eq-reset" ?disabled=${!available || pending} @click=${() => selectPreset(ctx, id, "original")}>
            ${ctx.t("sound.eq_reset")}
          </button>`
        : nothing}
    </div>
  `;
}

interface EqLocal {
  /** Band values while their slider is being dragged (not sent yet). */
  drag: Record<number, number>;
}

function renderBands(ctx: TabContext): TemplateResult {
  const local = ctx.local<EqLocal>("sound.eq", () => ({ drag: {} }));
  const queue = sendQueue<Record<number, number>>(ctx, "sound.eq_bands");
  const presetPending = ctx.isPending(SOUND_KEYS.preset);

  // Each band sends the FULL curve built from the current one: send bands one after another.
  const send: Sender<Record<number, number>> = async (latest, wanted) => {
    for (const [index, value] of Object.entries(wanted)) {
      const c = latest();
      const i = Number(index);
      const id = c.entities.eqBands[i];
      if (!id) continue;
      if (value === numericState(c.stateOf(id)?.state) && !c.isPending(bandKey(i))) continue;
      await c.call(bandKey(i), () => c.services.setNumber(id, value), {
        value,
        until: (hass) => numericState(hass.states[id]?.state) === value,
        timeoutMs: 30000,
      });
    }
  };

  return html`
    <div class="eq-bands" role="group" aria-label=${ctx.t("sound.eq")}>
      ${ctx.entities.eqBands.map((id, i) => {
        if (!id) return nothing;
        const st = ctx.stateOf(id);
        const available = ctx.isAvailable(id);
        const min = numAttr(st, "min", -6);
        const max = numAttr(st, "max", 0);
        const step = numAttr(st, "step", 0.5);
        const current = available ? numericState(st?.state) : undefined;
        const key = bandKey(i);
        const queued = queue.want?.[i] ?? queue.inflight?.[i];
        const shown = local.drag[i] ?? queued ?? ctx.pendingValue<number>(key) ?? current;
        const pending = queued !== undefined || ctx.isPending(key);
        const band = ctx.t(`sound.band_${i}`);
        const valueText = shown === undefined ? ctx.t("common.unknown") : formatDb(ctx, shown, false);

        const onInput = (ev: Event): void => {
          local.drag[i] = Number((ev.target as HTMLInputElement).value);
          ctx.requestUpdate();
        };
        const onChange = (ev: Event): void => {
          const value = snapToStep(Number((ev.target as HTMLInputElement).value), min, max, step);
          delete local.drag[i];
          if (value === current && queued === undefined && !ctx.isPending(key)) {
            ctx.requestUpdate();
            return;
          }
          schedule(queue, { ...(queue.want ?? {}), [i]: value }, SOUND_TIMING.eqMs, send);
        };

        return html`
          <div class="eq-band ${pending ? "pending" : ""}">
            <span class="eq-value">${shown === undefined ? ctx.t("common.unknown") : ctx.formatNumber(shown, { maximumFractionDigits: 1 })}</span>
            <span class="eq-track">
            <input
              class="slider eq-slider"
              type="range"
              aria-orientation="vertical"
              data-band=${i}
              min=${min}
              max=${max}
              step=${step}
              .value=${live(String(shown ?? max))}
              ?disabled=${!available || presetPending}
              aria-label=${ctx.t("sound.eq_band_label", { band })}
              aria-valuetext=${valueText}
              @input=${onInput}
              @change=${onChange}
            />
            </span>
            <span class="eq-freq">${band}</span>
          </div>
        `;
      })}
    </div>
  `;
}

function renderBassOffset(ctx: TabContext): TemplateResult | undefined {
  const id = ctx.entities.bass_offset;
  if (!id) return undefined;
  const st = ctx.stateOf(id);
  const available = ctx.isAvailable(id);
  const min = numAttr(st, "min", -3);
  const max = numAttr(st, "max", 3);
  const step = numAttr(st, "step", 0.5);
  const key = SOUND_KEYS.bassOffset;
  const queue = sendQueue<number>(ctx, key);
  const current = available ? numericState(st?.state) : undefined;
  const shown = queue.want ?? ctx.pendingValue<number>(key) ?? current;
  const pending = queue.want !== undefined || ctx.isPending(key);
  const status = textAttr(st, "status");
  const error = textAttr(st, "error");
  const label = ctx.t("sound.bass_offset");

  const send: Sender<number> = (latest, value) => {
    const c = latest();
    if (value === numericState(c.stateOf(id)?.state) && !c.isPending(key)) return Promise.resolve();
    return c.call(key, () => c.services.setNumber(id, value), {
      value,
      until: (hass) => numericState(hass.states[id]?.state) === value,
    });
  };
  const change = (direction: 1 | -1): void => {
    if (shown === undefined) return;
    const target = snapToStep(shown + direction * step, min, max, step);
    if (target === shown) return;
    schedule(queue, target, SOUND_TIMING.bassOffsetMs, send);
  };

  return html`
    <div class="bass-offset">
      <div class="sound-row">
        <span class="sound-row-label">
          <span>${label}</span>
          ${status
            ? html`<span class="badge offset-status ${STATUS_BADGE[status] ?? ""}">${statusLabel(ctx, status)}</span>`
            : nothing}
        </span>
        <div class="stepper ${pending ? "pending" : ""}" role="group" aria-label=${label}>
          <button
            class="offset-down"
            ?disabled=${!available || shown === undefined || shown <= min}
            aria-label=${ctx.t("sound.bass_offset_less")}
            title=${ctx.t("sound.bass_offset_less")}
            @click=${() => change(-1)}
          >
            <ha-icon .icon=${"mdi:minus"}></ha-icon>
          </button>
          <span class="stepper-value" aria-live="polite">
            ${shown === undefined ? ctx.t("common.unknown") : formatDb(ctx, shown, true)}
          </span>
          <button
            class="offset-up"
            ?disabled=${!available || shown === undefined || shown >= max}
            aria-label=${ctx.t("sound.bass_offset_more")}
            title=${ctx.t("sound.bass_offset_more")}
            @click=${() => change(1)}
          >
            <ha-icon .icon=${"mdi:plus"}></ha-icon>
          </button>
        </div>
      </div>
      ${error ? html`<div class="hint warn-text offset-error">${error}</div>` : nothing}
    </div>
  `;
}

/** Styles for this tab only (added to the card's static styles). */
export const soundStyles = css`
  .sound .level-extra {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
    font-variant-numeric: tabular-nums;
  }
  .sound .section-title .badge {
    text-transform: none;
    letter-spacing: 0;
  }
  .sound-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }
  .sound-row-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 0.95rem;
  }
  .sound .stepper .stepper-value {
    min-width: 72px;
  }
  .eq-preset-row {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    flex-wrap: wrap;
  }
  .eq-preset {
    flex: 1 1 160px;
  }
  .eq-preset select {
    width: 100%;
  }
  .eq-bands {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 4px;
    padding: 10px 4px;
    border-radius: var(--jbl-radius-sm);
    background: var(--jbl-surface);
  }
  .eq-band {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  /*
   * A horizontal slider turned by -90deg inside a fixed box: works in every browser (writing-mode
   * on range inputs needs Chromium 124 / Safari 17.4, which older wall-panel tablets lack).
   */
  .eq-track {
    position: relative;
    width: 28px;
    height: 120px;
    flex: none;
  }
  .eq-band input[type="range"].eq-slider {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 120px;
    height: 28px;
    margin: 0;
    transform: translate(-50%, -50%) rotate(-90deg);
  }
  .eq-value {
    font-size: 0.85rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .eq-freq {
    font-size: 0.75rem;
    color: var(--jbl-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .bass-offset {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
  }
`;
