import { css, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import { DISPLAY_CHAR, DISPLAY_TEXT_MAX, TIMER_SOUNDS, foldDisplayText, invalidDisplayChars, parseServiceError } from "../services";
import { selectOptions } from "../state";
import type { DisplayMessageOptions, TimerStartOptions, TimerSound } from "../services";
import type { HassEntity, HomeAssistant, TabContext } from "../types";

/**
 * Timers tab: running timers with a live countdown, quick and custom timers, recent timers,
 * messages on the bar's display (list, compose, recent) and the display clock.
 *
 * Countdowns are drawn by <jbl-bar-countdown> elements that repaint themselves once a second,
 * so the card is NOT re-rendered every second (no ctx.wantTick()).
 */

/** Pending keys used by this tab. Per-item keys append the item id. */
export const TIMERS_KEYS = {
  start: "timers.start",
  cancel: "timers.cancel.",
  extend: "timers.extend.",
  stopAll: "timers.stop_all",
  recent: "timers.recent.",
  forget: "timers.forget.",
  send: "timers.send",
  clear: "timers.clear.",
  clearAll: "timers.clear_all",
  clock: "timers.clock",
  clockWhen: "timers.clock_when",
} as const;

/** Quick timer buttons (minutes), as in the integration's timers package. */
export const QUICK_MINUTES = [1, 5, 10, 15] as const;
/** The remote runs at most this many timers. */
export const MAX_TIMERS = 8;
/** timer_start accepts 1 s .. 12 h; the form asks for whole minutes. */
export const MAX_TIMER_MINUTES = 720;
/** Message duration choices in minutes (display_message accepts 1 s .. 24 h). */
export const MESSAGE_DURATIONS = [1, 5, 15, 30, 60, 120, 240] as const;
/** Holding a recent chip this long forgets it. */
export const LONG_PRESS_MS = 550;
/** After a long press forgot a chip, a click on that slot within this time belongs to the same gesture. */
export const SUPPRESS_CLICK_MS = 1000;
/** A restarted recent item leaves its slot (it is running now): wait at most this long for that. */
const RECENT_RESTART_WAIT_MS = 5000;
/**
 * After a forget or restart, ignore the same action on that slot this long: the next item moves
 * into the slot as soon as HA reports the change, often before the call returns, so the second
 * click of a double click would otherwise hit it.
 */
export const RECENT_SLOT_GUARD_MS = 800;

/** Timer names use the same characters as display messages (the remote checks both with displayText). */
const TIMER_NAME_CHAR = DISPLAY_CHAR;

/* ------------------------------------------------------------------ */
/* Data from the timers / messages sensors                             */
/* ------------------------------------------------------------------ */

/** One item of sensor timers.attributes.timers (integration v0.13.2). */
export interface TimerItem {
  id: string;
  /** Folded name (upper case, no accents); "" when unnamed. */
  name: string;
  ringing: boolean;
  /** End time in ms epoch; null while ringing. */
  endsAt: number | null;
  /** show_time_left on the bar. */
  countdown: boolean;
  sound: string;
  /** Full length including added time; null on older remotes (no +1 min there). */
  durationS: number | null;
}

/** One item of sensor messages.attributes.messages. */
export interface MessageItem {
  id: string;
  /** = id when named, "" for the unnamed ("default") message. */
  name: string;
  text: string;
  mode: "passes" | "duration" | "forever";
  passesLeft: number | null;
  endsAt: number | null;
  /** Remaining seconds of a held duration message (it has not started yet). */
  durationS: number | null;
  showing: boolean;
  whenOn: boolean;
  held: boolean;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const time = (v: unknown): number | null => {
  if (typeof v !== "string" || !v) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
};

/** The running timers from the timers sensor (ringing first, then soonest end, as the integration sorts them). */
export function timerItems(state: HassEntity | undefined): TimerItem[] {
  const list = state?.attributes.timers;
  if (!Array.isArray(list)) return [];
  const out: TimerItem[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = str(r.id);
    if (!id) continue;
    out.push({
      id,
      name: str(r.name),
      ringing: r.ringing === true,
      endsAt: time(r.ends_at),
      countdown: r.countdown === true,
      sound: str(r.sound) || "off",
      durationS: num(r.duration_s),
    });
  }
  return out;
}

/** The messages from the messages sensor, in the remote's order. */
export function messageItems(state: HassEntity | undefined): MessageItem[] {
  const list = state?.attributes.messages;
  if (!Array.isArray(list)) return [];
  const out: MessageItem[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = str(r.id) || "default";
    const mode = r.mode === "duration" || r.mode === "forever" ? r.mode : "passes";
    out.push({
      id,
      name: str(r.name),
      text: str(r.text),
      mode,
      passesLeft: num(r.passes_left),
      endsAt: time(r.ends_at),
      durationS: num(r.duration_s),
      showing: r.showing === true,
      whenOn: r.when_on === true,
      held: r.held === true,
    });
  }
  return out;
}

/** Characters a timer name may not use (letters, digits, space and - . ' are allowed after folding). */
export function invalidTimerNameChars(name: string): string[] {
  const bad = new Set<string>();
  for (const ch of foldDisplayText(name)) if (!TIMER_NAME_CHAR.test(ch)) bad.add(ch);
  return [...bad];
}

/** Words the integration (lines.py TEXT, en and fr only) puts in the recent buttons' names. */
const RECENT_UNNAMED = new Set(["Timer", "Minuteur"]);
const RECENT_FOREVER = new Set(["until cleared", "jusqu'à effacement"]);
const RECENT_WHEN_ON = new Set(["when the bar is on", "à l'allumage"]);

/**
 * A recent button's name in the card's language. The integration writes it once, in the HA
 * server's language (en or fr): "<text> · 10 min", "Timer · 1 h", "<text> (id) · 3 times · when the
 * bar is on". The user's own text is kept; the known words and lengths are translated.
 */
export function recentLabel(ctx: Pick<TabContext, "t">, kind: "timer" | "message", raw: string): string {
  const parts = raw.split(" · ");
  if (parts.length < 2) return raw;
  return parts
    .map((part, i) => {
      if (i === 0) return kind === "timer" && RECENT_UNNAMED.has(part) ? ctx.t("timers.unnamed") : part;
      let m = part.match(/^(\d+) min$/);
      if (m) return lengthLabel(ctx, Number(m[1]));
      m = part.match(/^(\d+) h$/);
      if (m) return lengthLabel(ctx, Number(m[1]) * 60);
      m = part.match(/^(\d+) (?:times|fois)$/);
      if (m) return ctx.t("timers.repeat_times", { count: Number(m[1]) });
      if (RECENT_FOREVER.has(part)) return ctx.t("timers.msg_forever");
      if (RECENT_WHEN_ON.has(part)) return ctx.t("timers.msg_when_on");
      return part;
    })
    .join(" · ");
}

/** "15 min", "1 h", "1 h 30 min" in the tab's language. */
export function lengthLabel(ctx: Pick<TabContext, "t">, totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  if (m < 60) return ctx.t("timers.len_min", { n: m });
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? ctx.t("timers.len_h_min", { h, m: rest }) : ctx.t("timers.len_h", { n: h });
}

/* ------------------------------------------------------------------ */
/* <jbl-bar-countdown> lives in ../countdown (shared by any tab)       */
/* ------------------------------------------------------------------ */

export { COUNTDOWN_TAG, JblBarCountdown } from "../countdown";

/* ------------------------------------------------------------------ */
/* Local UI state                                                      */
/* ------------------------------------------------------------------ */

type MessageMode = "repeat" | "duration" | "forever";

interface TimersLocal {
  formOpen: boolean;
  name: string;
  minutes: string;
  sound: TimerSound;
  showLeft: boolean;
  text: string;
  mode: MessageMode;
  repeat: number;
  durationMin: number;
  clearOnKey: boolean;
  whenOn: boolean;
  /** Long-press timer on a recent chip. */
  pressHandle?: ReturnType<typeof setTimeout>;
  /** The recent button whose next click must be ignored (it ended a long press), and when it fired. */
  suppressClick?: { id: string; at: number };
  /** The remote refused when_on (display_when_on_unsupported): hide the option for this session. */
  whenOnUnsupported?: boolean;
  /** "<action>:<slot id>" -> ms epoch until which that action on that slot is ignored. */
  slotGuard: Record<string, number>;
}

const initLocal = (): TimersLocal => ({
  formOpen: false,
  name: "",
  minutes: "10",
  sound: "unless_tv",
  showLeft: true,
  text: "",
  // Same defaults as the integration's messages package.
  mode: "forever",
  repeat: 3,
  durationMin: 15,
  clearOnKey: true,
  whenOn: false,
  slotGuard: {},
});

const localOf = (ctx: TabContext): TimersLocal => ctx.local<TimersLocal>("timers", initLocal);

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

export function renderTimersTab(ctx: TabContext): TemplateResult {
  const { entities } = ctx;
  return html`
    <div class="timers">
      ${entities.timers ? renderTimers(ctx) : nothing} ${entities.messages ? renderMessages(ctx) : nothing}
      ${entities.display_clock ? renderClock(ctx) : nothing}
    </div>
  `;
}

/* ---------------- Timers ---------------- */

function timerName(ctx: TabContext, item: TimerItem): string {
  return item.name || ctx.t("timers.unnamed");
}

function renderTimers(ctx: TabContext): TemplateResult {
  const { t } = ctx;
  const sensor = ctx.stateOf(ctx.entities.timers);
  const available = ctx.isAvailable(ctx.entities.timers);
  const items = timerItems(sensor);
  const timersId = ctx.entities.timers!;

  const stopAll = async (): Promise<void> => {
    const ok = await ctx.confirm({
      title: t("timers.stop_all_title"),
      message: t("timers.stop_all_message"),
      confirmLabel: t("timers.stop_all"),
      destructive: true,
    });
    if (!ok) return;
    void ctx.call(TIMERS_KEYS.stopAll, () => ctx.services.timerCancel({ all: true }), {
      until: (hass) => timerItems(hass.states[timersId]).length === 0,
    });
  };

  return html`
    <div class="section timers-list">
      <div class="section-title">
        <span class="title-count"
          >${t("timers.timers_title")}${items.length ? html`<span class="badge">${items.length}</span>` : nothing}</span
        >
        ${items.length > 1
          ? html`<button
              class="btn small ghost ${ctx.isPending(TIMERS_KEYS.stopAll) ? "pending" : ""}"
              ?disabled=${ctx.barUnavailable}
              @click=${stopAll}
            >
              ${t("timers.stop_all")}
            </button>`
          : nothing}
      </div>
      ${!available
        ? html`<div class="hint">${t("timers.unavailable")}</div>`
        : items.length
          ? html`<div class="list">${repeat(items, (item) => item.id, (item) => renderTimer(ctx, item, timersId))}</div>`
          : html`<div class="hint">${t("timers.no_timers")}</div>`}
      ${available ? renderStart(ctx, items) : nothing} ${renderRecent(ctx, "timer")}
    </div>
  `;
}

function renderTimer(ctx: TabContext, item: TimerItem, timersId: string): TemplateResult {
  const { t } = ctx;
  const name = timerName(ctx, item);
  const cancelKey = TIMERS_KEYS.cancel + item.id;
  const extendKey = TIMERS_KEYS.extend + item.id;
  const gone = (hass: HomeAssistant): boolean =>
    !timerItems(hass.states[timersId]).some((x) => x.id === item.id);
  const cancel = (): void => {
    void ctx.call(cancelKey, () => ctx.services.timerCancel({ id: item.id }), { until: gone });
  };

  if (item.ringing) {
    return html`
      <div class="list-item timer ringing" role="alert">
        <ha-icon class="t-icon bell" .icon=${"mdi:bell-ring"}></ha-icon>
        <div class="grow">
          <div class="t-name">${name}</div>
          <div class="t-meta">${t("timers.ringing")}</div>
        </div>
        <button
          class="btn danger filled stop ${ctx.isPending(cancelKey) ? "pending" : ""}"
          ?disabled=${ctx.barUnavailable}
          aria-label=${t("timers.stop_label", { name })}
          @click=${cancel}
        >
          <ha-icon .icon=${"mdi:stop"}></ha-icon>${t("timers.stop")}
        </button>
      </div>
    `;
  }

  const endsAt = item.endsAt;
  const extend = (): void => {
    void ctx.call(extendKey, () => ctx.services.timerExtend({ id: item.id }), {
      value: endsAt,
      until: (hass) => {
        const now = timerItems(hass.states[timersId]).find((x) => x.id === item.id);
        return !now || now.endsAt !== endsAt;
      },
    });
  };
  const soundIcon = item.sound === "always" ? "mdi:volume-high" : item.sound === "unless_tv" ? "mdi:television-off" : "mdi:volume-off";
  const soundLabel = t(`timers.sound_${TIMER_SOUNDS.includes(item.sound as TimerSound) ? item.sound : "off"}`);

  return html`
    <div class="list-item timer">
      <ha-icon class="t-icon" .icon=${"mdi:timer-outline"}></ha-icon>
      <div class="grow">
        <div class="t-head">
          <span class="t-name">${name}</span>
          <jbl-bar-countdown class="t-left" .kind=${"text"} .endsAt=${endsAt}></jbl-bar-countdown>
        </div>
        ${item.durationS && endsAt !== null
          ? html`<jbl-bar-countdown class="t-progress" .kind=${"progress"} .total=${item.durationS} .endsAt=${endsAt}
              aria-label=${name}></jbl-bar-countdown>`
          : nothing}
        <div class="t-meta">
          ${endsAt !== null ? html`<span>${t("timers.ends_at", { time: ctx.formatTime(endsAt) })}</span>` : nothing}
          <ha-icon class="meta-icon" .icon=${soundIcon} title=${soundLabel} aria-label=${soundLabel}></ha-icon>
          ${item.countdown
            ? html`<ha-icon
                class="meta-icon"
                .icon=${"mdi:clock-digital"}
                title=${t("timers.countdown_on_bar")}
                aria-label=${t("timers.countdown_on_bar")}
              ></ha-icon>`
            : nothing}
        </div>
      </div>
      ${item.durationS !== null
        ? html`<button
            class="btn small extend ${ctx.isPending(extendKey) ? "pending" : ""}"
            ?disabled=${ctx.barUnavailable}
            aria-label=${t("timers.add_minute_label", { name })}
            title=${t("timers.add_minute_label", { name })}
            @click=${extend}
          >
            ${t("timers.add_minute")}
          </button>`
        : nothing}
      <button
        class="icon-btn plain cancel ${ctx.isPending(cancelKey) ? "pending" : ""}"
        ?disabled=${ctx.barUnavailable}
        aria-label=${t("timers.cancel_timer", { name })}
        title=${t("timers.cancel_timer", { name })}
        @click=${cancel}
      >
        <ha-icon .icon=${"mdi:close"}></ha-icon>
      </button>
    </div>
  `;
}

function renderStart(ctx: TabContext, items: TimerItem[]): TemplateResult {
  const { t } = ctx;
  const local = localOf(ctx);
  const timersId = ctx.entities.timers!;
  const pendingStart = ctx.pendingValue<string>(TIMERS_KEYS.start);

  const start = (which: string, options: TimerStartOptions): Promise<boolean> => {
    // A second tap while a start is on its way would start a duplicate (the remote refuses it).
    if (ctx.isPending(TIMERS_KEYS.start)) return Promise.resolve(false);
    if (items.length >= MAX_TIMERS) {
      ctx.showError(t("timers.err_too_many", { max: MAX_TIMERS }), TIMERS_KEYS.start);
      return Promise.resolve(false);
    }
    const before = new Set(items.map((x) => x.id));
    return ctx.call(TIMERS_KEYS.start, () => ctx.services.timerStart(options), {
      value: which,
      until: (hass) => timerItems(hass.states[timersId]).some((x) => !before.has(x.id)),
    });
  };

  const quick = (minutes: number): void => {
    if (ctx.isPending(TIMERS_KEYS.start)) return;
    if (items.some((x) => x.name === "")) {
      ctx.showError(t("timers.err_unnamed_running"), TIMERS_KEYS.start);
      return;
    }
    void start(`quick:${minutes}`, { duration: { minutes }, sound: "unless_tv" });
  };

  return html`
    <div class="start">
      <div class="row quick" role="group" aria-label=${t("timers.start")}>
        ${QUICK_MINUTES.map(
          (minutes) => html`<button
            class="btn quick-btn ${pendingStart === `quick:${minutes}` ? "pending" : ""}"
            ?disabled=${ctx.barUnavailable}
            aria-label=${t("timers.quick_label", { n: minutes })}
            @click=${() => quick(minutes)}
          >
            ${t("timers.quick_min", { n: minutes })}
          </button>`,
        )}
        <button
          class="btn quick-btn custom ${local.formOpen ? "primary" : ""}"
          aria-expanded=${String(local.formOpen)}
          @click=${() => {
            local.formOpen = !local.formOpen;
            ctx.requestUpdate();
          }}
        >
          ${t("timers.custom")}
        </button>
      </div>
      ${local.formOpen ? renderTimerForm(ctx, items, start) : nothing} ${ctx.renderError(TIMERS_KEYS.start)}
    </div>
  `;
}

function renderTimerForm(
  ctx: TabContext,
  items: TimerItem[],
  start: (which: string, options: TimerStartOptions) => Promise<boolean>,
): TemplateResult {
  const { t } = ctx;
  const local = localOf(ctx);
  const folded = foldDisplayText(local.name);
  const badChars = invalidTimerNameChars(local.name);
  const pending = ctx.pendingValue<string>(TIMERS_KEYS.start) === "custom";

  const submit = async (ev: Event): Promise<void> => {
    ev.preventDefault();
    if (ctx.isPending(TIMERS_KEYS.start)) return;
    // Validation errors show in the form (ctx.renderError(TIMERS_KEYS.start) under it).
    const minutes = Number(local.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_TIMER_MINUTES) {
      ctx.showError(t("timers.err_minutes", { max: MAX_TIMER_MINUTES }), TIMERS_KEYS.start);
      return;
    }
    if (badChars.length) {
      ctx.showError(t("timers.err_name_chars", { chars: badChars.join(" ") }), TIMERS_KEYS.start);
      return;
    }
    if (items.some((x) => x.name === folded)) {
      ctx.showError(folded ? t("timers.err_name_taken", { name: folded }) : t("timers.err_unnamed_running"), TIMERS_KEYS.start);
      return;
    }
    const ok = await start("custom", {
      duration: { minutes },
      name: local.name.trim() || undefined,
      sound: local.sound,
      show_time_left: local.showLeft,
    });
    if (ok) {
      local.name = "";
      local.formOpen = false;
      ctx.requestUpdate();
    }
  };

  return html`
    <form class="timer-form form" novalidate @submit=${submit}>
      <div class="field">
        <label for="timers-name">${t("timers.name")}</label>
        <input
          id="timers-name"
          type="text"
          maxlength=${DISPLAY_TEXT_MAX}
          autocomplete="off"
          .value=${live(local.name)}
          @input=${(ev: Event) => {
            local.name = (ev.target as HTMLInputElement).value;
            ctx.requestUpdate();
          }}
        />
        ${badChars.length
          ? html`<div class="hint warn-text">${t("timers.err_name_chars", { chars: badChars.join(" ") })}</div>`
          : folded
            ? html`<div class="hint">${t("timers.name_preview", { text: folded })}</div>`
            : html`<div class="hint">${t("timers.name_hint")}</div>`}
      </div>
      <div class="form-row">
        <div class="field minutes">
          <label for="timers-minutes">${t("timers.minutes")}</label>
          <input
            id="timers-minutes"
            type="number"
            inputmode="numeric"
            min="1"
            max=${MAX_TIMER_MINUTES}
            step="1"
            .value=${live(local.minutes)}
            @input=${(ev: Event) => {
              local.minutes = (ev.target as HTMLInputElement).value;
            }}
          />
        </div>
        <div class="field grow">
          <label id="timers-sound-label">${t("timers.sound")}</label>
          <div class="seg" role="radiogroup" aria-labelledby="timers-sound-label">
            ${TIMER_SOUNDS.map(
              (sound) => html`<button
                type="button"
                role="radio"
                aria-checked=${String(local.sound === sound)}
                class=${local.sound === sound ? "active" : ""}
                title=${t(`timers.sound_${sound}`)}
                @click=${() => {
                  local.sound = sound;
                  ctx.requestUpdate();
                }}
              >
                ${t(`timers.sound_opt_${sound}`)}
              </button>`,
            )}
          </div>
        </div>
      </div>
      <div class="chips">
        <button
          type="button"
          class="chip ${local.showLeft ? "on" : ""}"
          role="switch"
          aria-checked=${String(local.showLeft)}
          @click=${() => {
            local.showLeft = !local.showLeft;
            ctx.requestUpdate();
          }}
        >
          <ha-icon .icon=${"mdi:clock-digital"}></ha-icon><span>${t("timers.show_time_left")}</span>
          <span class="switch-knob" aria-hidden="true"></span>
        </button>
      </div>
      <div class="row actions">
        <button
          type="button"
          class="btn ghost"
          @click=${() => {
            local.formOpen = false;
            ctx.requestUpdate();
          }}
        >
          ${t("timers.close_form")}
        </button>
        <button type="submit" class="btn primary ${pending ? "pending" : ""}" ?disabled=${ctx.barUnavailable || badChars.length > 0}>
          <ha-icon .icon=${"mdi:play"}></ha-icon>${t("timers.start_button")}
        </button>
      </div>
    </form>
  `;
}

/* ---------------- Recent timers / messages ---------------- */

function renderRecent(ctx: TabContext, kind: "timer" | "message"): TemplateResult | typeof nothing {
  const { t } = ctx;
  const ids = (kind === "timer" ? ctx.entities.recentTimers : ctx.entities.recentMessages).filter((id) => ctx.isAvailable(id));
  if (!ids.length) return nothing;
  const local = localOf(ctx);
  const icon = kind === "timer" ? "mdi:timer-refresh-outline" : "mdi:message-reply-text-outline";

  // Recent buttons are slots: once an item is forgotten or restarted (it runs now), the next one
  // moves into the same entity id. Keep the slot pending until it shows another item, so a second
  // click (double click, slow double tap) cannot hit the item that moved in.
  const labelOf = (hass: HomeAssistant, id: string): string | undefined => {
    const st = hass.states[id];
    return !st || st.state === "unavailable" ? undefined : String(st.attributes.friendly_name ?? id);
  };
  const slotBusy = (id: string): boolean => ctx.isPending(TIMERS_KEYS.forget + id) || ctx.isPending(TIMERS_KEYS.recent + id);
  /** False when this action on this slot ran a moment ago (see RECENT_SLOT_GUARD_MS); else arms the guard. */
  const takeSlot = (action: string, id: string): boolean => {
    const now = Date.now();
    const key = `${action}:${id}`;
    if ((local.slotGuard[key] ?? 0) > now) return false;
    local.slotGuard[key] = now + RECENT_SLOT_GUARD_MS;
    return true;
  };
  const forget = (id: string): void => {
    if (slotBusy(id) || !takeSlot("forget", id)) return;
    const label = labelOf(ctx.hass, id);
    void ctx.call(TIMERS_KEYS.forget + id, () => ctx.services.forgetRecent(id), {
      offline: true,
      until: (hass) => labelOf(hass, id) !== label,
    });
  };
  const restart = (id: string): void => {
    const suppress = local.suppressClick;
    if (suppress) {
      local.suppressClick = undefined;
      if (suppress.id === id && Date.now() - suppress.at < SUPPRESS_CLICK_MS) return;
    }
    if (slotBusy(id) || !takeSlot("restart", id)) return;
    const label = labelOf(ctx.hass, id);
    void ctx.call(TIMERS_KEYS.recent + id, () => ctx.services.press(id), {
      until: (hass) => labelOf(hass, id) !== label,
      timeoutMs: RECENT_RESTART_WAIT_MS,
    });
  };
  const cancelPress = (): void => {
    if (local.pressHandle !== undefined) clearTimeout(local.pressHandle);
    local.pressHandle = undefined;
  };
  const startPress = (id: string): void => {
    cancelPress();
    local.pressHandle = setTimeout(() => {
      local.pressHandle = undefined;
      local.suppressClick = { id, at: Date.now() };
      forget(id);
    }, LONG_PRESS_MS);
  };

  return html`
    <div class="recent recent-${kind}s">
      <div class="sub-title">${t(kind === "timer" ? "timers.recent_timers" : "timers.recent_messages")}</div>
      <div class="chips">
        ${repeat(
          ids,
          (id) => id,
          (id) => {
            const label = recentLabel(ctx, kind, String(ctx.stateOf(id)?.attributes.friendly_name ?? id));
            const busy = slotBusy(id);
            return html`<span class="recent-chip ${busy ? "pending" : ""}">
              <button
                class="chip restart"
                ?disabled=${ctx.barUnavailable}
                aria-busy=${busy ? "true" : "false"}
                title=${t("timers.restart_label", { label })}
                aria-label=${t("timers.restart_label", { label })}
                @click=${() => restart(id)}
                @pointerdown=${(ev: PointerEvent) => {
                  // A new gesture: a long press that ended without a click no longer counts.
                  local.suppressClick = undefined;
                  if (ev.button === 0) startPress(id);
                }}
                @pointerup=${cancelPress}
                @pointerleave=${cancelPress}
                @pointercancel=${cancelPress}
                @contextmenu=${(ev: Event) => {
                  ev.preventDefault();
                  cancelPress();
                  forget(id);
                }}
              >
                <ha-icon .icon=${icon}></ha-icon><span>${label}</span>
              </button>
              <button
                class="forget"
                aria-busy=${busy ? "true" : "false"}
                title=${t("timers.forget", { label })}
                aria-label=${t("timers.forget", { label })}
                @click=${() => forget(id)}
              >
                <ha-icon .icon=${"mdi:close"}></ha-icon>
              </button>
            </span>`;
          },
        )}
      </div>
      ${ctx.renderError(ids.flatMap((id) => [TIMERS_KEYS.recent + id, TIMERS_KEYS.forget + id]))}
      <div class="hint">${t("timers.recent_hint")}</div>
    </div>
  `;
}

/* ---------------- Messages ---------------- */

function renderMessages(ctx: TabContext): TemplateResult {
  const { t, entities } = ctx;
  const messagesId = entities.messages!;
  const available = ctx.isAvailable(messagesId);
  const items = messageItems(ctx.stateOf(messagesId));

  const clearAll = async (): Promise<void> => {
    const ok = await ctx.confirm({
      title: t("timers.clear_all_title"),
      message: t("timers.clear_all_message"),
      confirmLabel: t("timers.clear_all"),
      destructive: true,
    });
    if (!ok) return;
    const button = entities.clear_messages;
    void ctx.call(TIMERS_KEYS.clearAll, () => (button ? ctx.services.press(button) : ctx.services.displayCancel()), {
      until: (hass) => messageItems(hass.states[messagesId]).length === 0,
    });
  };

  return html`
    <div class="section messages">
      <div class="section-title">
        <span class="title-count"
          >${t("timers.messages_title")}${items.length ? html`<span class="badge">${items.length}</span>` : nothing}</span
        >
        ${items.length
          ? html`<button
              class="btn small ghost clear-all ${ctx.isPending(TIMERS_KEYS.clearAll) ? "pending" : ""}"
              ?disabled=${ctx.barUnavailable}
              @click=${clearAll}
            >
              ${t("timers.clear_all")}
            </button>`
          : nothing}
      </div>
      ${!available
        ? html`<div class="hint">${t("timers.messages_unavailable")}</div>`
        : items.length
          ? html`<div class="list">${repeat(items, (item) => item.id, (item) => renderMessage(ctx, item, messagesId))}</div>`
          : html`<div class="hint">${t("timers.no_messages")}</div>`}
      ${available ? renderCompose(ctx, messagesId) : nothing} ${renderRecent(ctx, "message")}
    </div>
  `;
}

function renderMessage(ctx: TabContext, item: MessageItem, messagesId: string): TemplateResult {
  const { t } = ctx;
  const key = TIMERS_KEYS.clear + item.id;
  const status = item.held
    ? html`<span class="badge">${t("timers.msg_held")}</span>`
    : item.showing
      ? html`<span class="badge info">${t("timers.msg_showing")}</span>`
      : html`<span class="badge">${t("timers.msg_waiting")}</span>`;
  const icon = item.held ? "mdi:power-sleep" : item.showing ? "mdi:message-text" : "mdi:message-text-clock-outline";

  let length: TemplateResult | string;
  if (item.mode === "forever") length = t("timers.msg_forever");
  else if (item.mode === "duration" && item.endsAt !== null)
    length = html`${t("timers.msg_until", { time: ctx.formatTime(item.endsAt) })} ·
      <jbl-bar-countdown class="m-left" .kind=${"text"} .endsAt=${item.endsAt}></jbl-bar-countdown>`;
  else if (item.mode === "duration" && item.durationS !== null)
    length = t("timers.msg_held_for", { length: lengthLabel(ctx, item.durationS / 60) });
  else if (item.mode === "passes" && item.passesLeft !== null) length = t("timers.msg_passes", { count: item.passesLeft });
  else length = "";

  const label = item.text || item.id;
  return html`
    <div class="list-item message ${item.showing ? "showing" : ""}">
      <ha-icon class="t-icon" .icon=${icon}></ha-icon>
      <div class="grow">
        <div class="m-head">
          <span class="m-text">${label}</span>
          ${item.name ? html`<span class="m-id muted">(${item.name})</span>` : nothing}
        </div>
        <div class="t-meta">
          ${status} ${length ? html`<span class="m-length">${length}</span>` : nothing}
          ${item.whenOn && !item.held ? html`<span>· ${t("timers.msg_when_on")}</span>` : nothing}
        </div>
      </div>
      <button
        class="icon-btn plain clear ${ctx.isPending(key) ? "pending" : ""}"
        ?disabled=${ctx.barUnavailable}
        aria-label=${t("timers.clear_message", { text: label })}
        title=${t("timers.clear_message", { text: label })}
        @click=${() =>
          ctx.call(key, () => ctx.services.displayCancel(item.id), {
            until: (hass) => !messageItems(hass.states[messagesId]).some((x) => x.id === item.id),
          })}
      >
        <ha-icon .icon=${"mdi:close"}></ha-icon>
      </button>
    </div>
  `;
}

/** What the compose form would send, or why it cannot. Exported for tests. */
export function composeMessage(local: {
  text: string;
  mode: MessageMode;
  repeat: number;
  durationMin: number;
  clearOnKey: boolean;
  whenOn: boolean;
}): DisplayMessageOptions {
  const options: DisplayMessageOptions = { message: local.text.trim() };
  if (local.mode === "repeat") options.repeat = Math.min(99, Math.max(1, Math.round(local.repeat)));
  else if (local.mode === "duration") options.duration = { minutes: local.durationMin };
  else options.forever = true;
  if (local.clearOnKey) options.clear_on_key = true;
  if (local.whenOn) options.when_on = true;
  return options;
}

function renderCompose(ctx: TabContext, messagesId: string): TemplateResult {
  const { t } = ctx;
  const local = localOf(ctx);
  const trimmed = local.text.trim();
  // Exactly what the remote stores and reports back (upper case, folded, spaces collapsed).
  const folded = foldDisplayText(trimmed);
  const badChars = invalidDisplayChars(trimmed);
  const tooLong = folded.length > DISPLAY_TEXT_MAX;
  const pending = ctx.isPending(TIMERS_KEYS.send);
  const canSend = Boolean(trimmed) && !badChars.length && !tooLong && !ctx.barUnavailable;

  const send = async (ev: Event): Promise<void> => {
    ev.preventDefault();
    // A second tap while the first send is on its way would show the message twice.
    if (!canSend || ctx.isPending(TIMERS_KEYS.send)) return;
    const options = composeMessage({ ...local, whenOn: local.whenOn && !local.whenOnUnsupported });
    const ok = await ctx.call(TIMERS_KEYS.send, () => ctx.services.displayMessage(options), {
      until: (hass) => messageItems(hass.states[messagesId]).some((x) => x.text === folded),
      onError: (err) => {
        // A remote with the Messages panel but without when_on: hide the option for this session.
        if (parseServiceError(err).translationKey !== "display_when_on_unsupported") return undefined;
        local.whenOnUnsupported = true;
        local.whenOn = false;
        return t("timers.when_on_unsupported");
      },
    });
    if (ok) {
      local.text = "";
      ctx.requestUpdate();
    }
  };
  const setLocal = (patch: Partial<TimersLocal>): void => {
    Object.assign(local, patch);
    ctx.requestUpdate();
  };
  const modes: MessageMode[] = ["repeat", "duration", "forever"];
  const durations = MESSAGE_DURATIONS.includes(local.durationMin as (typeof MESSAGE_DURATIONS)[number])
    ? [...MESSAGE_DURATIONS]
    : [...MESSAGE_DURATIONS, local.durationMin].sort((a, b) => a - b);

  return html`
    <form class="compose form" novalidate @submit=${send}>
      <div class="sub-title">${t("timers.compose")}</div>
      <div class="field">
        <div class="label-row">
          <label for="timers-text">${t("timers.text")}</label>
          <span id="timers-text-counter" class="counter ${tooLong ? "warn-text" : ""}"
            >${t("timers.counter", { n: folded.length, max: DISPLAY_TEXT_MAX })}</span
          >
        </div>
        <input
          id="timers-text"
          type="text"
          maxlength=${DISPLAY_TEXT_MAX}
          autocomplete="off"
          placeholder=${t("timers.text_placeholder")}
          aria-describedby="timers-text-counter"
          aria-invalid=${badChars.length || tooLong ? "true" : "false"}
          .value=${live(local.text)}
          @input=${(ev: Event) => setLocal({ text: (ev.target as HTMLInputElement).value })}
        />
      </div>
      <div class="lcd ${folded ? "" : "empty"}" role="img" aria-label=${t("timers.preview_label")} title=${t("timers.preview_label")}>${folded ||
        foldDisplayText(t("timers.text_placeholder"))}</div>
      ${badChars.length
        ? html`<div class="hint warn-text">${t("timers.msg_bad_chars", { chars: badChars.join(" ") })}</div>`
        : tooLong
          ? html`<div class="hint warn-text">${t("timers.msg_too_long", { n: folded.length, max: DISPLAY_TEXT_MAX })}</div>`
          : nothing}
      <div class="sr-only" role="status">
        ${badChars.length
          ? t("timers.msg_bad_chars", { chars: badChars.join(" ") })
          : tooLong
            ? t("timers.msg_too_long_live", { max: DISPLAY_TEXT_MAX })
            : ""}
      </div>
      <div class="seg mode" role="radiogroup" aria-label=${t("timers.mode")}>
        ${modes.map(
          (mode) => html`<button
            type="button"
            role="radio"
            aria-checked=${String(local.mode === mode)}
            class=${local.mode === mode ? "active" : ""}
            title=${t(`timers.mode_${mode}`)}
            @click=${() => setLocal({ mode })}
          >
            ${t(`timers.mode_${mode}`)}
          </button>`,
        )}
      </div>
      ${local.mode === "repeat"
        ? html`<div class="row mode-detail">
            <div class="stepper">
              <button
                type="button"
                ?disabled=${local.repeat <= 1}
                aria-label=${t("timers.repeat_less")}
                title=${t("timers.repeat_less")}
                @click=${() => setLocal({ repeat: Math.max(1, local.repeat - 1) })}
              >
                <ha-icon .icon=${"mdi:minus"}></ha-icon>
              </button>
              <span class="stepper-value repeat-value">${t("timers.repeat_times", { count: local.repeat })}</span>
              <button
                type="button"
                ?disabled=${local.repeat >= 99}
                aria-label=${t("timers.repeat_more")}
                title=${t("timers.repeat_more")}
                @click=${() => setLocal({ repeat: Math.min(99, local.repeat + 1) })}
              >
                <ha-icon .icon=${"mdi:plus"}></ha-icon>
              </button>
            </div>
          </div>`
        : local.mode === "duration"
          ? html`<div class="row mode-detail">
              <label class="muted" for="timers-duration">${t("timers.duration")}</label>
              <select
                id="timers-duration"
                class="select"
                @change=${(ev: Event) => setLocal({ durationMin: Number((ev.target as HTMLSelectElement).value) })}
              >
                ${durations.map(
                  (m) => html`<option value=${m} ?selected=${m === local.durationMin}>${lengthLabel(ctx, m)}</option>`,
                )}
              </select>
            </div>`
          : nothing}
      <div class="chips">
        <button
          type="button"
          class="chip ${local.clearOnKey ? "on" : ""}"
          role="switch"
          aria-checked=${String(local.clearOnKey)}
          @click=${() => setLocal({ clearOnKey: !local.clearOnKey })}
        >
          <ha-icon .icon=${"mdi:remote"}></ha-icon><span>${t("timers.clear_on_key")}</span>
          <span class="switch-knob" aria-hidden="true"></span>
        </button>
        ${local.whenOnUnsupported
          ? nothing
          : html`<button
              type="button"
              class="chip when-on ${local.whenOn ? "on" : ""}"
              role="switch"
              aria-checked=${String(local.whenOn)}
              title=${t("timers.when_on_hint")}
              @click=${() => setLocal({ whenOn: !local.whenOn })}
            >
              <ha-icon .icon=${"mdi:power"}></ha-icon><span>${t("timers.when_on")}</span>
              <span class="switch-knob" aria-hidden="true"></span>
            </button>`}
      </div>
      ${local.whenOn && !local.whenOnUnsupported ? html`<div class="hint">${t("timers.when_on_hint")}</div>` : nothing}
      ${ctx.renderError(TIMERS_KEYS.send)}
      <div class="row actions">
        <button
          type="submit"
          class="btn primary send ${pending ? "pending" : ""}"
          ?disabled=${!canSend}
          aria-busy=${pending ? "true" : "false"}
        >
          <ha-icon .icon=${"mdi:send"}></ha-icon>${t("timers.send")}
        </button>
      </div>
    </form>
  `;
}

/* ---------------- Clock ---------------- */

function renderClock(ctx: TabContext): TemplateResult {
  const { t, entities } = ctx;
  const clockId = entities.display_clock!;
  const clock = ctx.stateOf(clockId);
  const known = clock?.state === "on" || clock?.state === "off";
  const on = clock?.state === "on";
  const pendingOn = ctx.pendingValue<boolean>(TIMERS_KEYS.clock);
  const shownOn = pendingOn ?? on;

  const whenId = entities.display_clock_when;
  const when = ctx.stateOf(whenId);
  const options = selectOptions(when, ["standby", "always"]);
  const pendingWhen = ctx.pendingValue<string>(TIMERS_KEYS.clockWhen);
  const whenAvailable = ctx.isAvailable(whenId);

  return html`
    <div class="section clock">
      <div class="section-title">${t("timers.clock_title")}</div>
      <div class="chips">
        <button
          class="chip clock-switch ${shownOn ? "on" : ""} ${ctx.isPending(TIMERS_KEYS.clock) ? "pending" : ""}"
          role="switch"
          aria-checked=${String(shownOn)}
          ?disabled=${!known}
          @click=${() => {
            if (ctx.isPending(TIMERS_KEYS.clock)) return;
            void ctx.call(TIMERS_KEYS.clock, () => ctx.services.setSwitch(clockId, !on), {
              value: !on,
              until: (hass) => hass.states[clockId]?.state === (!on ? "on" : "off"),
            });
          }}
        >
          <ha-icon .icon=${"mdi:clock-digital"}></ha-icon><span>${t("timers.clock")}</span>
          <span class="switch-knob" aria-hidden="true"></span>
        </button>
      </div>
      ${whenId && when
        ? html`<div class="clock-when">
            <span class="muted" id="timers-clock-when">${t("timers.clock_when")}</span>
            <div class="seg" role="radiogroup" aria-labelledby="timers-clock-when">
              ${options.map((option) => {
                const active = (pendingWhen ?? when.state) === option;
                return html`<button
                  role="radio"
                  aria-checked=${String(when.state === option)}
                  class="${active ? "active" : ""} ${pendingWhen === option ? "pending" : ""}"
                  ?disabled=${!whenAvailable}
                  title=${t(`timers.clock_${option}`)}
                  @click=${() => {
                    if (option === when.state && pendingWhen === undefined) return;
                    void ctx.call(TIMERS_KEYS.clockWhen, () => ctx.services.selectOption(whenId, option), {
                      value: option,
                      until: (hass) => hass.states[whenId]?.state === option,
                    });
                  }}
                >
                  ${t(`timers.clock_${option}`)}
                </button>`;
              })}
            </div>
          </div>`
        : nothing}
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

export const timersStyles = css`
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
