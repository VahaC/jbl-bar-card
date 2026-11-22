import { css, html, nothing, unsafeCSS } from "lit";
import type { TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
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
 * The "kitchen" layout of the Timers tab: focus on the next timer.
 *
 * - Hero: the timer that ends first (or the ringing one, in the alarm colour with a big Stop
 *   button) as a large circular countdown with a progress ring; +1 min and cancel under it.
 *   Other timers follow as a compact list.
 * - Quick start: big round 1 / 5 / 10 / 15 min buttons and "Custom" (the model's custom form).
 * - Recent timers as chips (tap restart, long-press / × / right-click forget).
 * - Messages and the display clock in a collapsible "Display" section, collapsed by default.
 *
 * It only renders the model (../timers-model); every decision lives there. Countdowns and the
 * ring are <jbl-bar-countdown> elements that repaint themselves, so the card never ticks.
 */
export function renderKitchen(ctx: TabContext, model: TimersModel): TemplateResult {
  return html`<div class="timers-kitchen">
    ${model.timers ? renderTimers(ctx, model.timers) : nothing} ${renderDisplay(ctx, model.messages, model.clock)}
  </div>`;
}

const pendingClass = (pending: boolean): string => (pending ? "pending" : "");

/**
 * True when the countdown shows hours ("11:59:59"), so the dial uses a smaller font that keeps
 * eight characters inside the ring. Checked at render time; a timer that drops under an hour keeps
 * the smaller font until the next render, which is harmless.
 */
const showsHours = (timer: TimerView): boolean =>
  (timer.progressTotal ?? 0) >= 3600 || (timer.endsAt !== null && timer.endsAt - Date.now() >= 3_600_000);
const spinner = (pending: boolean): TemplateResult | typeof nothing =>
  pending ? html`<span class="spinner" aria-hidden="true"></span>` : nothing;

/**
 * The reasons of the disabled actions, once each, as visible text. `skip` drops reasons that are
 * already on screen (a form warning).
 */
function reasons(actions: ({ enabled: boolean; reason?: string } | undefined)[], skip: (string | undefined)[] = []): TemplateResult | typeof nothing {
  const seen = new Set<string>();
  for (const action of actions) {
    if (action && !action.enabled && action.reason && !skip.includes(action.reason)) seen.add(action.reason);
  }
  return seen.size
    ? html`<div class="k-reason hint"><ha-icon .icon=${"mdi:information-outline"}></ha-icon><span>${[...seen].join(" ")}</span></div>`
    : nothing;
}

/* ---------------- Timers: hero, others, quick start, recent ---------------- */

function renderTimers(ctx: TabContext, section: TimersSection): TemplateResult {
  const [hero, ...others] = section.timers;
  const { stopAll } = section;
  return html`
    <section class="k-timers" aria-label=${section.title}>
      <div class="k-head">
        <span class="k-title">${section.title}${section.timers.length ? html`<span class="badge">${section.timers.length}</span>` : nothing}</span>
        ${stopAll
          ? html`<button
              class="btn small ghost k-stop-all ${pendingClass(stopAll.pending)}"
              ?disabled=${!stopAll.enabled}
              aria-busy=${stopAll.pending ? "true" : "false"}
              @click=${stopAll.run}
            >
              <ha-icon .icon=${stopAll.icon}></ha-icon>${stopAll.label}
            </button>`
          : nothing}
      </div>
      ${!section.available
        ? html`<div class="hint k-unavailable">${section.unavailableText}</div>`
        : hero
          ? html`${keyed(hero.id, renderHero(ctx, hero))}${others.length ? renderOthers(ctx, others) : nothing}`
          : renderIdle(ctx, section)}
      ${reasons([stopAll])}
      ${section.start ? renderStart(ctx, section.start) : nothing} ${section.recent ? renderRecent(ctx, section.recent, "k-recent-timers") : nothing}
    </section>
  `;
}

function renderIdle(ctx: TabContext, section: TimersSection): TemplateResult {
  return html`<div class="k-hero k-idle">
    <div class="k-dial idle" aria-hidden="true">
      <span class="k-ring-static"></span>
      <ha-icon class="k-idle-icon" .icon=${"mdi:timer-outline"}></ha-icon>
    </div>
    <div class="k-idle-text">${section.emptyText}</div>
    ${section.start ? html`<div class="hint">${ctx.t("timers_kitchen.idle_hint")}</div>` : nothing}
  </div>`;
}

function renderHero(ctx: TabContext, timer: TimerView): TemplateResult {
  const { cancel, extend } = timer;
  if (timer.ringing) {
    return html`<div class="k-hero ringing" role="alert">
      <div class="k-hero-name">${timer.name}</div>
      <div class="k-dial ringing">
        <span class="k-ring-static" aria-hidden="true"></span>
        <div class="k-center">
          <ha-icon class="k-bell" .icon=${"mdi:bell-ring"} aria-hidden="true"></ha-icon>
          <div class="k-ring-text">${timer.ringingText}</div>
        </div>
      </div>
      <button
        class="btn danger filled k-stop ${pendingClass(cancel.pending)}"
        ?disabled=${!cancel.enabled}
        aria-label=${cancel.ariaLabel}
        aria-busy=${cancel.pending ? "true" : "false"}
        @click=${cancel.run}
      >
        ${cancel.pending ? spinner(true) : html`<ha-icon .icon=${cancel.icon}></ha-icon>`}${cancel.label}
      </button>
      ${reasons([cancel])}
    </div>`;
  }

  return html`<div class="k-hero">
    <div class="k-eyebrow">${ctx.t("timers_kitchen.next")}</div>
    <div class="k-hero-name">${timer.name}</div>
    <div class="k-dial">
      ${timer.progressTotal !== null
        ? html`<jbl-bar-countdown
            class="k-ring"
            .kind=${"progress"}
            .total=${timer.progressTotal}
            .endsAt=${timer.endsAt}
            aria-label=${timer.name}
          ></jbl-bar-countdown>`
        : html`<span class="k-ring-static" aria-hidden="true"></span>`}
      <div class="k-center">
        <jbl-bar-countdown class="k-time ${showsHours(timer) ? "hours" : ""}" .kind=${"text"} .endsAt=${timer.endsAt}></jbl-bar-countdown>
        ${timer.endsAtLabel !== undefined ? html`<div class="k-ends">${timer.endsAtLabel}</div>` : nothing}
        <div class="k-meta">
          <ha-icon .icon=${timer.sound.icon} title=${timer.sound.label} aria-label=${timer.sound.label} role="img"></ha-icon>
          ${timer.countdownOnBar
            ? html`<ha-icon
                .icon=${timer.countdownOnBar.icon}
                title=${timer.countdownOnBar.label}
                aria-label=${timer.countdownOnBar.label}
                role="img"
              ></ha-icon>`
            : nothing}
        </div>
      </div>
    </div>
    <div class="k-hero-actions">
      ${extend
        ? html`<button
            class="btn k-extend ${pendingClass(extend.pending)}"
            ?disabled=${!extend.enabled}
            aria-label=${extend.ariaLabel}
            title=${extend.ariaLabel}
            aria-busy=${extend.pending ? "true" : "false"}
            @click=${extend.run}
          >
            ${spinner(extend.pending)}${extend.label}
          </button>`
        : nothing}
      <button
        class="btn k-cancel ${pendingClass(cancel.pending)}"
        ?disabled=${!cancel.enabled}
        aria-label=${cancel.ariaLabel}
        title=${cancel.ariaLabel}
        aria-busy=${cancel.pending ? "true" : "false"}
        @click=${cancel.run}
      >
        ${cancel.pending ? spinner(true) : html`<ha-icon .icon=${cancel.icon}></ha-icon>`}${cancel.label}
      </button>
    </div>
    ${reasons([cancel, extend])}
  </div>`;
}

function renderOthers(ctx: TabContext, others: TimerView[]): TemplateResult {
  return html`<div class="k-others">
    <div class="k-sub">${ctx.t("timers_kitchen.also_running")}</div>
    <ul class="k-list">
      ${repeat(others, (timer) => timer.id, renderOther)}
    </ul>
    ${reasons(others.flatMap((timer) => [timer.cancel, timer.extend]))}
  </div>`;
}

function renderOther(timer: TimerView): TemplateResult {
  const { cancel, extend } = timer;
  if (timer.ringing) {
    return html`<li class="k-row ringing">
      <ha-icon class="k-row-icon k-bell" .icon=${"mdi:bell-ring"} aria-hidden="true"></ha-icon>
      <div class="k-row-main" role="alert">
        <span class="k-row-name">${timer.name}</span>
        <span class="k-row-ring">${timer.ringingText}</span>
      </div>
      <button
        class="btn small danger filled k-row-stop ${pendingClass(cancel.pending)}"
        ?disabled=${!cancel.enabled}
        aria-label=${cancel.ariaLabel}
        aria-busy=${cancel.pending ? "true" : "false"}
        @click=${cancel.run}
      >
        ${cancel.label}
      </button>
    </li>`;
  }
  return html`<li class="k-row">
    <div class="k-row-main">
      <div class="k-row-top">
        <span class="k-row-name">${timer.name}</span>
        <jbl-bar-countdown class="k-row-left" .kind=${"text"} .endsAt=${timer.endsAt}></jbl-bar-countdown>
      </div>
      ${timer.progressTotal !== null
        ? html`<jbl-bar-countdown
            class="k-row-bar"
            .kind=${"progress"}
            .total=${timer.progressTotal}
            .endsAt=${timer.endsAt}
            aria-label=${timer.name}
          ></jbl-bar-countdown>`
        : nothing}
    </div>
    ${extend
      ? html`<button
          class="btn small k-row-extend ${pendingClass(extend.pending)}"
          ?disabled=${!extend.enabled}
          aria-label=${extend.ariaLabel}
          title=${extend.ariaLabel}
          aria-busy=${extend.pending ? "true" : "false"}
          @click=${extend.run}
        >
          ${extend.label}
        </button>`
      : nothing}
    <button
      class="icon-btn plain k-row-cancel ${pendingClass(cancel.pending)}"
      ?disabled=${!cancel.enabled}
      aria-label=${cancel.ariaLabel}
      title=${cancel.ariaLabel}
      aria-busy=${cancel.pending ? "true" : "false"}
      @click=${cancel.run}
    >
      <ha-icon .icon=${cancel.icon}></ha-icon>
    </button>
  </li>`;
}

function renderStart(ctx: TabContext, start: StartModel): TemplateResult {
  const { form } = start;
  return html`<div class="k-start">
    <div class="k-sub">${start.label}</div>
    <div class="k-quick" role="group" aria-label=${start.label}>
      ${start.quick.map(
        (quick) => html`<button
          class="k-quick-btn ${pendingClass(quick.pending)}"
          ?disabled=${!quick.enabled}
          aria-label=${quick.ariaLabel}
          title=${quick.ariaLabel}
          aria-busy=${quick.pending ? "true" : "false"}
          @click=${quick.run}
        >
          <span class="k-disc">${quick.pending ? spinner(true) : ctx.formatNumber(quick.minutes)}</span>
          <span class="k-cap">${ctx.t("timers_kitchen.min")}</span>
        </button>`,
      )}
      <button
        class="k-quick-btn k-custom ${form.open ? "open" : ""}"
        aria-expanded=${String(form.open)}
        aria-controls=${form.open ? "k-timer-form" : nothing}
        aria-label=${form.toggleAriaLabel}
        title=${form.toggleAriaLabel}
        @click=${form.toggle}
      >
        <span class="k-disc"><ha-icon .icon=${form.toggleIcon}></ha-icon></span>
        <span class="k-cap">${form.toggleLabel}</span>
      </button>
    </div>
    ${reasons(start.quick)} ${form.open ? renderTimerForm(form) : nothing} ${ctx.renderError(start.errorKey)}
  </div>`;
}

function renderTimerForm(form: TimerFormModel): TemplateResult {
  const { name, minutes, submit } = form;
  return html`<form
    id="k-timer-form"
    class="k-form"
    novalidate
    @submit=${(ev: Event) => {
      ev.preventDefault();
      void form.submitForm();
    }}
  >
    <div class="k-form-row">
      <div class="field k-name">
        <label for=${name.id}>${name.label}</label>
        <input
          id=${name.id}
          type="text"
          maxlength=${name.max}
          autocomplete="off"
          aria-invalid=${form.badChars.length ? "true" : "false"}
          aria-describedby="k-name-hint"
          .value=${live(name.value)}
          @input=${(ev: Event) => name.set((ev.target as HTMLInputElement).value)}
        />
      </div>
      <div class="field k-minutes">
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
    </div>
    <div id="k-name-hint" class="hint k-name-hint ${form.nameHint.warn ? "warn-text" : ""}">${form.nameHint.text}</div>
    <div class="field">
      <span class="k-label" id="k-sound-label">${form.soundLabel}</span>
      <div class="seg" role="radiogroup" aria-labelledby="k-sound-label">
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
    <button
      type="button"
      class="chip k-show-left ${form.showLeft.on ? "on" : ""}"
      role="switch"
      aria-checked=${String(form.showLeft.on)}
      @click=${form.showLeft.toggle}
    >
      <ha-icon .icon=${form.showLeft.icon}></ha-icon><span>${form.showLeft.label}</span>
      <span class="switch-knob" aria-hidden="true"></span>
    </button>
    ${reasons([submit], [form.nameHint.text])}
    <div class="k-actions">
      <button type="button" class="btn ghost" @click=${form.close}>${form.closeLabel}</button>
      <button
        type="submit"
        class="btn primary k-submit ${pendingClass(submit.pending)}"
        ?disabled=${!submit.enabled}
        aria-busy=${submit.pending ? "true" : "false"}
      >
        ${submit.pending ? spinner(true) : html`<ha-icon .icon=${submit.icon}></ha-icon>`}${submit.label}
      </button>
    </div>
  </form>`;
}

/* ---------------- Recent chips (timers and messages) ---------------- */

function renderRecent(ctx: TabContext, recent: RecentModel, cls: string): TemplateResult {
  return html`<div class="k-recent ${cls}">
    <div class="k-sub"><ha-icon .icon=${recent.icon}></ha-icon>${recent.title}</div>
    <div class="k-chips">
      ${repeat(
        recent.chips,
        (chip) => chip.id,
        (chip) => html`<span class="k-chip ${pendingClass(chip.busy)}">
          <button
            class="k-chip-restart"
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
            ${chip.busy ? spinner(true) : html`<ha-icon .icon=${"mdi:play"}></ha-icon>`}<span>${chip.label}</span>
          </button>
          <button
            class="k-chip-forget"
            ?disabled=${!chip.forget.enabled}
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
    ${reasons(recent.chips.flatMap((chip) => [chip.restart, chip.forget]))} ${ctx.renderError(recent.errorKeys)}
    <div class="hint k-recent-hint">${recent.hint}</div>
  </div>`;
}

/* ---------------- Display: messages and clock, collapsed ---------------- */

function renderDisplay(ctx: TabContext, messages: MessagesSection | undefined, clock: ClockSection | undefined): TemplateResult | typeof nothing {
  if (!messages && !clock) return nothing;
  const { t } = ctx;
  const count = messages?.messages.length ?? 0;
  // A native <details>: the browser keeps it open or closed across renders (Lit never sets `open`).
  return html`<details class="k-display">
    <summary>
      <ha-icon class="k-display-icon" .icon=${"mdi:message-text-clock-outline"}></ha-icon>
      <span class="k-display-titles">
        <span class="k-display-title">${t("timers_kitchen.display")}</span>
        <span class="k-display-hint">${t("timers_kitchen.display_hint")}</span>
      </span>
      ${count
        ? html`<span class="badge info k-display-count" aria-hidden="true">${count}</span>
            <span class="sr-only">${t("timers_kitchen.messages_count", { count })}</span>`
        : nothing}
      <ha-icon class="k-chevron" .icon=${"mdi:chevron-down"} aria-hidden="true"></ha-icon>
    </summary>
    <div class="k-display-body">
      ${messages ? renderMessages(ctx, messages) : nothing} ${clock ? renderClock(clock) : nothing}
    </div>
  </details>`;
}

function renderMessages(ctx: TabContext, section: MessagesSection): TemplateResult {
  const { messages, clearAll } = section;
  return html`<div class="k-messages">
    <div class="k-head">
      <span class="k-title small">${section.title}</span>
      ${clearAll
        ? html`<button
            class="btn small ghost k-clear-all ${pendingClass(clearAll.pending)}"
            ?disabled=${!clearAll.enabled}
            aria-busy=${clearAll.pending ? "true" : "false"}
            @click=${clearAll.run}
          >
            <ha-icon .icon=${clearAll.icon}></ha-icon>${clearAll.label}
          </button>`
        : nothing}
    </div>
    ${!section.available
      ? html`<div class="hint">${section.unavailableText}</div>`
      : messages.length
        ? html`<ul class="k-list">
            ${repeat(messages, (message) => message.id, renderMessage)}
          </ul>`
        : html`<div class="hint">${section.emptyText}</div>`}
    ${reasons([clearAll, ...messages.map((message) => message.clear)])}
    ${section.compose ? renderCompose(ctx, section.compose) : nothing} ${section.recent ? renderRecent(ctx, section.recent, "k-recent-messages") : nothing}
  </div>`;
}

function renderMessage(message: MessageView): TemplateResult {
  const { clear, length } = message;
  return html`<li class="k-row k-message ${message.showing ? "showing" : ""}">
    <ha-icon class="k-row-icon" .icon=${message.icon}></ha-icon>
    <div class="k-row-main">
      <div class="k-row-top">
        <span class="k-row-name k-msg-text">${message.label}</span>
        ${message.name ? html`<span class="muted k-msg-id">(${message.name})</span>` : nothing}
      </div>
      <div class="k-row-meta">
        <span class="badge ${message.status.kind === "showing" ? "info" : ""}">${message.status.text}</span>
        ${length.kind === "until"
          ? html`<span>${length.text} · <jbl-bar-countdown class="k-msg-left" .kind=${"text"} .endsAt=${length.endsAt}></jbl-bar-countdown></span>`
          : length.text
            ? html`<span>${length.text}</span>`
            : nothing}
        ${message.whenOnText ? html`<span>· ${message.whenOnText}</span>` : nothing}
      </div>
    </div>
    <button
      class="icon-btn plain k-msg-clear ${pendingClass(clear.pending)}"
      ?disabled=${!clear.enabled}
      aria-label=${clear.ariaLabel}
      title=${clear.ariaLabel}
      aria-busy=${clear.pending ? "true" : "false"}
      @click=${clear.run}
    >
      <ha-icon .icon=${clear.icon}></ha-icon>
    </button>
  </li>`;
}

function renderCompose(ctx: TabContext, compose: ComposeModel): TemplateResult {
  const { text, counter, repeat: rep, duration, clearOnKey, whenOn, send } = compose;
  return html`<form
    class="k-compose"
    novalidate
    @submit=${(ev: Event) => {
      ev.preventDefault();
      void compose.sendForm();
    }}
  >
    <div class="k-sub">${compose.title}</div>
    <div class="k-lcd ${compose.previewEmpty ? "empty" : ""}" role="img" aria-label=${compose.previewLabel} title=${compose.previewLabel}>${compose.preview}</div>
    <div class="field">
      <div class="k-label-row">
        <label for=${text.id}>${text.label}</label>
        <span id=${counter.id} class="k-counter ${counter.warn ? "warn-text" : ""}">${counter.text}</span>
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
    ${compose.warning ? html`<div class="hint warn-text k-warning">${compose.warning}</div>` : nothing}
    <div class="sr-only" role="status">${compose.liveStatus}</div>
    <div class="seg k-modes" role="radiogroup" aria-label=${compose.modeLabel}>
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
      ? html`<div class="k-mode-detail">
          <div class="stepper">
            <button type="button" ?disabled=${!rep.less.enabled} aria-label=${rep.less.ariaLabel} title=${rep.less.ariaLabel} @click=${rep.less.run}>
              <ha-icon .icon=${rep.less.icon}></ha-icon>
            </button>
            <span class="stepper-value k-repeat-value" aria-live="polite">${rep.label}</span>
            <button type="button" ?disabled=${!rep.more.enabled} aria-label=${rep.more.ariaLabel} title=${rep.more.ariaLabel} @click=${rep.more.run}>
              <ha-icon .icon=${rep.more.icon}></ha-icon>
            </button>
          </div>
          ${reasons([rep.less, rep.more])}
        </div>`
      : compose.mode === "duration"
        ? html`<div class="k-mode-detail">
            <label class="muted" for=${duration.id}>${duration.label}</label>
            <select id=${duration.id} class="select" @change=${(ev: Event) => duration.set(Number((ev.target as HTMLSelectElement).value))}>
              ${duration.options.map((option) => html`<option value=${option.value} ?selected=${option.selected}>${option.label}</option>`)}
            </select>
          </div>`
        : nothing}
    <div class="chips">
      <button
        type="button"
        class="chip k-clear-on-key ${clearOnKey.on ? "on" : ""}"
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
            class="chip k-when-on ${whenOn.on ? "on" : ""}"
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
    ${compose.whenOnHint ? html`<div class="hint k-when-on-hint">${compose.whenOnHint}</div>` : nothing} ${ctx.renderError(compose.errorKey)}
    <div class="k-actions k-send-row">
      ${reasons([send], [compose.warning])}
      <button type="submit" class="btn primary k-send ${pendingClass(send.pending)}" ?disabled=${!send.enabled} aria-busy=${send.pending ? "true" : "false"}>
        ${send.pending ? spinner(true) : html`<ha-icon .icon=${send.icon}></ha-icon>`}${send.label}
      </button>
    </div>
  </form>`;
}

function renderClock(clock: ClockSection): TemplateResult {
  const { toggle, when } = clock;
  return html`<div class="k-clock">
    <div class="k-head">
      <span class="k-title small">${clock.title}</span>
      <button
        class="chip k-clock-switch ${toggle.on ? "on" : ""} ${pendingClass(toggle.pending)}"
        role="switch"
        aria-checked=${String(toggle.on)}
        aria-busy=${toggle.pending ? "true" : "false"}
        ?disabled=${!toggle.enabled}
        @click=${toggle.run}
      >
        <ha-icon .icon=${toggle.icon}></ha-icon><span>${toggle.label}</span>
        <span class="switch-knob" aria-hidden="true"></span>
      </button>
    </div>
    ${reasons([toggle, ...(when?.options ?? [])])}
    ${when
      ? html`<div class="k-clock-when">
          <span class="k-label" id="k-clock-when">${when.label}</span>
          <div class="seg" role="radiogroup" aria-labelledby="k-clock-when">
            ${when.options.map(
              (option) => html`<button
                role="radio"
                aria-checked=${String(option.checked)}
                aria-busy=${option.pending ? "true" : "false"}
                class="${option.selected ? "active" : ""} ${pendingClass(option.pending)}"
                ?disabled=${!option.enabled}
                title=${option.title}
                @click=${option.select}
              >
                ${option.label}
              </button>`,
            )}
          </div>
        </div>`
      : nothing}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Styles (every selector starts with .timers-kitchen)                 */
/* ------------------------------------------------------------------ */

/**
 * The ring reads the progress <jbl-bar-countdown> sets as aria-valuenow (0..100, once a second):
 * one rule per percent turns it into --k-done for the conic gradient. Static CSS, built once.
 */
const ringSteps = unsafeCSS(
  Array.from({ length: 101 }, (_, i) => `.timers-kitchen .k-ring[aria-valuenow="${i}"]{--k-done:${i}}`).join("\n"),
);

export const kitchenStyles = css`
  .timers-kitchen {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .timers-kitchen ha-icon {
    flex: none;
  }
  .timers-kitchen .k-timers {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .timers-kitchen .k-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 28px;
  }
  .timers-kitchen .k-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--jbl-muted);
  }
  .timers-kitchen .k-title.small {
    letter-spacing: 0.02em;
  }
  .timers-kitchen .k-sub {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--jbl-muted);
  }
  .timers-kitchen .k-sub ha-icon {
    --mdc-icon-size: 16px;
  }
  .timers-kitchen .k-label {
    font-size: 0.8rem;
    color: var(--jbl-muted);
  }
  .timers-kitchen .btn ha-icon {
    --mdc-icon-size: 18px;
  }
  .timers-kitchen .k-reason {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: 0.8rem;
  }
  .timers-kitchen .k-reason ha-icon {
    --mdc-icon-size: 16px;
    margin-top: 1px;
  }

  /* ---- Hero ---- */
  .timers-kitchen .k-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 14px 12px 16px;
    border-radius: var(--jbl-radius);
    background: var(--jbl-surface);
    text-align: center;
  }
  .timers-kitchen .k-eyebrow {
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--jbl-accent-text);
  }
  .timers-kitchen .k-eyebrow + .k-hero-name {
    margin-top: -6px;
  }
  .timers-kitchen .k-hero-name {
    font-size: 1.35rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .timers-kitchen .k-dial {
    position: relative;
    /* A size container: the countdown inside is sized against the dial, so it stays in the ring. */
    container: k-dial / inline-size;
    width: min(208px, 62cqw);
    aspect-ratio: 1;
    border-radius: 50%;
    background: var(--jbl-card-bg);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .timers-kitchen .k-ring,
  .timers-kitchen .k-ring-static {
    position: absolute;
    inset: 0;
    display: block;
    border-radius: 50%;
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 11px), #000 calc(100% - 10px));
    mask: radial-gradient(farthest-side, transparent calc(100% - 11px), #000 calc(100% - 10px));
  }
  .timers-kitchen .k-ring {
    --k-done: 0;
    background: conic-gradient(
      var(--jbl-accent) 0 calc((100 - var(--k-done)) * 1%),
      rgba(var(--jbl-accent-rgb), 0.16) calc((100 - var(--k-done)) * 1%) 100%
    );
  }
  .timers-kitchen .k-ring > .fill {
    display: none;
  }
  ${ringSteps}
  .timers-kitchen .k-ring-static {
    background: rgba(var(--jbl-accent-rgb), 0.35);
  }
  .timers-kitchen .k-dial.idle .k-ring-static {
    background: var(--jbl-border);
  }
  .timers-kitchen .k-center {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 0 22px;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
  }
  .timers-kitchen .k-time {
    display: block;
    /* cqi of the dial; 48px is the .k-center padding (44px) plus a little air. "59:59" needs about 2.5em. */
    font-size: clamp(1.25rem, calc((100cqi - 48px) / 2.7), 3rem);
    font-weight: 600;
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
  }
  .timers-kitchen .k-time.hours {
    /* "11:59:59" needs about 4em (tabular digits). */
    font-size: clamp(1rem, calc((100cqi - 48px) / 4.2), 2.25rem);
  }
  .timers-kitchen .k-ends {
    font-size: 0.8rem;
    color: var(--jbl-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .timers-kitchen .k-meta {
    display: flex;
    gap: 6px;
    margin-top: 4px;
    color: var(--jbl-muted);
  }
  .timers-kitchen .k-meta ha-icon {
    --mdc-icon-size: 16px;
  }
  .timers-kitchen .k-hero-actions {
    display: flex;
    gap: 8px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .timers-kitchen .k-head .btn,
  .timers-kitchen .k-hero-actions .btn {
    white-space: nowrap;
  }
  .timers-kitchen .k-hero-actions .btn {
    min-width: 104px;
    padding: 9px 14px;
    border-radius: 999px;
  }
  .timers-kitchen .k-extend {
    background: rgba(var(--jbl-accent-rgb), 0.12);
    border-color: rgba(var(--jbl-accent-rgb), 0.45);
    color: var(--jbl-accent-text);
  }

  /* Ringing hero: the alarm colour */
  .timers-kitchen .k-hero.ringing {
    background: color-mix(in srgb, var(--jbl-error) 10%, transparent);
    box-shadow: inset 0 0 0 1px var(--jbl-error);
  }
  .timers-kitchen .k-hero.ringing .k-eyebrow {
    color: var(--jbl-error);
  }
  .timers-kitchen .k-dial.ringing .k-ring-static {
    background: var(--jbl-error);
    animation: k-alarm 1.2s ease-in-out infinite;
  }
  .timers-kitchen .k-bell {
    --mdc-icon-size: 48px;
    color: var(--jbl-error);
    animation: k-ring 1.2s ease-in-out infinite;
    transform-origin: 50% 10%;
  }
  .timers-kitchen .k-ring-text {
    font-size: 1.2rem;
    font-weight: 700;
    color: var(--jbl-error);
  }
  .timers-kitchen .k-stop {
    min-width: min(220px, 100%);
    padding: 12px 20px;
    font-size: 1.05rem;
    border-radius: 999px;
  }
  .timers-kitchen .k-stop ha-icon {
    --mdc-icon-size: 22px;
  }
  @keyframes k-alarm {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.45;
    }
  }
  @keyframes k-ring {
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
    .timers-kitchen .k-bell,
    .timers-kitchen .k-dial.ringing .k-ring-static {
      animation: none;
    }
  }

  /* Idle hero */
  .timers-kitchen .k-idle .k-dial {
    width: min(120px, 40cqw);
    box-shadow: none;
  }
  .timers-kitchen .k-idle-icon {
    --mdc-icon-size: 40px;
    color: var(--jbl-muted);
  }
  .timers-kitchen .k-idle-text {
    font-weight: 500;
  }

  /* ---- Lists (other timers, messages) ---- */
  .timers-kitchen .k-others {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .timers-kitchen .k-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .timers-kitchen .k-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 6px 8px 12px;
    border-radius: var(--jbl-radius-sm);
    border: 1px solid var(--jbl-border);
    min-width: 0;
  }
  .timers-kitchen .k-row-main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .timers-kitchen .k-row-top {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .timers-kitchen .k-row-name {
    flex: 0 1 auto;
    min-width: 0;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .timers-kitchen .k-row-left {
    flex: none;
    margin-left: auto;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .timers-kitchen .k-row-bar {
    display: block;
    height: 3px;
    border-radius: 2px;
    background: rgba(var(--jbl-accent-rgb), 0.15);
    overflow: hidden;
  }
  .timers-kitchen .k-row-bar > .fill {
    display: block;
    height: 100%;
    background: var(--jbl-accent);
    transition: width 1s linear;
  }
  .timers-kitchen .k-row-icon {
    color: var(--jbl-muted);
  }
  .timers-kitchen .k-row.ringing {
    border-color: var(--jbl-error);
    background: color-mix(in srgb, var(--jbl-error) 8%, transparent);
  }
  .timers-kitchen .k-row.ringing .k-bell {
    --mdc-icon-size: 20px;
  }
  .timers-kitchen .k-row-ring {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--jbl-error);
  }
  .timers-kitchen .k-row-extend,
  .timers-kitchen .k-row-stop {
    flex: none;
    white-space: nowrap;
    border-radius: 999px;
  }
  .timers-kitchen .k-row-cancel {
    width: 32px;
    height: 32px;
  }
  .timers-kitchen .k-row-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    font-size: 0.8rem;
    color: var(--jbl-muted);
  }
  .timers-kitchen .k-msg-id {
    flex: none;
    font-size: 0.8rem;
  }
  .timers-kitchen .k-msg-left {
    font-variant-numeric: tabular-nums;
  }
  .timers-kitchen .k-message.showing {
    border-color: rgba(var(--jbl-accent-rgb), 0.5);
  }

  /* ---- Quick start ---- */
  .timers-kitchen .k-start {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .timers-kitchen .k-quick {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
  }
  .timers-kitchen .k-quick-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding: 2px 0;
    border: 0;
    background: none;
    cursor: pointer;
    border-radius: 12px;
  }
  .timers-kitchen .k-disc {
    display: flex;
    align-items: center;
    justify-content: center;
    width: min(64px, 100%);
    aspect-ratio: 1;
    border-radius: 50%;
    border: 2px solid rgba(var(--jbl-accent-rgb), 0.5);
    background: rgba(var(--jbl-accent-rgb), 0.1);
    color: var(--jbl-accent-text);
    font-size: 1.45rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    box-sizing: border-box;
    transition: background 120ms ease, transform 120ms ease;
  }
  .timers-kitchen .k-disc ha-icon {
    --mdc-icon-size: 24px;
  }
  .timers-kitchen .k-disc .spinner {
    width: 20px;
    height: 20px;
  }
  .timers-kitchen .k-quick-btn:hover:not(:disabled) .k-disc {
    background: rgba(var(--jbl-accent-rgb), 0.2);
  }
  .timers-kitchen .k-quick-btn:active:not(:disabled) .k-disc {
    transform: scale(0.95);
  }
  .timers-kitchen .k-quick-btn.pending .k-disc {
    background: var(--jbl-accent-fill);
    border-color: var(--jbl-accent-fill);
    color: var(--jbl-on-accent);
  }
  .timers-kitchen .k-quick-btn:disabled {
    cursor: default;
    opacity: 0.45;
  }
  .timers-kitchen .k-custom .k-disc {
    border-style: dashed;
    border-color: var(--jbl-border);
    background: transparent;
    color: var(--jbl-text);
  }
  .timers-kitchen .k-custom.open .k-disc {
    border-style: solid;
    border-color: var(--jbl-accent-fill);
    background: var(--jbl-accent-fill);
    color: var(--jbl-on-accent);
  }
  .timers-kitchen .k-cap {
    font-size: 0.75rem;
    color: var(--jbl-muted);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ---- Custom form ---- */
  .timers-kitchen .k-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: var(--jbl-radius-sm);
    border: 1px solid rgba(var(--jbl-accent-rgb), 0.4);
    background: rgba(var(--jbl-accent-rgb), 0.05);
  }
  .timers-kitchen .k-form-row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
  }
  .timers-kitchen .k-name {
    flex: 1 1 auto;
  }
  .timers-kitchen .k-minutes {
    flex: none;
    width: 84px;
  }
  .timers-kitchen .field input[type="text"],
  .timers-kitchen .field input[type="number"] {
    width: 100%;
  }
  .timers-kitchen .k-name-hint {
    margin-top: -4px;
    font-size: 0.8rem;
  }
  .timers-kitchen .k-show-left {
    align-self: flex-start;
  }
  .timers-kitchen .k-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
  }
  .timers-kitchen .k-submit,
  .timers-kitchen .k-send {
    border-radius: 999px;
    padding: 8px 18px;
  }

  /* ---- Recent chips ---- */
  .timers-kitchen .k-recent {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .timers-kitchen .k-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .timers-kitchen .k-chip {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    border-radius: 999px;
    background: var(--jbl-surface);
    border: 1px solid var(--jbl-border);
    box-sizing: border-box;
  }
  .timers-kitchen .k-chip-restart {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 7px 4px 7px 10px;
    border: 0;
    border-radius: 999px 0 0 999px;
    background: transparent;
    cursor: pointer;
    font-size: 0.85rem;
    -webkit-touch-callout: none;
    user-select: none;
  }
  .timers-kitchen .k-chip-restart > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .timers-kitchen .k-chip-restart ha-icon {
    --mdc-icon-size: 16px;
    color: var(--jbl-accent-text);
  }
  .timers-kitchen .k-chip-restart:disabled {
    cursor: default;
    color: var(--jbl-disabled);
  }
  .timers-kitchen .k-chip-forget {
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
  .timers-kitchen .k-chip-forget:hover {
    background: var(--jbl-border);
  }
  .timers-kitchen .k-chip-forget ha-icon {
    --mdc-icon-size: 16px;
  }
  .timers-kitchen .k-recent-hint {
    font-size: 0.75rem;
  }

  /* ---- Display (collapsible) ---- */
  .timers-kitchen .k-display {
    border: 1px solid var(--jbl-border);
    border-radius: var(--jbl-radius-sm);
  }
  .timers-kitchen .k-display > summary {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    cursor: pointer;
    list-style: none;
    border-radius: var(--jbl-radius-sm);
  }
  .timers-kitchen .k-display > summary::-webkit-details-marker {
    display: none;
  }
  .timers-kitchen .k-display > summary:focus-visible {
    outline: 2px solid var(--jbl-accent);
    outline-offset: 2px;
  }
  .timers-kitchen .k-display > summary:hover {
    background: var(--jbl-surface);
  }
  .timers-kitchen .k-display-icon {
    color: var(--jbl-accent-text);
  }
  .timers-kitchen .k-display-titles {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .timers-kitchen .k-display-title {
    font-weight: 500;
  }
  .timers-kitchen .k-display-hint {
    font-size: 0.8rem;
    color: var(--jbl-muted);
    overflow-wrap: anywhere;
  }
  .timers-kitchen .k-chevron {
    color: var(--jbl-muted);
    transition: transform 160ms ease;
  }
  .timers-kitchen .k-display[open] .k-chevron {
    transform: rotate(180deg);
  }
  .timers-kitchen .k-display[open] > summary {
    border-bottom: 1px solid var(--jbl-border);
    border-radius: var(--jbl-radius-sm) var(--jbl-radius-sm) 0 0;
  }
  .timers-kitchen .k-display-body {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 12px;
  }
  .timers-kitchen .k-messages,
  .timers-kitchen .k-compose,
  .timers-kitchen .k-clock {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .timers-kitchen .k-clock {
    padding-top: 12px;
    border-top: 1px solid var(--jbl-border);
  }
  .timers-kitchen .k-lcd {
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
  .timers-kitchen .k-lcd.empty {
    color: rgba(255, 138, 80, 0.45);
    text-shadow: none;
  }
  .timers-kitchen .k-label-row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .timers-kitchen .k-label-row > label,
  .timers-kitchen .k-counter {
    font-size: 0.8rem;
    color: var(--jbl-muted);
  }
  .timers-kitchen .k-counter {
    font-variant-numeric: tabular-nums;
  }
  .timers-kitchen .k-counter.warn-text {
    color: var(--jbl-text);
  }
  .timers-kitchen .k-mode-detail {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .timers-kitchen .k-repeat-value {
    min-width: 84px;
  }
  .timers-kitchen .k-send-row {
    flex-wrap: wrap;
  }
  .timers-kitchen .k-send-row .k-reason {
    flex: 1 1 140px;
  }
  .timers-kitchen .k-clock-when {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  @container (max-width: 340px) {
    .timers-kitchen .k-quick {
      gap: 4px;
    }
    .timers-kitchen .k-disc {
      font-size: 1.2rem;
      border-width: 1.5px;
    }
    .timers-kitchen .k-hero {
      padding: 12px 8px 14px;
    }
    .timers-kitchen .k-hero-actions .btn {
      min-width: 0;
      flex: 1 1 0;
    }
    .timers-kitchen .k-minutes {
      width: 72px;
    }
    .timers-kitchen .k-message .k-row-icon {
      display: none;
    }
  }
`;
