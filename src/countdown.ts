import { formatDuration } from "./format";

/*
 * <jbl-bar-countdown>: the preferred way for a tab to show a live countdown. Prefer it over
 * ctx.wantTick(), which re-renders the whole card every second.
 *
 *   html`<jbl-bar-countdown .endsAt=${endsAtMs}></jbl-bar-countdown>`
 *   html`<jbl-bar-countdown .kind=${"progress"} .endsAt=${endsAtMs} .total=${seconds}></jbl-bar-countdown>`
 *
 * Key list rows by item id (lit's repeat()) so each element stays with its item across hass updates.
 */

export const COUNTDOWN_TAG = "jbl-bar-countdown";

/**
 * A light-DOM element that shows the time left until `endsAt` ("7:12") or, with
 * `kind = "progress"`, a progress bar of `total` seconds. It schedules its own repaint at
 * the next whole second while connected, so a running countdown does not re-render the card.
 * It lives inside the card's shadow root, so the card's styles apply to it.
 */
export class JblBarCountdown extends HTMLElement {
  private _endsAt = NaN;
  private _total: number | null = null;
  private _kind: "text" | "progress" = "text";
  private _handle?: ReturnType<typeof setTimeout>;
  private _fill?: HTMLElement;

  set endsAt(value: number | null) {
    const v = value ?? NaN;
    if (v === this._endsAt || (Number.isNaN(v) && Number.isNaN(this._endsAt))) return;
    this._endsAt = v;
    this.refresh();
  }
  get endsAt(): number | null {
    return Number.isNaN(this._endsAt) ? null : this._endsAt;
  }

  /** Full length in seconds (progress only). */
  set total(value: number | null) {
    if (value === this._total) return;
    this._total = value;
    this.refresh();
  }
  get total(): number | null {
    return this._total;
  }

  set kind(value: "text" | "progress") {
    if (value === this._kind) return;
    this._kind = value;
    this._fill = undefined;
    this.textContent = "";
    this.refresh();
  }
  get kind(): "text" | "progress" {
    return this._kind;
  }

  connectedCallback(): void {
    this.refresh();
  }

  disconnectedCallback(): void {
    this._clear();
  }

  /** Whole seconds left (rounded up, never negative). */
  secondsLeft(now: number = Date.now()): number {
    if (Number.isNaN(this._endsAt)) return 0;
    return Math.max(0, Math.ceil((this._endsAt - now) / 1000));
  }

  /** Repaint now and schedule the next repaint at the next whole second. */
  refresh(): void {
    this._clear();
    const now = Date.now();
    const msLeft = Number.isNaN(this._endsAt) ? 0 : this._endsAt - now;
    if (this._kind === "progress") {
      if (!this._fill) {
        this._fill = document.createElement("span");
        this._fill.className = "fill";
        this.replaceChildren(this._fill);
      }
      const total = this._total ?? 0;
      const done = total > 0 ? Math.min(1, Math.max(0, 1 - msLeft / (total * 1000))) : 0;
      const pct = Math.round(done * 1000) / 10;
      this._fill.style.width = `${pct}%`;
      this.setAttribute("role", "progressbar");
      this.setAttribute("aria-valuemin", "0");
      this.setAttribute("aria-valuemax", "100");
      this.setAttribute("aria-valuenow", String(Math.round(pct)));
    } else {
      const text = Number.isNaN(this._endsAt) ? "" : formatDuration(this.secondsLeft(now));
      if (this.textContent !== text) this.textContent = text;
    }
    if (msLeft > 0 && this.isConnected) {
      const wait = msLeft % 1000 || 1000;
      this._handle = setTimeout(() => this.refresh(), wait + 10);
    }
  }

  private _clear(): void {
    if (this._handle !== undefined) clearTimeout(this._handle);
    this._handle = undefined;
  }
}

if (!customElements.get(COUNTDOWN_TAG)) customElements.define(COUNTDOWN_TAG, JblBarCountdown);

declare global {
  interface HTMLElementTagNameMap {
    "jbl-bar-countdown": JblBarCountdown;
  }
}
