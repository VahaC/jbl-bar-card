import { css, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { numericState } from "../format";
import { BAR_SOURCES, FEATURE, VOLUME_MAX } from "../services";
import { IMAGES } from "../assets";
import { LOW_BATTERY } from "../state";
import type { BarSource } from "../services";
import type { HomeAssistant, TabContext } from "../types";

/** Pending keys used by this tab (other tabs must use their own "<tab>." prefix). */
export const HOME_KEYS = {
  source: "home.source",
  volume: "home.volume",
  mute: "home.mute",
  smart: "home.smart_mode",
  standard: "home.standard_mode",
  night: "home.night",
  playback: "home.playback",
} as const;

interface HomeLocal {
  /** Volume while the slider is being dragged (not sent yet). */
  dragVolume?: number;
}

/** The bar's volume on its own 0..32 scale, or undefined. */
export function volumeStep(hass: HomeAssistant, mediaPlayer: string): number | undefined {
  const level = hass.states[mediaPlayer]?.attributes.volume_level;
  return typeof level === "number" ? Math.round(level * VOLUME_MAX) : undefined;
}

/** Material Design battery icon for a level (charging variants while docked). */
export function batteryIcon(level: number | undefined, charging: boolean): string {
  if (level === undefined) return "mdi:battery-unknown";
  const tens = Math.min(100, Math.max(0, Math.floor(level / 10) * 10));
  if (charging) return tens < 10 ? "mdi:battery-charging-outline" : `mdi:battery-charging-${tens}`;
  if (tens >= 100) return "mdi:battery";
  if (tens < 10) return "mdi:battery-outline";
  return `mdi:battery-${tens}`;
}

export function renderHomeTab(ctx: TabContext): TemplateResult {
  const mp = ctx.stateOf(ctx.entities.media_player);
  return html`
    <div class="home">
      ${renderRoom(ctx)}
      ${mp?.state === "off" ? html`<div class="hint standby">${ctx.t("home.standby_hint")}</div>` : nothing}
      ${renderSource(ctx)} ${renderVolume(ctx)} ${renderChips(ctx)} ${renderPlayback(ctx)}
    </div>
  `;
}

/* ---------------- Room visual ---------------- */

function renderRoom(ctx: TabContext): TemplateResult {
  const { entities, t } = ctx;
  const docked = ctx.stateOf(entities.rear_docked)?.state;
  const isDocked = docked === "on";
  const bass = ctx.stateOf(entities.bass)?.state;
  const bassLevel = bass && /^[1-5]$/.test(bass) ? bass : undefined;
  const hasRears = Boolean(entities.rear_battery_left || entities.rear_battery_right || entities.rear_docked);

  const battery = (side: "left" | "right") => {
    const id = side === "left" ? entities.rear_battery_left : entities.rear_battery_right;
    const level = numericState(ctx.stateOf(id)?.state);
    return { id, level, low: level !== undefined && level < LOW_BATTERY };
  };

  const batteryText = (side: "left" | "right"): TemplateResult | typeof nothing => {
    const { id, level, low } = battery(side);
    if (!id) return nothing;
    return html`<span class="batt" title=${low ? t("home.room.battery_low") : ""}>
      <ha-icon .icon=${batteryIcon(level, isDocked)}></ha-icon>${level !== undefined
        ? `${Math.round(level)}%`
        : t("common.unknown")}
    </span>`;
  };

  // Row 1 holds the pictures on one floor line, row 2 the labels. The
  // pictures are mouse shortcuts only; the labels are the focusable buttons.
  const rearPic = (side: "left" | "right"): TemplateResult => html`
    <div class="pic-cell ${side}" aria-hidden="true" @click=${() => ctx.moreInfo(battery(side).id)}>
      <img class="pic rear-pic" src=${side === "left" ? IMAGES.rearLeft : IMAGES.rearRight} alt="" />
    </div>
  `;

  const rear = (side: "left" | "right"): TemplateResult => {
    const { id, level, low } = battery(side);
    return html`
      <button
        class="spk rear ${side} ${low ? "low" : ""}"
        @click=${() => ctx.moreInfo(id)}
        ?disabled=${!id}
        aria-label=${`${t(`home.room.rear_${side}`)}${level !== undefined ? ` ${Math.round(level)}%` : ""}`}
        title=${t(`home.room.rear_${side}`)}
      >
        ${batteryText(side)}
      </button>
    `;
  };

  const dockLabel =
    docked === "on" || docked === "off"
      ? html`<span class="dock-label">${t(isDocked ? "home.room.rears_docked" : "home.room.rears_detached")}</span>`
      : html`<span class="spk-name">${t("home.room.bar")}</span>`;
  const showRearPics = hasRears && !isDocked;

  return html`
    <div class="room ${isDocked ? "docked" : ""} ${hasRears ? "" : "no-rears"}" role="group" aria-label=${t("home.room.label")}>
      ${showRearPics ? rearPic("left") : nothing}
      <div class="pic-cell bar" aria-hidden="true">
        <img class="pic bar-pic" src=${isDocked ? IMAGES.barDocked : IMAGES.barCenter} alt="" />
      </div>
      ${showRearPics ? rearPic("right") : nothing}
      <div class="pic-cell sub" aria-hidden="true" @click=${() => ctx.moreInfo(entities.bass)}>
        <img class="pic sub-pic" src=${IMAGES.subwoofer} alt="" />
      </div>
      ${hasRears ? rear("left") : nothing}
      <div class="bar-label">${dockLabel}</div>
      ${hasRears ? rear("right") : nothing}
      <button
        class="spk sub"
        @click=${() => ctx.moreInfo(entities.bass)}
        ?disabled=${!entities.bass}
        aria-label=${bassLevel ? `${t("home.room.subwoofer")}, ${t("home.room.bass", { level: bassLevel })}` : t("home.room.subwoofer")}
      >
        <span class="spk-name">${t("home.room.subwoofer")}</span>
        ${bassLevel ? html`<span class="bass">${t("home.room.bass", { level: bassLevel })}</span>` : nothing}
      </button>
    </div>
  `;
}

/* ---------------- Source ---------------- */

function renderSource(ctx: TabContext): TemplateResult {
  const mp = ctx.stateOf(ctx.entities.media_player);
  if (!mp) return html``;
  const list = Array.isArray(mp.attributes.source_list)
    ? (mp.attributes.source_list as string[]).filter((s): s is BarSource => (BAR_SOURCES as string[]).includes(s))
    : [...BAR_SOURCES];
  const current = typeof mp.attributes.source === "string" ? mp.attributes.source : undefined;
  const pendingTarget = ctx.pendingValue<string>(HOME_KEYS.source);
  const disabled = !ctx.barOn;
  const other = current && !(list as string[]).includes(current) ? current : undefined;
  const mediaPlayer = ctx.entities.media_player;

  const choose = (source: BarSource): void => {
    if (source === current && pendingTarget === undefined) return;
    void ctx.call(HOME_KEYS.source, () => ctx.services.selectSource(source), {
      value: source,
      until: (hass) => hass.states[mediaPlayer]?.attributes.source === source,
    });
  };

  return html`
    <div class="section">
      <div class="section-title">${ctx.t("home.source")}</div>
      <div class="seg" role="radiogroup" aria-label=${ctx.t("home.source")}>
        ${list.map(
          (source) => html`
            <button
              role="radio"
              aria-checked=${String(source === current)}
              class="${source === current ? "active" : ""} ${pendingTarget === source ? "pending" : ""}"
              ?disabled=${disabled}
              @click=${() => choose(source)}
            >
              ${source}
            </button>
          `,
        )}
      </div>
      ${other ? html`<div class="hint">${ctx.t("home.source_other", { source: other })}</div>` : nothing}
    </div>
  `;
}

/* ---------------- Volume ---------------- */

function renderVolume(ctx: TabContext): TemplateResult {
  const mp = ctx.stateOf(ctx.entities.media_player);
  if (!mp) return html``;
  const mediaPlayer = ctx.entities.media_player;
  const local = ctx.local<HomeLocal>("home", () => ({}));
  const current = volumeStep(ctx.hass, mediaPlayer);
  const pending = ctx.pendingValue<number>(HOME_KEYS.volume);
  const shown = local.dragVolume ?? pending ?? current;
  const muted = mp.attributes.is_volume_muted === true;
  const mutePending = ctx.isPending(HOME_KEYS.mute);
  const disabled = !ctx.barOn;
  const volPending = ctx.isPending(HOME_KEYS.volume);

  const step = (delta: 1 | -1): void => {
    const base = ctx.pendingValue<number>(HOME_KEYS.volume) ?? current;
    if (base === undefined) return;
    const target = Math.min(VOLUME_MAX, Math.max(0, base + delta));
    if (target === base) return;
    void ctx.call(HOME_KEYS.volume, () => (delta > 0 ? ctx.services.volumeUp() : ctx.services.volumeDown()), {
      value: target,
      until: (hass) => volumeStep(hass, mediaPlayer) === target,
    });
  };

  const onInput = (ev: Event): void => {
    local.dragVolume = Number((ev.target as HTMLInputElement).value);
    ctx.requestUpdate();
  };
  const onChange = (ev: Event): void => {
    const target = Number((ev.target as HTMLInputElement).value);
    local.dragVolume = undefined;
    if (target === current && pending === undefined) {
      ctx.requestUpdate();
      return;
    }
    void ctx.call(HOME_KEYS.volume, () => ctx.services.setVolume(target), {
      value: target,
      until: (hass) => volumeStep(hass, mediaPlayer) === target,
      timeoutMs: 60000,
    });
  };

  return html`
    <div class="section">
      <div class="section-title">
        <span>${ctx.t("home.volume")}</span>
        ${muted ? html`<span class="badge warn">${ctx.t("home.muted")}</span>` : nothing}
      </div>
      <div class="volume">
        <button
          class="icon-btn"
          ?disabled=${disabled || shown === undefined || shown <= 0}
          @click=${() => step(-1)}
          aria-label=${ctx.t("home.volume_down")}
          title=${ctx.t("home.volume_down")}
        >
          <ha-icon .icon=${"mdi:minus"}></ha-icon>
        </button>
        <div class="vol-number ${volPending ? "pending" : ""} ${muted ? "is-muted" : ""}" aria-live="polite">
          ${shown ?? ctx.t("common.unknown")}<span class="vol-max">/${VOLUME_MAX}</span>
        </div>
        <button
          class="icon-btn"
          ?disabled=${disabled || shown === undefined || shown >= VOLUME_MAX}
          @click=${() => step(1)}
          aria-label=${ctx.t("home.volume_up")}
          title=${ctx.t("home.volume_up")}
        >
          <ha-icon .icon=${"mdi:plus"}></ha-icon>
        </button>
        <button
          class="icon-btn mute ${muted ? "on" : ""} ${mutePending ? "pending" : ""}"
          ?disabled=${disabled}
          aria-pressed=${String(muted)}
          aria-label=${ctx.t(muted ? "home.unmute" : "home.mute")}
          title=${ctx.t(muted ? "home.unmute" : "home.mute")}
          aria-busy=${mutePending ? "true" : "false"}
          @click=${() => {
            // The integration toggles mute: a second tap before the first is confirmed would undo it.
            if (ctx.isPending(HOME_KEYS.mute)) return;
            void ctx.call(HOME_KEYS.mute, () => ctx.services.mute(!muted), {
              value: !muted,
              until: (hass) => (hass.states[mediaPlayer]?.attributes.is_volume_muted === true) === !muted,
            });
          }}
        >
          <ha-icon .icon=${muted ? "mdi:volume-off" : "mdi:volume-high"}></ha-icon>
        </button>
      </div>
      <input
        class="slider"
        type="range"
        min="0"
        max=${VOLUME_MAX}
        step="1"
        .value=${String(shown ?? 0)}
        ?disabled=${disabled || current === undefined}
        aria-label=${ctx.t("home.volume")}
        @input=${onInput}
        @change=${onChange}
      />
    </div>
  `;
}

/* ---------------- Chips: Smart mode, Night ---------------- */

function switchChip(ctx: TabContext, key: string, entityId: string | undefined, label: string, icon: string): TemplateResult {
  if (!entityId) return html``;
  const st = ctx.stateOf(entityId);
  const known = st?.state === "on" || st?.state === "off";
  const on = st?.state === "on";
  const pendingValue = ctx.pendingValue<boolean>(key);
  const shownOn = pendingValue ?? on;
  return html`
    <button
      class="chip ${shownOn ? "on" : ""} ${ctx.isPending(key) ? "pending" : ""}"
      role="switch"
      aria-checked=${String(shownOn)}
      ?disabled=${!known}
      aria-busy=${ctx.isPending(key) ? "true" : "false"}
      @click=${() => {
        // Night and Smart are toggles on the bar: a second tap while the first is pending would
        // send the same toggle again and flip the setting back.
        if (ctx.isPending(key)) return;
        void ctx.call(key, () => ctx.services.setSwitch(entityId, !on), {
          value: !on,
          until: (hass) => hass.states[entityId]?.state === (!on ? "on" : "off"),
        });
      }}
    >
      <ha-icon .icon=${icon}></ha-icon>
      <span>${label}</span>
      <span class="switch-knob" aria-hidden="true"></span>
    </button>
  `;
}

function renderChips(ctx: TabContext): TemplateResult {
  const { entities, t } = ctx;
  const smart = entities.smart_mode
    ? switchChip(ctx, HOME_KEYS.smart, entities.smart_mode, t("home.smart_mode"), "mdi:auto-fix")
    : entities.standard_mode
      ? html`<button
          class="chip ${ctx.isPending(HOME_KEYS.standard) ? "pending" : ""}"
          ?disabled=${!ctx.isAvailable(entities.standard_mode)}
          @click=${() => {
            if (!ctx.isPending(HOME_KEYS.standard)) void ctx.call(HOME_KEYS.standard, () => ctx.services.press(entities.standard_mode!));
          }}
        >
          <ha-icon .icon=${"mdi:auto-fix"}></ha-icon><span>${t("home.standard_mode")}</span>
        </button>`
      : nothing;
  const night = switchChip(ctx, HOME_KEYS.night, entities.night, t("home.night"), "mdi:weather-night");
  if (smart === nothing && !entities.night) return html``;
  return html`<div class="section"><div class="chips">${smart}${night}</div></div>`;
}

/* ---------------- Playback ---------------- */

type PlaybackAction = "previous" | "play" | "pause" | "stop" | "next";

function renderPlayback(ctx: TabContext): TemplateResult {
  const mp = ctx.stateOf(ctx.entities.media_player);
  if (!mp || !ctx.barOn) return html``;
  const features = Number(mp.attributes.supported_features ?? 0);
  const has = (bit: number): boolean => (features & bit) === bit;
  const playing = mp.state === "playing";
  const actions: PlaybackAction[] = [];
  if (has(FEATURE.PREVIOUS_TRACK)) actions.push("previous");
  if (playing && has(FEATURE.PAUSE)) actions.push("pause");
  else if (has(FEATURE.PLAY)) actions.push("play");
  else if (has(FEATURE.PAUSE)) actions.push("pause");
  if (has(FEATURE.STOP)) actions.push("stop");
  if (has(FEATURE.NEXT_TRACK)) actions.push("next");

  const title = typeof mp.attributes.media_title === "string" ? mp.attributes.media_title : "";
  const artist = typeof mp.attributes.media_artist === "string" ? mp.attributes.media_artist : "";
  const app = typeof mp.attributes.app_name === "string" ? mp.attributes.app_name : "";
  if (!actions.length && !title && !artist) return html``;

  const icons: Record<PlaybackAction, string> = {
    previous: "mdi:skip-previous",
    play: "mdi:play",
    pause: "mdi:pause",
    stop: "mdi:stop",
    next: "mdi:skip-next",
  };
  const run = (action: PlaybackAction): Promise<unknown> => {
    const s = ctx.services;
    switch (action) {
      case "previous":
        return s.mediaPrevious();
      case "play":
        return s.mediaPlay();
      case "pause":
        return s.mediaPause();
      case "stop":
        return s.mediaStop();
      case "next":
        return s.mediaNext();
    }
  };
  const pendingAction = ctx.pendingValue<PlaybackAction>(HOME_KEYS.playback);

  return html`
    <div class="section playback">
      ${title || artist
        ? html`<div class="now-playing">
            <div class="np-title">${title || artist}</div>
            <div class="np-sub">
              ${[title ? artist : "", app ? ctx.t("home.via", { app }) : ""].filter(Boolean).join(" · ")}
            </div>
          </div>`
        : nothing}
      ${actions.length
        ? html`<div class="row transport">
            ${actions.map(
              (action) => html`<button
                class="icon-btn ${action === "play" || action === "pause" ? "on big" : ""} ${pendingAction === action
                  ? "pending"
                  : ""}"
                aria-label=${ctx.t(`home.${action}`)}
                title=${ctx.t(`home.${action}`)}
                @click=${() => ctx.call(HOME_KEYS.playback, () => run(action), { value: action })}
              >
                <ha-icon .icon=${icons[action]}></ha-icon>
              </button>`,
            )}
          </div>`
        : nothing}
    </div>
  `;
}

export const homeStyles = css`
  .room {
    display: grid;
    grid-template-columns: minmax(0, 0.62fr) minmax(0, 2.6fr) minmax(0, 0.62fr) minmax(64px, 0.85fr);
    grid-template-areas:
      "lpic bar rpic subpic"
      "left lbl right sub";
    column-gap: 6px;
    row-gap: 6px;
    padding: 4px 0 2px;
  }
  .room.docked,
  .room.no-rears {
    grid-template-areas:
      "bar bar bar subpic"
      "left lbl right sub";
  }
  .pic-cell {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    min-width: 0;
    cursor: pointer;
  }
  .pic-cell.left {
    grid-area: lpic;
  }
  .pic-cell.right {
    grid-area: rpic;
  }
  .pic-cell.bar {
    grid-area: bar;
    cursor: default;
  }
  .pic-cell.sub {
    grid-area: subpic;
  }
  .pic {
    display: block;
    width: 100%;
    height: auto;
    user-select: none;
    -webkit-user-drag: none;
  }
  .sub-pic {
    max-width: 72px;
  }
  .spk {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 0;
    min-width: 0;
    align-self: start;
    border: none;
    border-radius: var(--jbl-radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .spk:disabled {
    cursor: default;
  }
  .spk:focus-visible {
    outline: 2px solid var(--jbl-accent);
    outline-offset: 2px;
  }
  .spk.left {
    grid-area: left;
  }
  .spk.right {
    grid-area: right;
  }
  .room.docked .spk.left {
    justify-self: start;
  }
  .room.docked .spk.right {
    justify-self: end;
  }
  .spk.sub {
    grid-area: sub;
  }
  .bar-label {
    grid-area: lbl;
    min-width: 0;
    text-align: center;
    line-height: 1.2;
  }
  .spk-name {
    color: var(--jbl-muted);
    max-width: 100%;
    text-align: center;
    line-height: 1.2;
    font-size: 0.75rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .batt {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .batt ha-icon {
    --mdc-icon-size: 16px;
  }
  .spk.low .batt {
    color: var(--jbl-text);
    font-weight: 600;
  }
  .spk.low .batt ha-icon {
    color: var(--jbl-warning);
  }
  .bass {
    font-weight: 500;
    color: var(--jbl-accent-text);
    white-space: nowrap;
  }
  .dock-label {
    font-size: 0.75rem;
    color: var(--jbl-muted);
    overflow-wrap: anywhere;
  }
  .standby {
    margin-top: 12px;
  }
  .volume {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .vol-number {
    flex: 1 1 auto;
    text-align: center;
    font-size: 2.4rem;
    font-weight: 300;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .vol-number.is-muted {
    color: var(--jbl-muted);
    text-decoration: line-through;
    text-decoration-thickness: 2px;
  }
  .vol-max {
    font-size: 0.9rem;
    color: var(--jbl-muted);
    margin-left: 2px;
  }
  .now-playing {
    min-width: 0;
  }
  .np-title {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .np-sub {
    font-size: 0.85rem;
    color: var(--jbl-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .transport {
    justify-content: center;
  }
  .transport .big {
    width: 44px;
    height: 44px;
  }
`;
