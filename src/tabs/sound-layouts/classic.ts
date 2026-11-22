import { css, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";
import type { TabContext } from "../../types";
import type { SoundAction, SoundBadge, SoundBassOffset, SoundEq, SoundLevel, SoundModel, SoundPreset, SoundStepper } from "../sound-model";

/**
 * "classic" layout of the Sound tab: level rows, audio sync stepper, Front EQ (status, preset,
 * five vertical bands) and bass offset. Renders the model only; every decision is in sound-model.ts.
 */
export function renderSoundClassic(_ctx: TabContext, model: SoundModel): TemplateResult {
  const blocks: TemplateResult[] = [...model.levels.map(renderLevel)];
  if (model.audioSync) blocks.push(renderAudioSync(model.audioSync));
  if (model.eq) blocks.push(renderEq(model.eq, model.bassOffset));
  else if (model.bassOffset) blocks.push(html`<div class="section bass-offset-only">${renderBassOffset(model.bassOffset)}</div>`);
  return html`
    <div class="sound">
      ${model.empty ? html`<div class="hint">${model.emptyText}</div>` : blocks}
    </div>
  `;
}

const badgeClass = (badge: SoundBadge): string => (badge.tone === "neutral" ? "" : badge.tone);

/**
 * The level's own block only (docked rears). Classic does not repeat "unreachable" or "turn the
 * bar on" under every row: the card header already says so.
 */
const ownReason = (level: SoundLevel): string | undefined => (level.reasonKind === "blocked" ? level.reason : undefined);

function renderLevel(level: SoundLevel): TemplateResult {
  return html`
    <div class="section level level-${level.role}">
      <div class="section-title">
        <span>${level.label}</span>${level.extra !== undefined ? html`<span class="level-extra">${level.extra}</span>` : nothing}
      </div>
      <div class="seg" role="radiogroup" aria-label=${level.label}>
        ${level.options.map(
          (option) => html`
            <button
              role="radio"
              aria-checked=${String(option.active)}
              class="${option.active ? "active" : ""} ${option.pending ? "pending" : ""}"
              ?disabled=${!level.enabled}
              data-option=${option.value}
              title=${option.label}
              @click=${() => level.choose(option.value)}
            >
              ${option.label}
            </button>
          `,
        )}
      </div>
      ${ownReason(level) ? html`<div class="hint">${ownReason(level)}</div>` : nothing}
    </div>
  `;
}

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

function renderStepper(stepper: SoundStepper, prefix: string): TemplateResult {
  return html`
    <div class="stepper ${stepper.pending ? "pending" : ""}" role="group" aria-label=${stepper.label}>
      ${stepButton(stepper.less, `${prefix}-down`, stepper.locked)}
      <span class="stepper-value" aria-live="polite"> ${stepper.valueText} </span>
      ${stepButton(stepper.more, `${prefix}-up`, stepper.locked)}
    </div>
  `;
}

function renderAudioSync(sync: SoundStepper): TemplateResult {
  return html`
    <div class="section audio-sync">
      <div class="sound-row">
        <span class="sound-row-label">${sync.label}</span>
        ${renderStepper(sync, "sync")}
      </div>
      ${sync.hint ? html`<div class="hint">${sync.hint}</div>` : nothing}
    </div>
  `;
}

function renderEq(eq: SoundEq, offset: SoundBassOffset | undefined): TemplateResult {
  return html`
    <div class="section eq">
      <div class="section-title">
        <span>${eq.title}</span>
        ${eq.status
          ? html`<span class="badge eq-status ${badgeClass(eq.status)}" aria-live="polite">${eq.status.label}</span>`
          : nothing}
      </div>
      ${eq.reason ? html`<div class="hint eq-reason">${eq.reason}</div>` : nothing}
      ${eq.preset ? renderPreset(eq.preset) : nothing} ${eq.bands.length ? renderBands(eq) : nothing}
      ${offset ? renderBassOffset(offset) : nothing}
    </div>
  `;
}

function renderPreset(preset: SoundPreset): TemplateResult {
  const selectId = "sound-eq-preset";
  const onChange = (ev: Event): void => {
    const select = ev.target as HTMLSelectElement;
    if (!preset.select(select.value)) select.value = preset.shown ?? "";
  };
  return html`
    <div class="eq-preset-row">
      <div class="field eq-preset">
        <label for=${selectId}>${preset.label}</label>
        <select
          id=${selectId}
          class="select ${preset.pending ? "pending" : ""}"
          ?disabled=${!preset.enabled}
          aria-busy=${preset.busy ? "true" : "false"}
          .value=${live(preset.shown ?? "")}
          @change=${onChange}
        >
          ${preset.placeholder !== undefined ? html`<option value="" disabled selected>${preset.placeholder}</option>` : nothing}
          ${preset.options.map(
            (option) => html`<option value=${option.value} ?selected=${option.selected}>${option.label}</option>`,
          )}
        </select>
      </div>
      ${preset.reset
        ? html`<button class="btn small eq-reset" ?disabled=${!preset.reset.enabled} @click=${() => preset.reset!.run()}>
            ${preset.reset.label}
          </button>`
        : nothing}
    </div>
  `;
}

function renderBands(eq: SoundEq): TemplateResult {
  return html`
    <div class="eq-bands" role="group" aria-label=${eq.title}>
      ${eq.bands.map(
        (band) => html`
          <div class="eq-band ${band.pending ? "pending" : ""}">
            <span class="eq-value">${band.shortText}</span>
            <span class="eq-track">
              <input
                class="slider eq-slider"
                type="range"
                aria-orientation="vertical"
                data-band=${band.index}
                min=${band.min}
                max=${band.max}
                step=${band.step}
                .value=${live(String(band.position))}
                ?disabled=${!band.enabled}
                aria-label=${band.ariaLabel}
                aria-valuetext=${band.valueText}
                @input=${(ev: Event) => band.preview(Number((ev.target as HTMLInputElement).value))}
                @change=${(ev: Event) => band.commit(Number((ev.target as HTMLInputElement).value))}
              />
            </span>
            <span class="eq-freq">${band.label}</span>
          </div>
        `,
      )}
    </div>
  `;
}

function renderBassOffset(offset: SoundBassOffset): TemplateResult {
  return html`
    <div class="bass-offset">
      <div class="sound-row">
        <span class="sound-row-label">
          <span>${offset.label}</span>
          ${offset.status
            ? html`<span class="badge offset-status ${badgeClass(offset.status)}">${offset.status.label}</span>`
            : nothing}
        </span>
        ${renderStepper(offset, "offset")}
      </div>
      ${offset.error ? html`<div class="hint warn-text offset-error">${offset.error}</div>` : nothing}
    </div>
  `;
}

/** Styles of the classic layout (its selectors predate the .sound-<layout> prefix rule and stay as they are). */
export const soundClassicStyles = css`
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
