import { css, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import type { TabContext } from "../../types";
import type {
  ClockSection,
  ComposeModel,
  MessageView,
  MessagesSection,
  RecentModel,
  StartModel,
  TimerFormModel,
  TimerView,
  TimersModel,
  TimersSection,
} from "../timers-model";

/**
 * The "classic" layout of the Timers tab: three stacked sections (timers, messages, clock).
 * It only renders the model (../timers-model); every decision lives there.
 *
 * Countdowns are drawn by <jbl-bar-countdown> elements that repaint themselves once a second,
 * so the card is NOT re-rendered every second (no ctx.wantTick()).
 */
export function renderClassic(ctx: TabContext, model: TimersModel): TemplateResult {
  return html`
    <div class="timers">
      ${model.timers ? renderTimers(ctx, model.timers) : nothing} ${model.messages ? renderMessages(ctx, model.messages) : nothing}
      ${model.clock ? renderClock(model.clock) : nothing}
    </div>
  `;
}

const pendingClass = (pending: boolean): string => (pending ? "pending" : "");

/* ---------------- Timers ---------------- */

function renderTimers(ctx: TabContext, section: TimersSection): TemplateResult {
  const { timers, stopAll } = section;
  return html`
    <div class="section timers-list">
      <div class="section-title">
        <span class="title-count">${section.title}${timers.length ? html`<span class="badge">${timers.length}</span>` : nothing}</span>
        ${stopAll
          ? html`<button class="btn small ghost ${pendingClass(stopAll.pending)}" ?disabled=${!stopAll.enabled} @click=${stopAll.run}>
              ${stopAll.label}
            </button>`
          : nothing}
      </div>
      ${!section.available
        ? html`<div class="hint">${section.unavailableText}</div>`
        : timers.length
          ? html`<div class="list">${repeat(timers, (timer) => timer.id, renderTimer)}</div>`
          : html`<div class="hint">${section.emptyText}</div>`}
      ${section.start ? renderStart(ctx, section.start) : nothing} ${section.recent ? renderRecent(ctx, section.recent) : nothing}
    </div>
  `;
}

function renderTimer(timer: TimerView): TemplateResult {
  const { cancel, extend } = timer;
  if (timer.ringing) {
    return html`
      <div class="list-item timer ringing" role="alert">
        <ha-icon class="t-icon bell" .icon=${"mdi:bell-ring"}></ha-icon>
        <div class="grow">
          <div class="t-name">${timer.name}</div>
          <div class="t-meta">${timer.ringingText}</div>
        </div>
        <button
          class="btn danger filled stop ${pendingClass(cancel.pending)}"
          ?disabled=${!cancel.enabled}
          aria-label=${cancel.ariaLabel}
          @click=${cancel.run}
        >
          <ha-icon .icon=${cancel.icon}></ha-icon>${cancel.label}
        </button>
      </div>
    `;
  }

  return html`
    <div class="list-item timer">
      <ha-icon class="t-icon" .icon=${"mdi:timer-outline"}></ha-icon>
      <div class="grow">
        <div class="t-head">
          <span class="t-name">${timer.name}</span>
          <jbl-bar-countdown class="t-left" .kind=${"text"} .endsAt=${timer.endsAt}></jbl-bar-countdown>
        </div>
        ${timer.progressTotal !== null
          ? html`<jbl-bar-countdown class="t-progress" .kind=${"progress"} .total=${timer.progressTotal} .endsAt=${timer.endsAt}
              aria-label=${timer.name}></jbl-bar-countdown>`
          : nothing}
        <div class="t-meta">
          ${timer.endsAtLabel !== undefined ? html`<span>${timer.endsAtLabel}</span>` : nothing}
          <ha-icon class="meta-icon" .icon=${timer.sound.icon} title=${timer.sound.label} aria-label=${timer.sound.label}></ha-icon>
          ${timer.countdownOnBar
            ? html`<ha-icon
                class="meta-icon"
                .icon=${timer.countdownOnBar.icon}
                title=${timer.countdownOnBar.label}
                aria-label=${timer.countdownOnBar.label}
              ></ha-icon>`
            : nothing}
        </div>
      </div>
      ${extend
        ? html`<button
            class="btn small extend ${pendingClass(extend.pending)}"
            ?disabled=${!extend.enabled}
            aria-label=${extend.ariaLabel}
            title=${extend.ariaLabel}
            @click=${extend.run}
          >
            ${extend.label}
          </button>`
        : nothing}
      <button
        class="icon-btn plain cancel ${pendingClass(cancel.pending)}"
        ?disabled=${!cancel.enabled}
        aria-label=${cancel.ariaLabel}
        title=${cancel.ariaLabel}
        @click=${cancel.run}
      >
        <ha-icon .icon=${cancel.icon}></ha-icon>
      </button>
    </div>
  `;
}

function renderStart(ctx: TabContext, start: StartModel): TemplateResult {
  const { form } = start;
  return html`
    <div class="start">
      <div class="row quick" role="group" aria-label=${start.label}>
        ${start.quick.map(
          (quick) => html`<button
            class="btn quick-btn ${pendingClass(quick.pending)}"
            ?disabled=${!quick.enabled}
            aria-label=${quick.ariaLabel}
            @click=${quick.run}
          >
            ${quick.label}
          </button>`,
        )}
        <button class="btn quick-btn custom ${form.open ? "primary" : ""}" aria-expanded=${String(form.open)} @click=${form.toggle}>
          ${form.toggleLabel}
        </button>
      </div>
      ${form.open ? renderTimerForm(form) : nothing} ${ctx.renderError(start.errorKey)}
    </div>
  `;
}

function renderTimerForm(form: TimerFormModel): TemplateResult {
  const { name, minutes, submit } = form;
  return html`
    <form
      class="timer-form form"
      novalidate
      @submit=${(ev: Event) => {
        ev.preventDefault();
        void form.submitForm();
      }}
    >
      <div class="field">
        <label for=${name.id}>${name.label}</label>
        <input
          id=${name.id}
          type="text"
          maxlength=${name.max}
          autocomplete="off"
          .value=${live(name.value)}
          @input=${(ev: Event) => name.set((ev.target as HTMLInputElement).value)}
        />
        <div class="hint ${form.nameHint.warn ? "warn-text" : ""}">${form.nameHint.text}</div>
      </div>
      <div class="form-row">
        <div class="field minutes">
          <label for=${minutes.id}>${minutes.label}</label>
          <input
            id=${minutes.id}
            type="number"
            inputmode="numeric"
            min=${minutes.min}
            max=${minutes.max}
            step="1"
            .value=${live(minutes.value)}
            @input=${(ev: Event) => minutes.set((ev.target as HTMLInputElement).value)}
          />
        </div>
        <div class="field grow">
          <label id="timers-sound-label">${form.soundLabel}</label>
          <div class="seg" role="radiogroup" aria-labelledby="timers-sound-label">
            ${form.sounds.map(
              (sound) => html`<button
                type="button"
                role="radio"
                aria-checked=${String(sound.selected)}
                class=${sound.selected ? "active" : ""}
                title=${sound.title}
                @click=${sound.select}
              >
                ${sound.label}
              </button>`,
            )}
          </div>
        </div>
      </div>
      <div class="chips">
        <button
          type="button"
          class="chip ${form.showLeft.on ? "on" : ""}"
          role="switch"
          aria-checked=${String(form.showLeft.on)}
          @click=${form.showLeft.toggle}
        >
          <ha-icon .icon=${form.showLeft.icon}></ha-icon><span>${form.showLeft.label}</span>
          <span class="switch-knob" aria-hidden="true"></span>
        </button>
      </div>
      <div class="row actions">
        <button type="button" class="btn ghost" @click=${form.close}>
          ${form.closeLabel}
        </button>
        <button type="submit" class="btn primary ${pendingClass(submit.pending)}" ?disabled=${!submit.enabled}>
          <ha-icon .icon=${submit.icon}></ha-icon>${submit.label}
        </button>
      </div>
    </form>
  `;
}

/* ---------------- Recent timers / messages ---------------- */

function renderRecent(ctx: TabContext, recent: RecentModel): TemplateResult {
  return html`
    <div class="recent recent-${recent.kind}s">
      <div class="sub-title">${recent.title}</div>
      <div class="chips">
        ${repeat(
          recent.chips,
          (chip) => chip.id,
          (chip) => html`<span class="recent-chip ${pendingClass(chip.busy)}">
            <button
              class="chip restart"
              ?disabled=${!chip.restart.enabled}
              aria-busy=${chip.busy ? "true" : "false"}
              title=${chip.restart.ariaLabel}
              aria-label=${chip.restart.ariaLabel}
              @click=${chip.restart.run}
              @pointerdown=${chip.press.onPointerDown}
              @pointerup=${chip.press.onPointerEnd}
              @pointerleave=${chip.press.onPointerEnd}
              @pointercancel=${chip.press.onPointerEnd}
              @contextmenu=${chip.press.onContextMenu}
            >
              <ha-icon .icon=${chip.restart.icon}></ha-icon><span>${chip.label}</span>
            </button>
            <button
              class="forget"
              aria-busy=${chip.busy ? "true" : "false"}
              title=${chip.forget.ariaLabel}
              aria-label=${chip.forget.ariaLabel}
              @click=${chip.forget.run}
            >
              <ha-icon .icon=${chip.forget.icon}></ha-icon>
            </button>
          </span>`,
        )}
      </div>
      ${ctx.renderError(recent.errorKeys)}
      <div class="hint">${recent.hint}</div>
    </div>
  `;
}

/* ---------------- Messages ---------------- */

function renderMessages(ctx: TabContext, section: MessagesSection): TemplateResult {
  const { messages, clearAll } = section;
  return html`
    <div class="section messages">
      <div class="section-title">
        <span class="title-count">${section.title}${messages.length ? html`<span class="badge">${messages.length}</span>` : nothing}</span>
        ${clearAll
          ? html`<button
              class="btn small ghost clear-all ${pendingClass(clearAll.pending)}"
              ?disabled=${!clearAll.enabled}
              @click=${clearAll.run}
            >
              ${clearAll.label}
            </button>`
          : nothing}
      </div>
      ${!section.available
        ? html`<div class="hint">${section.unavailableText}</div>`
        : messages.length
          ? html`<div class="list">${repeat(messages, (message) => message.id, renderMessage)}</div>`
          : html`<div class="hint">${section.emptyText}</div>`}
      ${section.compose ? renderCompose(ctx, section.compose) : nothing} ${section.recent ? renderRecent(ctx, section.recent) : nothing}
    </div>
  `;
}

function renderMessage(message: MessageView): TemplateResult {
  const { clear, length } = message;
  const length_ =
    length.kind === "until"
      ? html`${length.text} ·
          <jbl-bar-countdown class="m-left" .kind=${"text"} .endsAt=${length.endsAt}></jbl-bar-countdown>`
      : length.text;
  return html`
    <div class="list-item message ${message.showing ? "showing" : ""}">
      <ha-icon class="t-icon" .icon=${message.icon}></ha-icon>
      <div class="grow">
        <div class="m-head">
          <span class="m-text">${message.label}</span>
          ${message.name ? html`<span class="m-id muted">(${message.name})</span>` : nothing}
        </div>
        <div class="t-meta">
          <span class="badge ${message.status.kind === "showing" ? "info" : ""}">${message.status.text}</span>
          ${length_ ? html`<span class="m-length">${length_}</span>` : nothing}
          ${message.whenOnText ? html`<span>· ${message.whenOnText}</span>` : nothing}
        </div>
      </div>
      <button
        class="icon-btn plain clear ${pendingClass(clear.pending)}"
        ?disabled=${!clear.enabled}
        aria-label=${clear.ariaLabel}
        title=${clear.ariaLabel}
        @click=${clear.run}
      >
        <ha-icon .icon=${clear.icon}></ha-icon>
      </button>
    </div>
  `;
}

function renderCompose(ctx: TabContext, compose: ComposeModel): TemplateResult {
  const { text, counter, repeat: rep, duration, clearOnKey, whenOn, send } = compose;
  return html`
    <form
      class="compose form"
      novalidate
      @submit=${(ev: Event) => {
        ev.preventDefault();
        void compose.sendForm();
      }}
    >
      <div class="sub-title">${compose.title}</div>
      <div class="field">
        <div class="label-row">
          <label for=${text.id}>${text.label}</label>
          <span id=${counter.id} class="counter ${counter.warn ? "warn-text" : ""}">${counter.text}</span>
        </div>
        <input
          id=${text.id}
          type="text"
          maxlength=${text.max}
          autocomplete="off"
          placeholder=${text.placeholder}
          aria-describedby=${counter.id}
          aria-invalid=${compose.invalid ? "true" : "false"}
          .value=${live(text.value)}
          @input=${(ev: Event) => text.set((ev.target as HTMLInputElement).value)}
        />
      </div>
      <div class="lcd ${compose.previewEmpty ? "empty" : ""}" role="img" aria-label=${compose.previewLabel} title=${compose.previewLabel}>${compose.preview}</div>
      ${compose.warning ? html`<div class="hint warn-text">${compose.warning}</div>` : nothing}
      <div class="sr-only" role="status">
        ${compose.liveStatus}
      </div>
      <div class="seg mode" role="radiogroup" aria-label=${compose.modeLabel}>
        ${compose.modes.map(
          (mode) => html`<button
            type="button"
            role="radio"
            aria-checked=${String(mode.selected)}
            class=${mode.selected ? "active" : ""}
            title=${mode.title}
            @click=${mode.select}
          >
            ${mode.label}
          </button>`,
        )}
      </div>
      ${compose.mode === "repeat"
        ? html`<div class="row mode-detail">
            <div class="stepper">
              <button type="button" ?disabled=${!rep.less.enabled} aria-label=${rep.less.ariaLabel} title=${rep.less.reason ?? rep.less.ariaLabel} @click=${rep.less.run}>
                <ha-icon .icon=${rep.less.icon}></ha-icon>
              </button>
              <span class="stepper-value repeat-value">${rep.label}</span>
              <button type="button" ?disabled=${!rep.more.enabled} aria-label=${rep.more.ariaLabel} title=${rep.more.reason ?? rep.more.ariaLabel} @click=${rep.more.run}>
                <ha-icon .icon=${rep.more.icon}></ha-icon>
              </button>
            </div>
          </div>`
        : compose.mode === "duration"
          ? html`<div class="row mode-detail">
              <label class="muted" for=${duration.id}>${duration.label}</label>
              <select id=${duration.id} class="select" @change=${(ev: Event) => duration.set(Number((ev.target as HTMLSelectElement).value))}>
                ${duration.options.map((option) => html`<option value=${option.value} ?selected=${option.selected}>${option.label}</option>`)}
              </select>
            </div>`
          : nothing}
      <div class="chips">
        <button
          type="button"
          class="chip ${clearOnKey.on ? "on" : ""}"
          role="switch"
          aria-checked=${String(clearOnKey.on)}
          @click=${clearOnKey.toggle}
        >
          <ha-icon .icon=${clearOnKey.icon}></ha-icon><span>${clearOnKey.label}</span>
          <span class="switch-knob" aria-hidden="true"></span>
        </button>
        ${whenOn
          ? html`<button
              type="button"
              class="chip when-on ${whenOn.on ? "on" : ""}"
              role="switch"
              aria-checked=${String(whenOn.on)}
              title=${whenOn.hint ?? ""}
              @click=${whenOn.toggle}
            >
              <ha-icon .icon=${whenOn.icon}></ha-icon><span>${whenOn.label}</span>
              <span class="switch-knob" aria-hidden="true"></span>
            </button>`
          : nothing}
      </div>
      ${compose.whenOnHint ? html`<div class="hint">${compose.whenOnHint}</div>` : nothing} ${ctx.renderError(compose.errorKey)}
      <div class="row actions">
        <button
          type="submit"
          class="btn primary send ${pendingClass(send.pending)}"
          ?disabled=${!send.enabled}
          aria-busy=${send.pending ? "true" : "false"}
        >
          <ha-icon .icon=${send.icon}></ha-icon>${send.label}
        </button>
      </div>
    </form>
  `;
}

/* ---------------- Clock ---------------- */

function renderClock(clock: ClockSection): TemplateResult {
  const { toggle, when } = clock;
  return html`
    <div class="section clock">
      <div class="section-title">${clock.title}</div>
      <div class="chips">
        <button
          class="chip clock-switch ${toggle.on ? "on" : ""} ${pendingClass(toggle.pending)}"
          role="switch"
          aria-checked=${String(toggle.on)}
          ?disabled=${!toggle.enabled}
          title=${toggle.reason ?? nothing}
          @click=${toggle.run}
        >
          <ha-icon .icon=${toggle.icon}></ha-icon><span>${toggle.label}</span>
          <span class="switch-knob" aria-hidden="true"></span>
        </button>
      </div>
      ${when
        ? html`<div class="clock-when">
            <span class="muted" id="timers-clock-when">${when.label}</span>
            <div class="seg" role="radiogroup" aria-labelledby="timers-clock-when">
              ${when.options.map(
                (option) => html`<button
                  role="radio"
                  aria-checked=${String(option.checked)}
                  class="${option.selected ? "active" : ""} ${pendingClass(option.pending)}"
                  ?disabled=${!option.enabled}
                  title=${option.reason ?? option.title}
                  @click=${option.select}
                >
                  ${option.label}
                </button>`,
              )}
            </div>
          </div>`
        : nothing}
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Styles (every selector is scoped by .timers, the classic root)       */
/* ------------------------------------------------------------------ */

export const classicStyles = css`
  .timers .title-count {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .timers .sub-title {
    font-size: 0.8rem;
    color: var(--jbl-muted);
    font-weight: 500;
  }
  .timers .t-icon {
    color: var(--jbl-muted);
    flex: none;
  }
  .timers .t-head,
  .timers .m-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .timers .t-name,
  .timers .m-text {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1 1 auto;
  }
  .timers .m-id {
    flex: none;
    font-size: 0.8rem;
  }
  .timers .t-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 6px;
    font-size: 0.8rem;
    color: var(--jbl-muted);
    margin-top: 2px;
  }
  .timers .meta-icon {
    --mdc-icon-size: 14px;
  }
  jbl-bar-countdown.t-left {
    flex: none;
    font-size: 1.15rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  jbl-bar-countdown.m-left {
    font-variant-numeric: tabular-nums;
  }
  jbl-bar-countdown.t-progress {
    display: block;
    height: 4px;
    margin-top: 4px;
    border-radius: 2px;
    background: rgba(var(--jbl-accent-rgb), 0.15);
    overflow: hidden;
  }
  jbl-bar-countdown.t-progress > .fill {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--jbl-accent);
    transition: width 1s linear;
  }
  .timers .timer.ringing {
    background: rgba(var(--jbl-accent-rgb), 0.14);
    box-shadow: inset 0 0 0 1px var(--jbl-accent);
  }
  .timers .timer.ringing .t-icon,
  .timers .timer.ringing .t-meta {
    color: var(--jbl-accent-text);
    font-weight: 500;
  }
  .timers .bell {
    animation: jbl-ring 1.2s ease-in-out infinite;
    transform-origin: 50% 10%;
  }
  @keyframes jbl-ring {
    0%,
    60%,
    100% {
      transform: rotate(0);
    }
    10%,
    30%,
    50% {
      transform: rotate(14deg);
    }
    20%,
    40% {
      transform: rotate(-14deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .timers .bell {
      animation: none;
    }
  }
  .timers .btn ha-icon {
    --mdc-icon-size: 18px;
  }
  .timers .extend,
  .timers .stop {
    flex: none;
    white-space: nowrap;
  }
  .timers .start {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
  }
  .timers .quick {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
  }
  .timers .quick-btn {
    padding: 7px 4px;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .timers .form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .timers .timer-form {
    padding: 10px;
    border: 1px solid var(--jbl-border);
    border-radius: var(--jbl-radius-sm);
  }
  .timers .form-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: flex-end;
  }
  .timers .form-row .minutes {
    width: 84px;
    flex: none;
  }
  .timers .form-row .grow {
    flex: 1 1 180px;
  }
  .timers .field input[type="text"],
  .timers .field input[type="number"] {
    width: 100%;
  }
  .timers .actions {
    justify-content: flex-end;
  }
  .timers .label-row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .timers .label-row > label,
  .timers .counter {
    font-size: 0.8rem;
    color: var(--jbl-muted);
  }
  .timers .counter {
    font-variant-numeric: tabular-nums;
  }
  .timers .counter.warn-text {
    color: var(--jbl-text);
  }
  .timers .compose {
    margin-top: 4px;
  }
  .timers .lcd {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    letter-spacing: 0.08em;
    background: #111;
    color: #ff8a50;
    border-radius: var(--jbl-radius-sm);
    padding: 8px 10px;
    min-height: 1.3em;
    white-space: pre;
    overflow-x: auto;
    text-shadow: 0 0 6px rgba(255, 120, 60, 0.45);
  }
  .timers .lcd.empty {
    opacity: 0.4;
  }
  .timers .mode-detail {
    justify-content: flex-start;
  }
  .timers .repeat-value {
    min-width: 84px;
  }
  .timers .recent {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
  }
  .timers .recent-chip {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    border: 1px solid var(--jbl-border);
    border-radius: 999px;
    background: var(--jbl-card-bg);
    box-sizing: border-box;
  }
  .timers .recent-chip .chip {
    border: 0;
    background: transparent;
    min-width: 0;
    padding-right: 4px;
    -webkit-touch-callout: none;
    user-select: none;
  }
  .timers .recent-chip .forget {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 28px;
    height: 28px;
    margin-right: 3px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--jbl-muted);
    cursor: pointer;
  }
  .timers .recent-chip .forget:hover {
    background: var(--jbl-surface);
  }
  .timers .recent-chip .forget ha-icon {
    --mdc-icon-size: 16px;
  }
  .timers .clock-when {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.85rem;
  }
  @container (max-width: 340px) {
    .timers .t-icon {
      display: none;
    }
    .timers .quick {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .timers .quick .custom {
      grid-column: 1 / -1;
    }
  }
`;
