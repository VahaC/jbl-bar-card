// The "remote" Home layout: big touch targets like the JBL Bar 9.1 remote. A small room
// strip on top, the source keys as three large round buttons, a tall volume rocker beside
// big power and mute keys and the Smart/Night tiles, then the transport keys. It renders only from
// homeModel(); see docs/layouts-home.md. Strings: src/i18n/home_remote.ts ("home_remote.<key>").
// Every CSS selector here starts with .home-remote.
import { css, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import type { TabContext } from "../../types";
import type {
  HomeAction,
  HomeButton,
  HomeModel,
  HomePlayback,
  HomeRear,
  HomeRoom,
  HomeSource,
  HomeToggle,
  HomeVolume,
} from "../home-model";

/** Icons of the bar's own source keys; anything else falls back to a generic input icon. */
const SOURCE_ICONS: Record<string, string> = {
  TV: "mdi:television",
  HDMI: "mdi:video-input-hdmi",
  Bluetooth: "mdi:bluetooth",
};

export function renderRemote(ctx: TabContext, model: HomeModel): TemplateResult {
  // The standby hint is the reason of every disabled source/volume key: show it once, on top.
  const shown = model.standbyHint;
  return html`
    <div class="home-remote">
      ${renderRoom(ctx, model.room)}
      ${shown ? html`<div class="hint standby-hint" role="status">${shown}</div>` : nothing}
      ${renderSources(model.source, shown)}
      ${model.volume || model.modes ? renderDeck(ctx, model, shown) : nothing}
      ${renderPlayback(model.playback)}
    </div>
  `;
}

/** A reason in visible text next to a disabled control, unless the standby hint already says it. */
function reasonOf(a: { enabled: boolean; reason?: string }, shown: string | undefined): TemplateResult | typeof nothing {
  return !a.enabled && a.reason && a.reason !== shown ? html`<div class="hint reason">${a.reason}</div>` : nothing;
}

/* ---------------- Room strip ---------------- */

function renderRoom(ctx: TabContext, room: HomeRoom): TemplateResult {
  const rear = (side: "left" | "right"): HomeRear | undefined => room.rears.find((r) => r.side === side);
  const rearPic = (r: HomeRear | undefined): TemplateResult | typeof nothing =>
    r ? html`<img class="pic rear-pic ${r.side}" src=${r.image} alt="" />` : nothing;

  const rearPill = (r: HomeRear | undefined): TemplateResult | typeof nothing =>
    r && r.batteryText !== undefined
      ? html`
          <button
            class="pill rear ${r.side} ${r.low ? "low" : ""}"
            ?disabled=${!r.entity}
            aria-label=${r.batteryTitle ? `${r.label}, ${r.batteryTitle}` : r.label}
            title=${r.batteryTitle ? `${r.name} · ${r.batteryTitle}` : r.name}
            @click=${r.open}
          >
            <span class="side-letter" aria-hidden="true">${ctx.t(`home_remote.side_${r.side}`)}</span>
            <ha-icon .icon=${r.batteryIcon}></ha-icon>
            <span class="num">${r.batteryText}</span>
          </button>
        `
      : nothing;

  const { sub } = room;
  return html`
    <div class="room" role="group" aria-label=${room.label}>
      <div class="pics ${room.showRearPictures ? "apart" : ""}" aria-hidden="true">
        ${room.showRearPictures ? rearPic(rear("left")) : nothing}
        <img class="pic bar-pic" src=${room.barImage} alt="" />
        ${room.showRearPictures ? rearPic(rear("right")) : nothing}
        <img class="pic sub-pic" src=${sub.image} alt="" />
      </div>
      <div class="room-info">
        <div class="pills">
          ${rearPill(rear("left"))} ${rearPill(rear("right"))}
          ${sub.enabled
            ? html`<button class="pill sub" aria-label=${sub.label} title=${sub.name} @click=${sub.open}>
                <ha-icon .icon=${"mdi:speaker"}></ha-icon>
                <span class="num">${sub.bassText ?? sub.name}</span>
              </button>`
            : nothing}
        </div>
        <div class="dock">${room.dockText ?? room.barName}</div>
      </div>
    </div>
  `;
}

/* ---------------- Source keys ---------------- */

function renderSources(source: HomeSource | undefined, shown: string | undefined): TemplateResult | typeof nothing {
  if (!source) return nothing;
  return html`
    <div class="sources-block">
      <div class="sources" role="radiogroup" aria-label=${source.title}>
        ${source.options.map(
          (o) => html`
            <button
              class="key source ${o.active ? "active" : ""} ${o.pending ? "pending" : ""}"
              role="radio"
              aria-checked=${String(o.active)}
              aria-busy=${o.pending ? "true" : "false"}
              ?disabled=${!o.enabled}
              @click=${o.select}
            >
              <span class="round" aria-hidden="true">
                <ha-icon .icon=${SOURCE_ICONS[o.value] ?? "mdi:import"}></ha-icon>
                ${o.pending ? html`<span class="spinner"></span>` : nothing}
              </span>
              <span class="key-label">${o.label}</span>
            </button>
          `,
        )}
      </div>
      ${source.otherText ? html`<div class="hint other">${source.otherText}</div>` : nothing}
      ${reasonOf(source, shown)}
    </div>
  `;
}

/* ---------------- Volume rocker, mute, mode tiles ---------------- */

function renderDeck(ctx: TabContext, model: HomeModel, shown: string | undefined): TemplateResult {
  const { volume, modes, power } = model;
  return html`
    <div class="deck ${volume ? "" : "no-volume"}">
      ${volume ? renderRocker(volume) : nothing}
      <div class="deck-side">
        ${power || volume
          ? html`<div class="keys-row">
              ${power ? renderKey(power, "power-key") : nothing}${volume ? renderKey(volume.mute, "mute") : nothing}
            </div>`
          : nothing}
        ${power ? reasonOf(power, shown) : nothing}
        ${modes
          ? html`<div class="tiles-col">${tile(ctx, modes.smart, shown)}${tile(ctx, modes.night, shown)}${(modes.extra ?? []).map((c) => tile(ctx, c, shown))}</div>`
          : nothing}
      </div>
    </div>
    ${volume ? reasonOf({ enabled: volume.up.enabled || volume.down.enabled, reason: volume.reason }, shown) : nothing}
  `;
}

function renderRocker(volume: HomeVolume): TemplateResult {
  const { up, down } = volume;
  const level = volume.shown !== undefined ? volume.shown / volume.max : 0;
  const key = (a: HomeAction, part: "up" | "down"): TemplateResult => html`
    <button
      class="rock ${part}"
      ?disabled=${!a.enabled}
      aria-label=${a.label}
      title=${a.label}
      aria-busy=${a.pending ? "true" : "false"}
      @click=${a.run}
    >
      <ha-icon .icon=${a.icon}></ha-icon>
    </button>
  `;
  return html`
    <div
      class="rocker ${volume.muted ? "is-muted" : ""} ${volume.pending ? "busy" : ""}"
      role="group"
      aria-label=${volume.title}
      style="--level: ${level}"
    >
      ${key(up, "up")}
      <div class="readout">
        <span class="vol ${volume.pending ? "pending" : ""}" aria-live="polite">
          <span class="sr-only">${volume.title} </span>${volume.shownText}<span class="vol-max" aria-hidden="true">/${volume.max}</span>
        </span>
        <span class="meter" aria-hidden="true"><span class="meter-fill"></span></span>
        ${volume.mutedText ? html`<span class="muted-tag">${volume.mutedText}</span>` : nothing}
      </div>
      ${key(down, "down")}
    </div>
  `;
}

/**
 * A round toggle key (power, mute), labelled like the remote's own keys: the model's fixed name
 * ("Power", "Mute") with aria-pressed and the accent fill for the state, so a screen reader does
 * not hear "Unmute, pressed". The model's action label ("Unmute", "Turn off") is the tooltip.
 * The power key's class is "power-key": the shared ".power.on" rule styles the header button.
 */
function renderKey(toggle: HomeToggle, cls: string): TemplateResult {
  return html`
    <button
      class="key ${cls} ${toggle.on ? "on" : ""} ${toggle.pending ? "pending" : ""}"
      title=${toggle.label}
      ?disabled=${!toggle.enabled}
      aria-pressed=${String(toggle.on)}
      aria-busy=${toggle.pending ? "true" : "false"}
      @click=${toggle.run}
    >
      <span class="round big" aria-hidden="true">
        <ha-icon .icon=${toggle.icon}></ha-icon>
        ${toggle.pending ? html`<span class="spinner"></span>` : nothing}
      </span>
      <span class="key-label">${toggle.name}</span>
    </button>
  `;
}

function tile(ctx: TabContext, c: HomeToggle | HomeButton | undefined, shown: string | undefined): TemplateResult | typeof nothing {
  if (!c) return nothing;
  const stateText = c.kind === "switch" ? ctx.t(c.on ? "home_remote.on" : "home_remote.off") : ctx.t("home_remote.apply");
  const body = html`
    <span class="tile-icon" aria-hidden="true"><ha-icon .icon=${c.icon}></ha-icon></span>
    <span class="tile-text">
      <span class="tile-name">${c.label}</span>
      <span class="tile-state" aria-hidden=${c.kind === "switch" ? "true" : "false"}>${stateText}</span>
    </span>
    ${c.pending ? html`<span class="spinner" aria-hidden="true"></span>` : nothing}
  `;
  const button =
    c.kind === "switch"
      ? html`<button
          class="mode ${c.id} ${c.on ? "on" : ""} ${c.pending ? "pending" : ""}"
          role="switch"
          aria-checked=${String(c.on)}
          aria-busy=${c.pending ? "true" : "false"}
          ?disabled=${!c.enabled}
          @click=${c.run}
        >
          ${body}
        </button>`
      : html`<button
          class="mode ${c.id} ${c.pending ? "pending" : ""}"
          aria-busy=${c.pending ? "true" : "false"}
          ?disabled=${!c.enabled}
          @click=${c.run}
        >
          ${body}
        </button>`;
  return html`${button}${reasonOf(c, shown)}`;
}

/* ---------------- Transport ---------------- */

function renderPlayback(pb: HomePlayback | undefined): TemplateResult | typeof nothing {
  if (!pb) return nothing;
  return html`
    <div class="playback">
      ${pb.hasInfo
        ? html`<div class="np" aria-live="polite" title=${pb.subtitle ? `${pb.title} · ${pb.subtitle}` : pb.title}>
            <ha-icon .icon=${"mdi:music-note"} aria-hidden="true"></ha-icon>
            <span class="np-title">${pb.title}</span>
            ${pb.subtitle ? html`<span class="np-sub">${pb.subtitle}</span>` : nothing}
          </div>`
        : nothing}
      ${pb.actions.length
        ? html`<div class="transport">
            ${pb.actions.map(
              (a) => html`<button
                class="round t-key ${a.id} ${a.primary ? "primary big" : ""} ${a.pending ? "pending" : ""}"
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
      ${pb.actions.map((a) => reasonOf(a, undefined))}
    </div>
  `;
}

/** Remote layout CSS; every selector starts with .home-remote. */
export const remoteStyles = css`
  .home-remote {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .home-remote button {
    -webkit-tap-highlight-color: transparent;
  }
  .home-remote .standby-hint,
  .home-remote .reason {
    text-align: center;
  }
  .home-remote .reason {
    margin-top: -8px;
  }

  .home-remote .room {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-radius: 999px;
    background: var(--jbl-surface);
    min-width: 0;
  }
  .home-remote .pics {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    flex: none;
  }
  .home-remote .pic {
    display: block;
    height: auto;
    user-select: none;
    -webkit-user-drag: none;
  }
  .home-remote .bar-pic {
    width: 84px;
  }
  .home-remote .pics.apart .bar-pic {
    width: 64px;
  }
  .home-remote .rear-pic {
    width: 14px;
  }
  .home-remote .sub-pic {
    width: 22px;
    margin-left: 4px;
  }
  .home-remote .room-info {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .home-remote .pills {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .home-remote .pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    border: 1px solid var(--jbl-border);
    background: var(--jbl-card-bg);
    border-radius: 999px;
    padding: 4px 9px 4px 7px;
    font-size: 0.75rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    cursor: pointer;
    min-height: 32px;
    box-sizing: border-box;
    color: var(--jbl-text);
  }
  .home-remote .pill ha-icon {
    --mdc-icon-size: 14px;
    color: var(--jbl-muted);
  }
  .home-remote .pill .side-letter {
    color: var(--jbl-muted);
    font-weight: 600;
    margin-right: 1px;
  }
  .home-remote .pill.low {
    border-color: var(--jbl-warning);
  }
  .home-remote .pill.low ha-icon {
    color: var(--jbl-warning);
  }
  .home-remote .pill.low .num {
    font-weight: 700;
  }
  .home-remote .pill.low .num::before {
    content: "\\26A0\\FE0E";
    color: var(--jbl-warning);
    margin-right: 2px;
  }
  .home-remote .pill.sub .num {
    color: var(--jbl-accent-text);
  }
  .home-remote .pill:disabled {
    cursor: default;
    color: var(--jbl-disabled);
  }
  .home-remote .dock {
    font-size: 0.72rem;
    color: var(--jbl-muted);
    padding-left: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .home-remote .key {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    border-radius: var(--jbl-radius-sm);
  }
  .home-remote .round {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 56px;
    height: 56px;
    flex: none;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--jbl-border);
    background: var(--jbl-surface);
    color: var(--jbl-text);
    cursor: pointer;
    transition: background 120ms ease, border-color 120ms ease, transform 80ms ease;
  }
  .home-remote .round ha-icon {
    --mdc-icon-size: 26px;
  }
  .home-remote .round.big {
    width: 68px;
    height: 68px;
  }
  .home-remote .round.big ha-icon {
    --mdc-icon-size: 30px;
  }
  .home-remote .round .spinner {
    position: absolute;
    top: -2px;
    right: -2px;
    background: var(--jbl-card-bg);
  }
  .home-remote .key:hover:not(:disabled) .round,
  .home-remote button.round:hover:not(:disabled) {
    border-color: var(--jbl-accent);
  }
  .home-remote .key:active:not(:disabled) .round,
  .home-remote button.round:active:not(:disabled) {
    transform: scale(0.94);
  }
  .home-remote .key.active .round,
  .home-remote .key.on .round,
  .home-remote button.round.primary {
    background: var(--jbl-accent-fill);
    border-color: var(--jbl-accent-fill);
    color: var(--jbl-on-accent);
  }
  .home-remote .key.pending:not(.active) .round {
    box-shadow: 0 0 0 2px var(--jbl-accent);
  }
  .home-remote .key-label {
    font-size: 0.8rem;
    line-height: 1.2;
    text-align: center;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .home-remote .key.active .key-label {
    color: var(--jbl-accent-text);
    font-weight: 600;
  }
  .home-remote .key:disabled,
  .home-remote button.round:disabled {
    cursor: default;
  }
  .home-remote .key:disabled .round,
  .home-remote button.round:disabled {
    opacity: 0.45;
  }
  .home-remote .key:disabled .key-label {
    color: var(--jbl-disabled);
  }

  .home-remote .sources-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .home-remote .sources {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    justify-items: center;
  }
  .home-remote .other {
    text-align: center;
  }

  .home-remote .deck {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    gap: 16px;
    align-items: stretch;
  }
  .home-remote .deck.no-volume {
    grid-template-columns: minmax(0, 1fr);
  }
  .home-remote .deck-side {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
  }
  .home-remote .keys-row {
    display: flex;
    justify-content: space-around;
    align-items: flex-start;
    gap: 8px;
  }

  .home-remote .rocker {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    min-height: 236px;
    border-radius: 46px;
    border: 1px solid var(--jbl-border);
    background: var(--jbl-surface);
    overflow: hidden;
  }
  .home-remote .meter {
    display: block;
    width: 56px;
    max-width: 80%;
    height: 4px;
    border-radius: 2px;
    background: var(--jbl-border);
    overflow: hidden;
    margin: 2px 0 4px;
  }
  .home-remote .meter-fill {
    display: block;
    height: 100%;
    width: calc(var(--level, 0) * 100%);
    background: var(--jbl-accent);
    border-radius: 2px;
    transition: width 160ms ease;
  }
  .home-remote .rocker.is-muted .meter-fill {
    background: var(--jbl-muted);
  }
  .home-remote .rock {
    flex: 1 1 0;
    min-height: 72px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    cursor: pointer;
    padding: 0;
    border-radius: 46px;
  }
  .home-remote .rock ha-icon {
    --mdc-icon-size: 32px;
  }
  .home-remote .rock:hover:not(:disabled) {
    background: rgba(var(--jbl-accent-rgb), 0.12);
  }
  .home-remote .rock:active:not(:disabled) {
    background: rgba(var(--jbl-accent-rgb), 0.24);
  }
  .home-remote .rock:focus-visible {
    outline-offset: -4px;
  }
  .home-remote .rock:disabled {
    cursor: default;
    color: var(--jbl-disabled);
  }
  .home-remote .readout {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 4px 4px;
    border-top: 1px solid var(--jbl-border);
    border-bottom: 1px solid var(--jbl-border);
  }
  .home-remote .vol {
    font-size: 2.6rem;
    font-weight: 300;
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
  }
  .home-remote .vol-max {
    font-size: 0.85rem;
    color: var(--jbl-muted);
    margin-left: 1px;
  }
  .home-remote .rocker.is-muted .vol {
    color: var(--jbl-muted);
    text-decoration: line-through;
    text-decoration-thickness: 2px;
  }
  .home-remote .muted-tag {
    font-size: 0.68rem;
    font-weight: 600;
    line-height: 1.15;
    text-align: center;
    color: var(--jbl-text);
    background: color-mix(in srgb, var(--jbl-warning) 18%, transparent);
    box-shadow: inset 0 0 0 1px var(--jbl-warning);
    border-radius: 6px;
    padding: 1px 5px;
    max-width: 100%;
    box-sizing: border-box;
    overflow-wrap: anywhere;
  }

  .home-remote .tiles-col {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .home-remote .mode {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 56px;
    box-sizing: border-box;
    padding: 8px 12px 8px 8px;
    border: 1px solid var(--jbl-border);
    border-radius: 16px;
    background: var(--jbl-surface);
    cursor: pointer;
    text-align: start;
    transition: background 120ms ease, border-color 120ms ease;
  }
  .home-remote .mode:hover:not(:disabled) {
    border-color: var(--jbl-accent);
  }
  .home-remote .tile-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 38px;
    height: 38px;
    border-radius: 12px;
    background: var(--jbl-card-bg);
    color: var(--jbl-muted);
  }
  .home-remote .tile-icon ha-icon {
    --mdc-icon-size: 22px;
  }
  .home-remote .tile-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .home-remote .tile-name {
    font-weight: 500;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .home-remote .tile-state {
    font-size: 0.78rem;
    line-height: 1.2;
    color: var(--jbl-muted);
  }
  .home-remote .mode .spinner {
    flex: none;
  }
  .home-remote .mode.on {
    border-color: var(--jbl-accent);
    background: rgba(var(--jbl-accent-rgb), 0.14);
  }
  .home-remote .mode.on .tile-icon {
    background: var(--jbl-accent-fill);
    color: var(--jbl-on-accent);
  }
  .home-remote .mode.on .tile-state {
    color: var(--jbl-accent-text);
    font-weight: 500;
  }
  .home-remote .mode:disabled {
    cursor: default;
    color: var(--jbl-disabled);
  }
  .home-remote .mode:disabled .tile-icon {
    color: var(--jbl-disabled);
  }

  .home-remote .playback {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 12px;
    border-top: 1px solid var(--jbl-border);
  }
  .home-remote .np {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
  }
  .home-remote .np ha-icon {
    --mdc-icon-size: 16px;
    color: var(--jbl-accent-text);
    align-self: center;
    flex: none;
  }
  .home-remote .np-title {
    font-weight: 500;
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .home-remote .np-sub {
    flex: 1 1 0;
    min-width: 0;
    font-size: 0.85rem;
    color: var(--jbl-muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .home-remote .transport {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
  }
  .home-remote .t-key {
    width: 52px;
    height: 52px;
  }
  .home-remote .t-key.big {
    width: 64px;
    height: 64px;
  }

  @container (max-width: 340px) {
    .home-remote .deck {
      grid-template-columns: 80px minmax(0, 1fr);
      gap: 12px;
    }
    .home-remote .round {
      width: 52px;
      height: 52px;
    }
    .home-remote .round.big {
      width: 60px;
      height: 60px;
    }
    .home-remote .transport {
      gap: 8px;
    }
    .home-remote .t-key {
      width: 46px;
      height: 46px;
    }
    .home-remote .t-key.big {
      width: 56px;
      height: 56px;
    }
    .home-remote .bar-pic {
      width: 64px;
    }
    .home-remote .pics.apart .bar-pic {
      width: 48px;
    }
    .home-remote .room {
      flex-direction: column;
      gap: 4px;
      padding: 8px 10px 6px;
      border-radius: 20px;
    }
    .home-remote .room-info {
      align-items: center;
      width: 100%;
    }
    .home-remote .pills {
      justify-content: center;
    }
    .home-remote .mode {
      padding: 6px 8px 6px 6px;
      gap: 8px;
    }
    .home-remote .tile-icon {
      width: 32px;
      height: 32px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .home-remote .round,
    .home-remote .meter-fill {
      transition: none;
    }
    .home-remote .key:active .round,
    .home-remote button.round:active {
      transform: none;
    }
  }
`;
