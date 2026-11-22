// The "classic" Home layout: the room picture, source buttons, volume, mode chips and
// playback, rendered only from homeModel(). It keeps the tab's original unprefixed
// classes (.room, .volume, .chip...), which tests and the other layouts rely on.
import { css, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import type { TabContext } from "../../types";
import type { HomeButton, HomeModel, HomeRear, HomeRoom, HomeSource, HomeToggle, HomeVolume } from "../home-model";

export function renderClassic(_ctx: TabContext, model: HomeModel): TemplateResult {
  return html`
    <div class="home">
      ${renderRoom(model.room)}
      ${model.standbyHint ? html`<div class="hint standby">${model.standbyHint}</div>` : nothing}
      ${renderSource(model.source)} ${renderVolume(model.volume)} ${renderModes(model)} ${renderPlayback(model)}
    </div>
  `;
}

/* ---------------- Room visual ---------------- */

function renderRoom(room: HomeRoom): TemplateResult {
  const rear = (side: "left" | "right"): HomeRear | undefined => room.rears.find((r) => r.side === side);

  // Row 1 holds the pictures on one floor line, row 2 the labels. The
  // pictures are mouse shortcuts only; the labels are the focusable buttons.
  const rearPic = (r: HomeRear | undefined): TemplateResult | typeof nothing =>
    r
      ? html`
          <div class="pic-cell ${r.side}" aria-hidden="true" @click=${r.open}>
            <img class="pic rear-pic" src=${r.image} alt="" />
          </div>
        `
      : nothing;

  const rearButton = (r: HomeRear | undefined): TemplateResult | typeof nothing =>
    r
      ? html`
          <button
            class="spk rear ${r.side} ${r.low ? "low" : ""}"
            @click=${r.open}
            ?disabled=${!r.entity}
            aria-label=${r.label}
            title=${r.name}
          >
            ${r.batteryText !== undefined
              ? html`<span class="batt" title=${r.batteryTitle}>
                  <ha-icon .icon=${r.batteryIcon}></ha-icon>${r.batteryText}</span
                >`
              : nothing}
          </button>
        `
      : nothing;

  const dockLabel = room.dockText
    ? html`<span class="dock-label">${room.dockText}</span>`
    : html`<span class="spk-name">${room.barName}</span>`;
  const { sub } = room;

  return html`
    <div class="room ${room.docked ? "docked" : ""} ${room.hasRears ? "" : "no-rears"}" role="group" aria-label=${room.label}>
      ${room.showRearPictures ? rearPic(rear("left")) : nothing}
      <div class="pic-cell bar" aria-hidden="true">
        <img class="pic bar-pic" src=${room.barImage} alt="" />
      </div>
      ${room.showRearPictures ? rearPic(rear("right")) : nothing}
      <div class="pic-cell sub" aria-hidden="true" @click=${sub.open}>
        <img class="pic sub-pic" src=${sub.image} alt="" />
      </div>
      ${rearButton(rear("left"))}
      <div class="bar-label">${dockLabel}</div>
      ${rearButton(rear("right"))}
      <button class="spk sub" @click=${sub.open} ?disabled=${!sub.enabled} aria-label=${sub.label}>
        <span class="spk-name">${sub.name}</span>
        ${sub.bassText ? html`<span class="bass">${sub.bassText}</span>` : nothing}
      </button>
    </div>
  `;
}

/* ---------------- Source ---------------- */

function renderSource(source: HomeSource | undefined): TemplateResult {
  if (!source) return html``;
  return html`
    <div class="section">
      <div class="section-title">${source.title}</div>
      <div class="seg" role="radiogroup" aria-label=${source.title}>
        ${source.options.map(
          (o) => html`
            <button
              role="radio"
              aria-checked=${String(o.active)}
              class="${o.active ? "active" : ""} ${o.pending ? "pending" : ""}"
              ?disabled=${!o.enabled}
              @click=${o.select}
            >
              ${o.label}
            </button>
          `,
        )}
      </div>
      ${source.otherText ? html`<div class="hint">${source.otherText}</div>` : nothing}
    </div>
  `;
}

/* ---------------- Volume ---------------- */

function renderVolume(volume: HomeVolume | undefined): TemplateResult {
  if (!volume) return html``;
  const { down, up, mute, slider } = volume;
  return html`
    <div class="section">
      <div class="section-title">
        <span>${volume.title}</span>
        ${volume.mutedText ? html`<span class="badge warn">${volume.mutedText}</span>` : nothing}
      </div>
      <div class="volume">
        <button class="icon-btn" ?disabled=${!down.enabled} @click=${down.run} aria-label=${down.label} title=${down.label}>
          <ha-icon .icon=${down.icon}></ha-icon>
        </button>
        <div class="vol-number ${volume.pending ? "pending" : ""} ${volume.muted ? "is-muted" : ""}" aria-live="polite">
          ${volume.shownText}<span class="vol-max">/${volume.max}</span>
        </div>
        <button class="icon-btn" ?disabled=${!up.enabled} @click=${up.run} aria-label=${up.label} title=${up.label}>
          <ha-icon .icon=${up.icon}></ha-icon>
        </button>
        <button
          class="icon-btn mute ${mute.on ? "on" : ""} ${mute.pending ? "pending" : ""}"
          ?disabled=${!mute.enabled}
          aria-pressed=${String(mute.on)}
          aria-label=${mute.name}
          title=${mute.label}
          aria-busy=${mute.pending ? "true" : "false"}
          @click=${mute.run}
        >
          <ha-icon .icon=${mute.icon}></ha-icon>
        </button>
      </div>
      <input
        class="slider"
        type="range"
        min=${slider.min}
        max=${slider.max}
        step=${slider.step}
        .value=${String(slider.value)}
        ?disabled=${!slider.enabled}
        aria-label=${slider.label}
        @input=${(ev: Event) => slider.preview(Number((ev.target as HTMLInputElement).value))}
        @change=${(ev: Event) => slider.commit(Number((ev.target as HTMLInputElement).value))}
      />
    </div>
  `;
}

/* ---------------- Chips: Smart mode, Night ---------------- */

function chip(c: HomeToggle | HomeButton | undefined): TemplateResult | typeof nothing {
  if (!c) return nothing;
  if (c.kind === "button") {
    return html`<button class="chip ${c.pending ? "pending" : ""}" ?disabled=${!c.enabled} @click=${c.run}>
      <ha-icon .icon=${c.icon}></ha-icon><span>${c.label}</span>
    </button>`;
  }
  return html`
    <button
      class="chip ${c.on ? "on" : ""} ${c.pending ? "pending" : ""}"
      role="switch"
      aria-checked=${String(c.on)}
      ?disabled=${!c.enabled}
      aria-busy=${c.pending ? "true" : "false"}
      @click=${c.run}
    >
      <ha-icon .icon=${c.icon}></ha-icon>
      <span>${c.label}</span>
      <span class="switch-knob" aria-hidden="true"></span>
    </button>
  `;
}

function renderModes(model: HomeModel): TemplateResult {
  if (!model.modes) return html``;
  const { smart, night } = model.modes;
  // Why a chip is disabled (unreachable bar, or its entity reports no state), once per text.
  // The standby hint is already shown above the source.
  const reasons = [
    ...new Set(
      [smart, night].flatMap((c) => (c && !c.enabled && c.reason && c.reason !== model.standbyHint ? [c.reason] : [])),
    ),
  ];
  return html`<div class="section">
    <div class="chips">${chip(smart)}${chip(night)}</div>
    ${reasons.map((r) => html`<div class="hint mode-reason">${r}</div>`)}
  </div>`;
}

/* ---------------- Playback ---------------- */

function renderPlayback(model: HomeModel): TemplateResult {
  const pb = model.playback;
  if (!pb) return html``;
  return html`
    <div class="section playback">
      ${pb.hasInfo
        ? html`<div class="now-playing">
            <div class="np-title">${pb.title}</div>
            <div class="np-sub">${pb.subtitle}</div>
          </div>`
        : nothing}
      ${pb.actions.length
        ? html`<div class="row transport">
            ${pb.actions.map(
              (a) => html`<button
                class="icon-btn ${a.primary ? "on big" : ""} ${a.pending ? "pending" : ""}"
                aria-label=${a.label}
                title=${a.label}
                @click=${a.run}
              >
                <ha-icon .icon=${a.icon}></ha-icon>
              </button>`,
            )}
          </div>`
        : nothing}
    </div>
  `;
}

/** Classic layout CSS. Its selectors are the tab's original unprefixed classes. */
export const classicStyles = css`
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
