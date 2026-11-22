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
  TimersAction,
  TimersModel,
  TimersSection,
} from "../timers-model";

/**
 * The "compact" layout of the Timers tab: three sub-tabs (Timers, Messages, Clock) behind a small
 * segmented control, with dense one-line rows. It only renders the model (../timers-model);
 * every decision lives there. The chosen sub-tab is layout UI state in ctx.local("timers_compact").
 *
 * Countdowns are <jbl-bar-countdown> elements that repaint themselves (no ctx.wantTick()).
 */

type SubTab = "timers" | "messages" | "clock";
const SUB_TABS: readonly SubTab[] = ["timers", "messages", "clock"];
/** Shown instead of the label on narrow cards (like the card's own tabs). */
const TAB_ICONS: Record<SubTab, string> = { timers: "mdi:timer-outline", messages: "mdi:message-text-outline", clock: "mdi:clock-outline" };

interface CompactLocal {
  tab: SubTab;
}

const tabId = (tab: SubTab): string => `timers-compact-tab-${tab}`;
const panelId = (tab: SubTab): string => `timers-compact-panel-${tab}`;
const tc = (ctx: TabContext, key: string, vars?: Record<string, string | number>): string => ctx.t(`timers_compact.${key}`, vars);

export function renderCompact(ctx: TabContext, model: TimersModel): TemplateResult {
  const tabs = SUB_TABS.filter((tab) => model[tab] !== undefined);
  if (!tabs.length) return html`<div class="timers-compact"></div>`;
  const local = ctx.local<CompactLocal>("timers_compact", () => ({ tab: "timers" }));
  const current = tabs.includes(local.tab) ? local.tab : tabs[0];
  const panel = renderPanel(ctx, model, current);
  if (tabs.length === 1) return html`<div class="timers-compact single">${panel}</div>`;

  const select = (tab: SubTab): void => {
    if (local.tab === tab) return;
    local.tab = tab;
    ctx.requestUpdate();
  };
  // Tabs pattern: arrows, Home and End move the selection and the focus (roving tabindex).
  const onKey = (ev: KeyboardEvent): void => {
    const i = tabs.indexOf(current);
    const n = tabs.length;
    const next =
      ev.key === "ArrowRight" || ev.key === "ArrowDown"
        ? (i + 1) % n
        : ev.key === "ArrowLeft" || ev.key === "ArrowUp"
          ? (i - 1 + n) % n
          : ev.key === "Home"
            ? 0
            : ev.key === "End"
              ? n - 1
              : -1;
    if (next < 0) return;
    ev.preventDefault();
    (ev.currentTarget as HTMLElement).querySelector<HTMLElement>(`#${tabId(tabs[next])}`)?.focus();
    select(tabs[next]);
  };
  // A ringing timer is the most urgent state of the tab: on the other sub-tabs its row (with Stop)
  // sits above the panel. The rows keep role="alert", so the alarm is announced wherever the user is.
  const ringing = current !== "timers" ? (model.timers?.timers.filter((timer) => timer.ringing) ?? []) : [];

  return html`
    <div class="timers-compact">
      <div class="seg tc-tabs" role="tablist" aria-label=${tc(ctx, "tabs_label")} @keydown=${onKey}>
        ${tabs.map((tab) => {
          const active = tab === current;
          return html`<button
            id=${tabId(tab)}
            type="button"
            role="tab"
            class=${active ? "active" : ""}
            aria-selected=${String(active)}
            aria-controls=${panelId(tab)}
            tabindex=${active ? "0" : "-1"}
            @click=${() => select(tab)}
          >
            <ha-icon class="tc-tab-icon" .icon=${TAB_ICONS[tab]} aria-hidden="true"></ha-icon
            ><span class="tc-tab-label">${tc(ctx, `tab_${tab}`)}</span>${tabBadge(ctx, model, tab)}
          </button>`;
        })}
      </div>
      ${ringing.length ? html`<div class="tc-list tc-alarms">${repeat(ringing, (timer) => timer.id, renderTimer)}</div>` : nothing}
      <div id=${panelId(current)} class="tc-tabpanel" role="tabpanel" aria-labelledby=${tabId(current)}>${panel}</div>
    </div>
  `;
}

function tabBadge(ctx: TabContext, model: TimersModel, tab: SubTab): TemplateResult | typeof nothing {
  if (tab === "timers" && model.timers?.timers.length) {
    const ringing = model.timers.timers.some((timer) => timer.ringing);
    return html`<span class="tc-count ${ringing ? "alarm" : ""}"
      >${ringing ? html`<ha-icon .icon=${"mdi:bell-ring"} aria-hidden="true"></ha-icon>` : nothing}${model.timers.timers.length}</span
    >${ringing ? html`<span class="sr-only">, ${tc(ctx, "ringing_now")}</span>` : nothing}`;
  }
  if (tab === "messages" && model.messages?.messages.length) return html`<span class="tc-count">${model.messages.messages.length}</span>`;
  return nothing;
}

function renderPanel(ctx: TabContext, model: TimersModel, tab: SubTab): TemplateResult {
  if (tab === "timers" && model.timers) return renderTimers(ctx, model.timers);
  if (tab === "messages" && model.messages) return renderMessages(ctx, model.messages);
  return renderClock(ctx, model.clock!);
}

/* ---------------- Shared bits ---------------- */

const pendingClass = (pending: boolean): string => (pending ? "pending" : "");

/** The action's icon, or a spinner while its call is on its way. */
const actionIcon = (action: TimersAction): TemplateResult =>
  action.pending ? html`<span class="spinner" aria-hidden="true"></span>` : html`<ha-icon .icon=${action.icon}></ha-icon>`;

/** A small spinner before a text label while its call is on its way. */
const textSpinner = (pending: boolean): TemplateResult | typeof nothing =>
  pending ? html`<span class="spinner tc-spin" aria-hidden="true"></span>` : nothing;

/** The distinct reasons of the disabled actions, minus texts the panel already shows. */
function reasonsOf(actions: ({ enabled: boolean; reason?: string } | undefined)[], shown: (string | undefined)[] = []): string[] {
  const out: string[] = [];
  for (const action of actions) {
    if (!action || action.enabled || !action.reason) continue;
    if (out.includes(action.reason) || shown.includes(action.reason)) continue;
    out.push(action.reason);
  }
  return out;
}

const renderReasons = (reasons: string[]): TemplateResult | typeof nothing =>
  reasons.length ? html`${reasons.map((reason) => html`<div class="hint tc-reason">${reason}</div>`)}` : nothing;

/** The list's header row: how many items there are, and a small text button (Stop all, Clear all). */
function toolButton(ctx: TabContext, action: TimersAction, count: number): TemplateResult {
  return html`<div class="tc-tools">
    <span class="tc-cap tc-count-cap">${tc(ctx, "list_count", { count })}</span>
    <button
      type="button"
      class="tc-tool ${action.danger ? "danger" : ""} ${pendingClass(action.pending)}"
      ?disabled=${!action.enabled}
      aria-busy=${action.pending ? "true" : "false"}
      aria-label=${action.ariaLabel}
      @click=${action.run}
    >
      ${actionIcon(action)}<span>${action.label}</span>
    </button>
  </div>`;
}

/** The round × / cancel button at the end of a row. */
function rowX(action: TimersAction, cls: string): TemplateResult {
  return html`<button
    type="button"
    class="tc-x ${cls} ${pendingClass(action.pending)}"
    ?disabled=${!action.enabled}
    aria-busy=${action.pending ? "true" : "false"}
    aria-label=${action.ariaLabel}
    title=${action.ariaLabel}
    @click=${action.run}
  >
    ${actionIcon(action)}
  </button>`;
}

function switchChip(toggle: { on: boolean; label: string; icon: string; hint?: string; toggle(): void }, cls = ""): TemplateResult {
  return html`<button
    type="button"
    class="chip tc-switch ${cls} ${toggle.on ? "on" : ""}"
    role="switch"
    aria-checked=${String(toggle.on)}
    title=${toggle.hint ?? toggle.label}
    @click=${toggle.toggle}
  >
    <ha-icon .icon=${toggle.icon}></ha-icon><span>${toggle.label}</span><span class="switch-knob" aria-hidden="true"></span>
  </button>`;
}

/* ---------------- Timers ---------------- */

function renderTimers(ctx: TabContext, section: TimersSection): TemplateResult {
  const { timers, stopAll, start, recent } = section;
  const form = start?.form;
  const reasons = reasonsOf(
    [
      stopAll,
      ...timers.flatMap((timer) => [timer.cancel, timer.extend]),
      ...(start?.quick ?? []),
      form?.open ? form.submit : undefined,
      ...(recent?.chips.map((chip) => chip.restart) ?? []),
    ],
    // The name warning under the form already says why Start is disabled.
    [form?.nameHint.warn ? form.nameHint.text : undefined],
  );
  return html`
    <div class="tc-panel tc-timers">
      ${stopAll ? toolButton(ctx, stopAll, timers.length) : nothing} ${renderReasons(reasons)}
      ${!section.available
        ? html`<div class="hint tc-empty">${section.unavailableText}</div>`
        : timers.length
          ? html`<div class="tc-list">${repeat(timers, (timer) => timer.id, renderTimer)}</div>`
          : html`<div class="hint tc-empty">${section.emptyText}</div>`}
      ${start ? renderStart(ctx, start) : nothing} ${recent ? renderRecent(ctx, recent) : nothing}
    </div>
  `;
}

function renderTimer(timer: TimerView): TemplateResult {
  const { cancel, extend } = timer;
  if (timer.ringing) {
    return html`
      <div class="tc-row tc-timer ringing" role="alert">
        <ha-icon class="tc-bell" .icon=${"mdi:bell-ring"} aria-hidden="true"></ha-icon>
        <span class="tc-name">${timer.name}</span>
        <span class="tc-ring-text">${timer.ringingText}</span>
        <button
          type="button"
          class="btn danger filled small tc-stop ${pendingClass(cancel.pending)}"
          ?disabled=${!cancel.enabled}
          aria-busy=${cancel.pending ? "true" : "false"}
          aria-label=${cancel.ariaLabel}
          @click=${cancel.run}
        >
          ${actionIcon(cancel)}${cancel.label}
        </button>
      </div>
    `;
  }
  return html`
    <div class="tc-row tc-timer">
      <span class="tc-name">${timer.name}</span>
      <span class="tc-meta" aria-hidden="true">
        <ha-icon .icon=${timer.sound.icon} title=${timer.sound.label}></ha-icon>
        ${timer.countdownOnBar ? html`<ha-icon .icon=${timer.countdownOnBar.icon} title=${timer.countdownOnBar.label}></ha-icon>` : nothing}
      </span>
      <span class="sr-only">${timer.sound.label}${timer.countdownOnBar ? html`, ${timer.countdownOnBar.label}` : nothing}</span>
      ${timer.endsAtLabel !== undefined ? html`<span class="tc-ends">${timer.endsAtLabel}</span>` : nothing}
      <jbl-bar-countdown class="tc-left" .kind=${"text"} .endsAt=${timer.endsAt}></jbl-bar-countdown>
      ${extend
        ? html`<button
            type="button"
            class="tc-extend ${pendingClass(extend.pending)}"
            ?disabled=${!extend.enabled}
            aria-busy=${extend.pending ? "true" : "false"}
            aria-label=${extend.ariaLabel}
            title=${extend.ariaLabel}
            @click=${extend.run}
          >
            ${textSpinner(extend.pending)}${extend.label}
          </button>`
        : nothing}
      ${rowX(cancel, "tc-cancel")}
      ${timer.progressTotal !== null
        ? html`<jbl-bar-countdown
            class="tc-progress"
            .kind=${"progress"}
            .total=${timer.progressTotal}
            .endsAt=${timer.endsAt}
            aria-label=${timer.name}
          ></jbl-bar-countdown>`
        : nothing}
    </div>
  `;
}

function renderStart(ctx: TabContext, start: StartModel): TemplateResult {
  const { form } = start;
  return html`
    <div class="tc-start">
      <div class="tc-quick" role="group" aria-label=${start.label}>
        ${start.quick.map(
          (quick) => html`<button
            type="button"
            class="tc-q ${pendingClass(quick.pending)}"
            ?disabled=${!quick.enabled}
            aria-busy=${quick.pending ? "true" : "false"}
            aria-label=${quick.ariaLabel}
            title=${quick.ariaLabel}
            @click=${quick.run}
          >
            ${textSpinner(quick.pending)}${quick.label}
          </button>`,
        )}
        <button
          type="button"
          class="tc-q tc-custom ${form.open ? "on" : ""}"
          aria-expanded=${String(form.open)}
          aria-controls="timers-compact-form"
          aria-label=${form.toggleAriaLabel}
          title=${form.toggleAriaLabel}
          @click=${form.toggle}
        >
          <ha-icon .icon=${form.toggleIcon} aria-hidden="true"></ha-icon><span>${form.toggleLabel}</span>
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
      id="timers-compact-form"
      class="tc-form"
      novalidate
      @submit=${(ev: Event) => {
        ev.preventDefault();
        void form.submitForm();
      }}
    >
      <div class="tc-form-grid">
        <div class="field">
          <label for=${name.id}>${name.label}</label>
          <input
            id=${name.id}
            type="text"
            maxlength=${name.max}
            autocomplete="off"
            aria-invalid=${form.badChars.length ? "true" : "false"}
            aria-describedby="timers-compact-name-hint"
            .value=${live(name.value)}
            @input=${(ev: Event) => name.set((ev.target as HTMLInputElement).value)}
          />
        </div>
        <div class="field">
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
      <div id="timers-compact-name-hint" class="tc-fine ${form.nameHint.warn ? "warn-text" : ""}">${form.nameHint.text}</div>
      <div class="tc-form-row">
        <span class="tc-cap" id="timers-compact-sound">${form.soundLabel}</span>
        <div class="seg tc-mini-seg" role="radiogroup" aria-labelledby="timers-compact-sound">
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
      <div class="tc-form-row tc-form-end">
        ${switchChip(form.showLeft)}
        <span class="tc-spacer"></span>
        <button type="button" class="btn ghost small" @click=${form.close}>${form.closeLabel}</button>
        <button
          type="submit"
          class="btn primary small tc-submit ${pendingClass(submit.pending)}"
          ?disabled=${!submit.enabled}
          aria-busy=${submit.pending ? "true" : "false"}
        >
          ${actionIcon(submit)}${submit.label}
        </button>
      </div>
    </form>
  `;
}

/* ---------------- Recent chips ---------------- */

function renderRecent(ctx: TabContext, recent: RecentModel): TemplateResult {
  return html`
    <div class="tc-recent tc-recent-${recent.kind}s" role="group" aria-labelledby="timers-compact-recent-${recent.kind}">
      <div class="tc-cap" id="timers-compact-recent-${recent.kind}"><ha-icon .icon=${recent.icon} aria-hidden="true"></ha-icon>${recent.title}</div>
      <div class="tc-chips">
        ${repeat(
          recent.chips,
          (chip) => chip.id,
          (chip) => html`<span class="tc-chip ${pendingClass(chip.busy)}">
            <button
              type="button"
              class="tc-chip-run"
              ?disabled=${!chip.restart.enabled}
              aria-busy=${chip.busy ? "true" : "false"}
              aria-label=${chip.restart.ariaLabel}
              title=${chip.restart.ariaLabel}
              @click=${chip.restart.run}
              @pointerdown=${chip.press.onPointerDown}
              @pointerup=${chip.press.onPointerEnd}
              @pointerleave=${chip.press.onPointerEnd}
              @pointercancel=${chip.press.onPointerEnd}
              @contextmenu=${chip.press.onContextMenu}
            >
              ${chip.busy ? html`<span class="spinner" aria-hidden="true"></span>` : nothing}<span>${chip.label}</span>
            </button>
            <button
              type="button"
              class="tc-chip-x"
              ?disabled=${!chip.forget.enabled}
              aria-busy=${chip.busy ? "true" : "false"}
              aria-label=${chip.forget.ariaLabel}
              title=${chip.forget.ariaLabel}
              @click=${chip.forget.run}
            >
              <ha-icon .icon=${chip.forget.icon}></ha-icon>
            </button>
          </span>`,
        )}
      </div>
      ${ctx.renderError(recent.errorKeys)}
      <div class="tc-fine">${recent.hint}</div>
    </div>
  `;
}

/* ---------------- Messages ---------------- */

function renderMessages(ctx: TabContext, section: MessagesSection): TemplateResult {
  const { messages, clearAll, compose, recent } = section;
  const reasons = reasonsOf([clearAll, ...messages.map((message) => message.clear), ...(recent?.chips.map((chip) => chip.restart) ?? [])]);
  return html`
    <div class="tc-panel tc-messages">
      ${clearAll ? toolButton(ctx, clearAll, messages.length) : nothing} ${renderReasons(reasons)}
      ${!section.available
        ? html`<div class="hint tc-empty">${section.unavailableText}</div>`
        : messages.length
          ? html`<div class="tc-list">${repeat(messages, (message) => message.id, renderMessage)}</div>`
          : html`<div class="hint tc-empty">${section.emptyText}</div>`}
      ${compose ? renderCompose(ctx, compose, reasons) : nothing} ${recent ? renderRecent(ctx, recent) : nothing}
    </div>
  `;
}

function renderMessage(message: MessageView): TemplateResult {
  const { length } = message;
  return html`
    <div class="tc-row tc-message ${message.status.kind}">
      <ha-icon class="tc-msg-icon" .icon=${message.icon} title=${message.status.text} aria-hidden="true"></ha-icon>
      <span class="tc-name">${message.label}${message.name ? html` <span class="tc-id">(${message.name})</span>` : nothing}</span>
      <span class="tc-status">${message.status.text}</span>
      ${length.text || message.whenOnText
        ? html`<span class="tc-len"
            >${length.text}${length.kind === "until"
              ? html` · <jbl-bar-countdown class="tc-msg-left" .kind=${"text"} .endsAt=${length.endsAt}></jbl-bar-countdown>`
              : nothing}${message.whenOnText
              ? html`<ha-icon class="tc-when-on" .icon=${"mdi:power"} title=${message.whenOnText} aria-hidden="true"></ha-icon
                  ><span class="sr-only">, ${message.whenOnText}</span>`
              : nothing}</span
          >`
        : nothing}
      ${rowX(message.clear, "tc-clear")}
    </div>
  `;
}

function renderCompose(ctx: TabContext, compose: ComposeModel, shownReasons: string[]): TemplateResult {
  const { text, counter, repeat: rep, duration, clearOnKey, whenOn, send } = compose;
  // Why Send is disabled, unless the warning or the panel already says it.
  const sendReason = !send.enabled && send.reason && send.reason !== compose.warning && !shownReasons.includes(send.reason) ? send.reason : undefined;
  return html`
    <form
      class="tc-compose"
      novalidate
      @submit=${(ev: Event) => {
        ev.preventDefault();
        void compose.sendForm();
      }}
    >
      <div class="tc-compose-head">
        <label class="tc-cap" for=${text.id}>${compose.title}</label>
        <div class="tc-lcd ${compose.previewEmpty ? "empty" : ""}" role="img" aria-label=${compose.previewLabel} title=${compose.previewLabel}>${compose.preview}</div>
      </div>
      <div class="tc-send-row">
        <div class="tc-input">
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
          <span id=${counter.id} class="tc-counter ${counter.warn ? "warn" : ""}">${counter.text}</span>
        </div>
        <button
          type="submit"
          class="btn primary tc-send ${pendingClass(send.pending)}"
          ?disabled=${!send.enabled}
          aria-busy=${send.pending ? "true" : "false"}
        >
          ${actionIcon(send)}<span>${send.label}</span>
        </button>
      </div>
      ${compose.warning ? html`<div class="tc-fine warn-text">${compose.warning}</div>` : nothing}
      ${sendReason ? html`<div class="tc-fine tc-reason">${sendReason}</div>` : nothing}
      <div class="sr-only" role="status">${compose.liveStatus}</div>
      <div class="seg tc-mini-seg tc-mode" role="radiogroup" aria-label=${compose.modeLabel}>
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
      <div class="tc-options">
        ${compose.mode === "repeat"
          ? html`<div class="stepper tc-stepper">
              <button type="button" ?disabled=${!rep.less.enabled} aria-label=${rep.less.ariaLabel} title=${rep.less.ariaLabel} @click=${rep.less.run}>
                <ha-icon .icon=${rep.less.icon}></ha-icon>
              </button>
              <span class="stepper-value tc-repeat" aria-live="polite">${rep.label}</span>
              <button type="button" ?disabled=${!rep.more.enabled} aria-label=${rep.more.ariaLabel} title=${rep.more.ariaLabel} @click=${rep.more.run}>
                <ha-icon .icon=${rep.more.icon}></ha-icon>
              </button>
            </div>`
          : compose.mode === "duration"
            ? html`<span class="tc-duration">
                <label class="tc-cap" for=${duration.id}>${duration.label}</label>
                <select id=${duration.id} class="select" @change=${(ev: Event) => duration.set(Number((ev.target as HTMLSelectElement).value))}>
                  ${duration.options.map((option) => html`<option value=${option.value} ?selected=${option.selected}>${option.label}</option>`)}
                </select>
              </span>`
            : nothing}
        ${switchChip(clearOnKey, "tc-clear-on-key")} ${whenOn ? switchChip(whenOn, "tc-when-on-switch") : nothing}
      </div>
      ${compose.mode === "repeat" ? renderReasons(reasonsOf([rep.less, rep.more])) : nothing}
      ${compose.whenOnHint ? html`<div class="tc-fine">${compose.whenOnHint}</div>` : nothing} ${ctx.renderError(compose.errorKey)}
    </form>
  `;
}

/* ---------------- Clock ---------------- */

function renderClock(ctx: TabContext, clock: ClockSection): TemplateResult {
  const { toggle, when } = clock;
  return html`
    <div class="tc-panel tc-clock">
      <button
        type="button"
        class="tc-clock-switch ${toggle.on ? "on" : ""} ${pendingClass(toggle.pending)}"
        role="switch"
        aria-checked=${String(toggle.on)}
        aria-busy=${toggle.pending ? "true" : "false"}
        aria-describedby="timers-compact-clock-help"
        ?disabled=${!toggle.enabled}
        @click=${toggle.run}
      >
        <ha-icon .icon=${toggle.icon} aria-hidden="true"></ha-icon>
        <span class="tc-clock-label">${toggle.label}</span>
        ${toggle.pending ? html`<span class="spinner" aria-hidden="true"></span>` : nothing}
        <span class="switch-knob" aria-hidden="true"></span>
      </button>
      ${renderReasons(reasonsOf([toggle, ...(when?.options ?? [])]))}
      <div class="tc-fine" id="timers-compact-clock-help">${tc(ctx, "clock_explain")}</div>
      ${when
        ? html`<div class="tc-clock-when">
            <span class="tc-cap" id="timers-compact-clock-when">${when.label}</span>
            <div class="seg tc-mini-seg" role="radiogroup" aria-labelledby="timers-compact-clock-when" aria-describedby="timers-compact-when-help">
              ${when.options.map(
                (option) => html`<button
                  type="button"
                  role="radio"
                  aria-checked=${String(option.checked)}
                  aria-busy=${option.pending ? "true" : "false"}
                  class="${option.selected ? "active" : ""} ${pendingClass(option.pending)}"
                  ?disabled=${!option.enabled}
                  title=${option.title}
                  @click=${option.select}
                >
                  ${textSpinner(option.pending)}${option.label}
                </button>`,
              )}
            </div>
            <div class="tc-fine" id="timers-compact-when-help">${tc(ctx, "clock_when_explain")}</div>
          </div>`
        : nothing}
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Styles (every selector starts with .timers-compact)                  */
/* ------------------------------------------------------------------ */

export const compactStyles = css`
  .timers-compact {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  /* Always one row: these override the shared narrow .seg rules (which let the buttons wrap). */
  .timers-compact .tc-tabs {
    flex-wrap: nowrap;
    border-radius: 999px;
  }
  .timers-compact .tc-tabs button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    /* Labels: each tab gets its text's width plus an equal share of the rest ("Повідомлення" is long). */
    flex: 1 1 auto;
    min-width: 0;
    min-height: 30px;
    padding: 4px 8px;
    border-radius: 999px;
    font-size: 0.85rem;
    line-height: normal;
    white-space: nowrap;
    overflow: hidden;
  }
  .timers-compact .tc-tab-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .timers-compact .tc-count {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex: none;
    min-width: 18px;
    height: 18px;
    box-sizing: border-box;
    padding: 0 5px;
    justify-content: center;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    background: rgba(var(--jbl-accent-rgb), 0.16);
    color: var(--jbl-accent-text);
  }
  .timers-compact .tc-tabs button.active .tc-count {
    background: color-mix(in srgb, var(--jbl-on-accent) 25%, transparent);
    color: var(--jbl-on-accent);
  }
  .timers-compact .tc-count.alarm {
    background: var(--jbl-error);
    color: var(--jbl-on-accent);
  }
  .timers-compact .tc-tabs button.active .tc-count.alarm {
    background: var(--jbl-on-accent);
    color: var(--jbl-error);
  }
  .timers-compact .tc-tab-icon {
    display: none;
    --mdc-icon-size: 18px;
  }
  .timers-compact .tc-count ha-icon {
    --mdc-icon-size: 12px;
  }

  .timers-compact .tc-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  /* The list's header row: the count on the left, Stop all / Clear all on the right. */
  .timers-compact .tc-tools {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: -6px;
    padding-left: 4px;
  }
  .timers-compact .tc-tool {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 28px;
    border: 0;
    background: transparent;
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--jbl-muted);
    cursor: pointer;
  }
  .timers-compact .tc-tool ha-icon {
    --mdc-icon-size: 16px;
  }
  .timers-compact .tc-tool.danger {
    color: var(--jbl-error);
  }
  .timers-compact .tc-tool:hover:not(:disabled) {
    background: var(--jbl-surface);
  }
  .timers-compact .tc-tool:disabled {
    cursor: default;
    color: var(--jbl-disabled);
  }
  .timers-compact .tc-reason {
    font-size: 0.8rem;
  }
  .timers-compact .tc-empty {
    padding: 4px 2px;
  }
  .timers-compact .tc-fine {
    font-size: 0.75rem;
    color: var(--jbl-muted);
    line-height: 1.35;
  }
  .timers-compact .tc-fine.warn-text {
    color: var(--jbl-text);
  }
  .timers-compact .tc-cap {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--jbl-muted);
  }
  .timers-compact .tc-cap ha-icon {
    --mdc-icon-size: 14px;
  }

  /* Dense rows: one line, hairline separators, a thin progress line along the bottom edge. */
  .timers-compact .tc-list {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--jbl-border);
  }
  .timers-compact .tc-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    padding: 2px 2px 2px 4px;
    border-bottom: 1px solid var(--jbl-border);
    min-width: 0;
    font-size: 0.9rem;
  }
  /* The name is the row's main information: it keeps a floor, the secondary items give way first. */
  .timers-compact .tc-name {
    flex: 1 1 6em;
    min-width: 6em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .timers-compact .tc-meta {
    display: inline-flex;
    gap: 2px;
    flex: none;
    color: var(--jbl-muted);
  }
  .timers-compact .tc-meta ha-icon {
    --mdc-icon-size: 14px;
  }
  .timers-compact .tc-ends {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.75rem;
    color: var(--jbl-muted);
    white-space: nowrap;
  }
  .timers-compact jbl-bar-countdown.tc-left {
    flex: none;
    min-width: 3.4em;
    text-align: end;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .timers-compact jbl-bar-countdown.tc-progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    overflow: hidden;
    background: transparent;
  }
  .timers-compact jbl-bar-countdown.tc-progress > .fill {
    display: block;
    height: 100%;
    background: var(--jbl-accent);
    transition: width 1s linear;
  }
  .timers-compact .tc-extend {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
    min-height: 28px;
    box-sizing: border-box;
    border: 1px solid var(--jbl-border);
    background: transparent;
    border-radius: 999px;
    padding: 2px 9px;
    font-size: 0.78rem;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }
  .timers-compact .tc-extend:hover:not(:disabled) {
    border-color: var(--jbl-accent);
  }
  .timers-compact .tc-extend:disabled {
    cursor: default;
    color: var(--jbl-disabled);
  }
  .timers-compact .tc-x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--jbl-muted);
    cursor: pointer;
  }
  .timers-compact .tc-x ha-icon {
    --mdc-icon-size: 18px;
  }
  /* × cancels at once: keep it well apart from "+1 min" so a missed tap does not hit it. */
  .timers-compact .tc-extend + .tc-x {
    margin-left: 4px;
  }
  /* A small spinner before a text label while it is pending. */
  .timers-compact .tc-spin {
    width: 10px;
    height: 10px;
  }
  .timers-compact .tc-x:hover:not(:disabled) {
    background: var(--jbl-surface);
    color: var(--jbl-text);
  }
  .timers-compact .tc-x:disabled {
    cursor: default;
    opacity: 0.45;
  }
  .timers-compact .tc-timer.ringing {
    border-bottom-color: transparent;
    border-radius: var(--jbl-radius-sm);
    margin: 2px 0;
    padding-left: 8px;
    background: color-mix(in srgb, var(--jbl-error) 14%, transparent);
    box-shadow: inset 3px 0 0 var(--jbl-error);
  }
  /* Ringing timers shown above the Messages / Clock panels. */
  .timers-compact .tc-alarms {
    border-top: 0;
    margin: -4px 0;
  }
  .timers-compact .tc-bell {
    --mdc-icon-size: 18px;
    flex: none;
    color: var(--jbl-error);
    animation: tc-ring 1.2s ease-in-out infinite;
    transform-origin: 50% 10%;
  }
  .timers-compact .tc-ring-text {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .timers-compact .tc-stop {
    flex: none;
    min-height: 28px;
    padding: 3px 10px;
    gap: 4px;
  }
  .timers-compact .tc-stop ha-icon,
  .timers-compact .tc-submit ha-icon,
  .timers-compact .tc-send ha-icon {
    --mdc-icon-size: 16px;
  }
  @keyframes tc-ring {
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
    .timers-compact .tc-bell {
      animation: none;
    }
  }

  /* Start: quick minutes and Custom in one row */
  .timers-compact .tc-start {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .timers-compact .tc-quick {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr)) minmax(0, 1.35fr);
    gap: 4px;
  }
  .timers-compact .tc-q {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 0;
    min-height: 30px;
    box-sizing: border-box;
    padding: 5px 4px;
    border: 1px solid var(--jbl-border);
    border-radius: 999px;
    background: var(--jbl-card-bg);
    font-size: 0.82rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .timers-compact .tc-q:hover:not(:disabled) {
    border-color: var(--jbl-accent);
  }
  .timers-compact .tc-q:disabled {
    cursor: default;
    color: var(--jbl-disabled);
  }
  .timers-compact .tc-q.pending {
    border-color: var(--jbl-accent);
    box-shadow: inset 0 0 0 1px var(--jbl-accent);
  }
  .timers-compact .tc-q.on {
    border-color: var(--jbl-accent);
    background: rgba(var(--jbl-accent-rgb), 0.12);
    color: var(--jbl-accent-text);
  }
  .timers-compact .tc-q ha-icon {
    --mdc-icon-size: 16px;
    flex: none;
  }
  .timers-compact .tc-q > span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Forms */
  .timers-compact .tc-form,
  .timers-compact .tc-compose {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .timers-compact .tc-form {
    padding: 8px;
    border-radius: var(--jbl-radius-sm);
    background: var(--jbl-surface);
  }
  .timers-compact .tc-form-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 76px;
    gap: 6px;
  }
  .timers-compact .tc-form .field > label {
    font-size: 0.72rem;
  }
  .timers-compact .field input[type="text"],
  .timers-compact .field input[type="number"],
  .timers-compact .tc-input input {
    width: 100%;
    padding: 5px 8px;
  }
  .timers-compact .tc-form-row,
  .timers-compact .tc-options {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .timers-compact .tc-spacer {
    flex: 1 1 0;
  }
  .timers-compact .tc-mini-seg {
    width: auto;
    flex: 1 1 auto;
    padding: 2px;
  }
  .timers-compact .tc-mini-seg button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 28px;
    padding: 3px 8px;
    font-size: 0.8rem;
  }
  .timers-compact .tc-switch {
    min-height: 28px;
    box-sizing: border-box;
    padding: 3px 8px;
    gap: 5px;
    font-size: 0.8rem;
  }
  .timers-compact .tc-switch ha-icon {
    --mdc-icon-size: 16px;
  }

  /* Recent chips */
  .timers-compact .tc-recent {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 2px;
  }
  .timers-compact .tc-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .timers-compact .tc-chip {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--jbl-border);
    border-radius: 999px;
    background: var(--jbl-card-bg);
    font-size: 0.78rem;
  }
  .timers-compact .tc-chip-run {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    min-height: 28px;
    padding: 2px 2px 2px 10px;
    border: 0;
    background: transparent;
    border-radius: 999px 0 0 999px;
    cursor: pointer;
    -webkit-touch-callout: none;
    user-select: none;
  }
  .timers-compact .tc-chip-run > span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .timers-compact .tc-chip-run:disabled {
    cursor: default;
    color: var(--jbl-disabled);
  }
  .timers-compact .tc-chip-run .spinner {
    width: 10px;
    height: 10px;
  }
  .timers-compact .tc-chip-x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 28px;
    height: 28px;
    padding: 0;
    margin-right: 1px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--jbl-muted);
    cursor: pointer;
  }
  .timers-compact .tc-chip-x ha-icon {
    --mdc-icon-size: 14px;
  }
  .timers-compact .tc-chip-x:hover {
    background: var(--jbl-surface);
    color: var(--jbl-text);
  }

  /* Messages */
  .timers-compact .tc-msg-icon {
    --mdc-icon-size: 16px;
    flex: none;
    color: var(--jbl-muted);
  }
  .timers-compact .tc-message.showing .tc-msg-icon {
    color: var(--jbl-accent-text);
  }
  .timers-compact .tc-id {
    font-weight: 400;
    font-size: 0.8rem;
    color: var(--jbl-muted);
  }
  .timers-compact .tc-status {
    flex: none;
    font-size: 0.72rem;
    font-weight: 500;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--jbl-surface);
    color: var(--jbl-muted);
    white-space: nowrap;
  }
  .timers-compact .tc-message.showing .tc-status {
    background: rgba(var(--jbl-accent-rgb), 0.14);
    color: var(--jbl-accent-text);
  }
  /* The message text wins over its length: the length shrinks first. */
  .timers-compact .tc-message .tc-name {
    flex: 1 1 auto;
  }
  .timers-compact .tc-len {
    flex: 0 20 auto;
    min-width: 3em;
    max-width: 40%;
    /* A block (not flex), so the text itself gets the ellipsis. */
    display: block;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 0.75rem;
    color: var(--jbl-muted);
  }
  .timers-compact jbl-bar-countdown.tc-msg-left {
    font-variant-numeric: tabular-nums;
  }
  .timers-compact .tc-when-on {
    --mdc-icon-size: 13px;
    margin-left: 4px;
    vertical-align: -2px;
  }
  .timers-compact .tc-compose {
    margin-top: 2px;
  }
  .timers-compact .tc-compose-head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .timers-compact .tc-compose-head .tc-cap {
    flex: none;
  }
  /* What the display will show: a strip in the accent colour, aligned to the right of the caption. */
  .timers-compact .tc-lcd {
    flex: 0 1 auto;
    min-width: 0;
    margin-left: auto;
    padding: 1px 8px;
    border-radius: 4px;
    background: var(--jbl-surface);
    box-shadow: inset 0 0 0 1px var(--jbl-border);
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.8rem;
    letter-spacing: 0.1em;
    color: var(--jbl-accent-text);
    white-space: pre;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .timers-compact .tc-lcd.empty {
    color: var(--jbl-muted);
    opacity: 0.6;
  }
  .timers-compact .tc-send-row {
    display: flex;
    gap: 6px;
    align-items: stretch;
  }
  .timers-compact .tc-input {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
  }
  .timers-compact .tc-input input {
    font: inherit;
    color: var(--jbl-text);
    background: var(--jbl-card-bg);
    border: 1px solid var(--jbl-border);
    border-radius: var(--jbl-radius-sm);
    box-sizing: border-box;
    min-width: 0;
    padding-right: 48px;
  }
  .timers-compact .tc-input input[aria-invalid="true"] {
    border-color: var(--jbl-warning);
  }
  .timers-compact .tc-counter {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    color: var(--jbl-muted);
    pointer-events: none;
  }
  .timers-compact .tc-counter.warn {
    color: var(--jbl-text);
    font-weight: 600;
  }
  .timers-compact .tc-send {
    flex: none;
    padding: 5px 12px;
  }
  .timers-compact .tc-stepper button {
    width: 28px;
    height: 28px;
  }
  .timers-compact .tc-stepper ha-icon {
    --mdc-icon-size: 16px;
  }
  .timers-compact .tc-repeat {
    min-width: 64px;
    font-size: 0.82rem;
  }
  .timers-compact .tc-duration {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .timers-compact .tc-duration select {
    padding: 4px 8px;
    font-size: 0.85rem;
  }

  /* Clock */
  .timers-compact .tc-clock-switch {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--jbl-border);
    border-radius: var(--jbl-radius-sm);
    background: var(--jbl-card-bg);
    cursor: pointer;
    text-align: start;
  }
  .timers-compact .tc-clock-switch.on {
    border-color: var(--jbl-accent);
    background: rgba(var(--jbl-accent-rgb), 0.1);
  }
  .timers-compact .tc-clock-switch:disabled {
    cursor: default;
    color: var(--jbl-disabled);
  }
  .timers-compact .tc-clock-label {
    flex: 1 1 auto;
    font-weight: 500;
  }
  .timers-compact .tc-clock-when {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 4px;
  }
  .timers-compact .tc-clock-when .tc-mini-seg {
    width: 100%;
  }

  /* Narrow cards: the secondary row items go first, so the name keeps its room. */
  @container (max-width: 420px) {
    .timers-compact .tc-ends {
      display: none;
    }
  }
  /* Icons instead of the labels (the labels stay for screen readers), like the card's own tabs. */
  @container (max-width: 380px) {
    /* Icons and badges only: equal widths. */
    .timers-compact .tc-tabs button {
      flex: 1 1 0;
    }
    .timers-compact .tc-tab-icon {
      display: inline-flex;
    }
    .timers-compact .tc-tab-label {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  }
  @container (max-width: 360px) {
    /* The sound / on-bar icons stay for screen readers (the sr-only copy next to them). */
    .timers-compact .tc-meta {
      display: none;
    }
    /* The red row, the bell and Stop already say it; "Time's up!" stays for screen readers. */
    .timers-compact .tc-ring-text {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  }
  @container (max-width: 340px) {
    /* The status pill stays for screen readers only. */
    .timers-compact .tc-status {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
      border: 0;
    }
    .timers-compact .tc-custom ha-icon {
      display: none;
    }
  }
`;
