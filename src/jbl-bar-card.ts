import { LitElement, html, nothing } from "lit";
import type { PropertyValues, TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { CARD_TAG, EDITOR_TAG, normalizeConfig, pageTranslate } from "./config";
import { PLATFORMS, discover, findBars, lookupBandIndexes, resolveBar, watchedIds } from "./discovery";
import { formatDuration, formatNumber, formatTime } from "./format";
import { dictionary, langOf, makeTranslate } from "./i18n";
import type { Lang } from "./i18n";
import { DEFAULT_UNTIL_TIMEOUT, PendingRegistry } from "./pending";
import { serviceErrorText } from "./errors";
import { JblServices } from "./services";
import { isBlankState } from "./state";
import { cardStyles, sharedStyles } from "./styles";
import { homeStyles, renderHomeTab } from "./tabs/home";
import { isBarOn, powerToggle } from "./tabs/home-model";
import { renderSoundTab, soundStyles } from "./tabs/sound";
import { calibrationPhase, renderSystemTab, systemStyles } from "./tabs/system";
import { renderTimersTab, timersStyles } from "./tabs/timers";
import type {
  BarEntities,
  BusyInfo,
  CallOptions,
  ConfirmOptions,
  HassEntity,
  HomeAssistant,
  JblBarCardConfig,
  NormalizedConfig,
  Role,
  TabContext,
  TabId,
  TabRenderer,
  Translate,
} from "./types";
import { ROLE_DOMAINS } from "./types";
import "./editor";

const TABS: Record<TabId, { icon: string; render: TabRenderer }> = {
  home: { icon: "mdi:home-outline", render: renderHomeTab },
  sound: { icon: "mdi:tune-vertical", render: renderSoundTab },
  timers: { icon: "mdi:timer-outline", render: renderTimersTab },
  system: { icon: "mdi:cog-outline", render: renderSystemTab },
};

/** How long an error stays in the strip at the top. Errors shown next to their control stay until dismissed. */
const ERROR_TTL = 20000;
const MAX_ERRORS = 3;
interface CardError {
  id: number;
  message: string;
  /** The pending key of the control that failed (or that the validation error belongs to). */
  key?: string;
  /** ms epoch after which a strip error is dropped. */
  expires: number;
}

interface DialogState extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

// isBarOn lives in the Home model, which shares the power toggle with the header.
export { isBarOn };

export class JblBarCard extends LitElement {
  static override styles = [sharedStyles, cardStyles, homeStyles, soundStyles, timersStyles, systemStyles];

  @property({ attribute: false }) hass?: HomeAssistant;
  @property({ type: Boolean, reflect: true }) compact = false;
  /** Set by HA while the card is shown in the editor preview. */
  @property({ type: Boolean }) preview = false;

  @state() private _config?: NormalizedConfig;
  @state() private _tab: TabId = "home";
  @state() private _errors: CardError[] = [];
  @state() private _dialog?: DialogState;
  /** Bumped whenever the pending registry changes (it is not reactive by itself). */
  @state() private _pendingVersion = 0;
  @state() private _bandHints: Record<string, number> = {};

  private readonly _pending = new PendingRegistry();
  private readonly _local = new Map<string, object>();
  private _errorSeq = 0;
  private _tickWanted = false;
  private _tickTimer?: ReturnType<typeof setInterval>;
  private readonly _timeouts = new Set<ReturnType<typeof setTimeout>>();
  private _bandLookups = new Set<string>();
  private _discoveryKey?: unknown[];
  private _discovered?: BarEntities;
  private _watched: string[] = [];
  /** Error keys a tab rendered next to their control in the last render (left out of the strip). */
  private _claimed = new Set<string>();
  private _claiming = new Set<string>();
  /** The element focused when the dialog opened, to give focus back on close. */
  private _dialogOpener?: HTMLElement;
  private _dialogFocused = false;

  /* ---------------- Lovelace API ---------------- */

  setConfig(config: JblBarCardConfig): void {
    const normalized = normalizeConfig(config, pageTranslate());
    const previous = this._config;
    this._config = normalized;
    this.compact = normalized.compact;
    if (!previous || previous.default_tab !== normalized.default_tab || !normalized.tabs.includes(this._tab)) {
      this._tab = normalized.default_tab;
    }
  }

  static getConfigElement(): HTMLElement {
    return document.createElement(EDITOR_TAG);
  }

  static getStubConfig(hass?: HomeAssistant): Record<string, unknown> {
    const bar = hass ? findBars(hass)[0] : undefined;
    return bar ? { entity: bar } : {};
  }

  getCardSize(): number {
    return this._config?.compact ? 6 : 10;
  }

  getGridOptions(): { columns: number; rows: "auto"; min_columns: number } {
    // The layout is designed from 300 px: in a sections view only the full width guarantees that.
    return { columns: 12, rows: "auto", min_columns: 12 };
  }

  /* ---------------- Lifecycle ---------------- */

  override connectedCallback(): void {
    super.connectedCallback();
    // Lovelace detaches cached cards (view switch, edit mode) and disconnectedCallback dropped
    // every timeout: re-arm the error expiry and the pending re-check for what is left.
    this._expireErrors();
    if (this._pending.size) {
      if (this._pending.refresh(this.hass)) this._pendingVersion++;
      const deadline = this._pending.nextDeadline();
      if (deadline !== undefined) this._scheduleRecheck(deadline - Date.now());
    }
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopTick();
    for (const t of this._timeouts) clearTimeout(t);
    this._timeouts.clear();
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    if (!this._config) return false;
    if (!changed.has("hass") || changed.size > 1) return true;
    const old = changed.get("hass") as HomeAssistant | undefined;
    const hass = this.hass;
    if (!old || !hass) return true;
    if (
      old.entities !== hass.entities ||
      old.devices !== hass.devices ||
      old.locale !== hass.locale ||
      old.themes !== hass.themes ||
      old.language !== hass.language
    ) {
      return true;
    }
    if (this._pending.size && this._pending.refresh(hass)) return true;
    if (!this._discovered) return true;
    return this._watched.some((id) => old.states[id] !== hass.states[id]);
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("hass") && this._pending.size) this._pending.refresh(this.hass);
    if (changed.has("hass")) this.toggleAttribute("dark", this.hass?.themes?.darkMode === true);
  }

  protected override updated(): void {
    if (this._tickWanted) this._startTick();
    else this._stopTick();
    this._rovingTabindex();
    if (this._dialog && !this._dialogFocused) {
      this._dialogFocused = true;
      const dialog = this.renderRoot.querySelector<HTMLElement>(".dialog");
      const target = dialog?.querySelector<HTMLElement>(this._dialog.destructive ? ".btn.cancel" : ".btn.ok");
      target?.focus();
      // The dialog is centred on the card: on a tall card it may sit outside the viewport.
      dialog?.scrollIntoView?.({ block: "nearest" });
    }
  }

  /** Radio groups (role=radiogroup): only the checked radio is a Tab stop; arrows move (see _onKeydown). */
  private _rovingTabindex(): void {
    for (const group of this.renderRoot.querySelectorAll<HTMLElement>('[role="radiogroup"]')) {
      const radios = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
      const enabled = radios.filter((r) => !r.disabled);
      const stop = enabled.find((r) => r.getAttribute("aria-checked") === "true") ?? enabled[0];
      for (const radio of radios) radio.tabIndex = radio === stop ? 0 : -1;
    }
  }

  /** Arrow / Home / End keys in radio groups: move to the next radio and select it. */
  private _onKeydown(ev: KeyboardEvent): void {
    const radio = (ev.target as HTMLElement | null)?.closest?.('[role="radio"]') as HTMLButtonElement | null;
    const group = radio?.closest('[role="radiogroup"]');
    if (!radio || !group) return;
    const radios = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]')).filter((r) => !r.disabled);
    const index = radios.indexOf(radio);
    if (index < 0) return;
    let next: number;
    switch (ev.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (index + 1) % radios.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (index - 1 + radios.length) % radios.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = radios.length - 1;
        break;
      default:
        return;
    }
    ev.preventDefault();
    if (next === index) return;
    radios[next].focus();
    radios[next].click();
  }

  /* ---------------- Discovery ---------------- */

  private _entities(hass: HomeAssistant, mediaPlayer: string): BarEntities {
    const fixed = [
      "button.jbl_timer_line_1",
      "button.jbl_message_line_1",
      "button.jbl_recent_timer_1",
      "button.jbl_recent_message_1",
      "switch.jbl_display_clock",
    ]
      .map((id) => (hass.states[id] ? "1" : "0"))
      .join("");
    const key = [hass.entities, hass.devices, mediaPlayer, this._config?.recent, this._bandHints, fixed];
    if (this._discovered && this._discoveryKey?.every((v, i) => v === key[i])) return this._discovered;
    const entities = discover(hass, mediaPlayer, {
      bandHints: this._bandHints,
      includeUnregistered: this._config?.recent,
    });
    this._discoveryKey = key;
    this._discovered = entities;
    this._watched = watchedIds(entities);
    this._lookupBands(hass, entities.eqBandsGuessed);
    return entities;
  }

  /** Learn the index of renamed EQ band entities from the registry unique_id (once per entity). */
  private _lookupBands(hass: HomeAssistant, ids: string[]): void {
    const todo = ids.filter((id) => !this._bandLookups.has(id));
    if (!todo.length) return;
    todo.forEach((id) => this._bandLookups.add(id));
    void lookupBandIndexes(hass, todo).then((found) => {
      if (Object.keys(found).length) this._bandHints = { ...this._bandHints, ...found };
    });
  }

  /* ---------------- Shared tab services ---------------- */

  private _showError(message: string, key?: string): void {
    const id = ++this._errorSeq;
    this._errors = [...this._errors, { id, message, key, expires: Date.now() + ERROR_TTL }].slice(-MAX_ERRORS);
    this._later(() => this._expireErrors(), ERROR_TTL + 50);
  }

  private _dismissError(id: number): void {
    this._errors = this._errors.filter((e) => e.id !== id);
  }

  /** Drop strip errors past their time; errors shown next to their control stay. Re-arms itself. */
  private _expireErrors(): void {
    if (!this._errors.length) return;
    const now = Date.now();
    const keep = this._errors.filter((e) => e.expires > now || (e.key !== undefined && this._claimed.has(e.key)));
    if (keep.length !== this._errors.length) this._errors = keep;
    let next: number | undefined;
    for (const e of keep) if (e.expires > now && (next === undefined || e.expires < next)) next = e.expires;
    if (next !== undefined) this._later(() => this._expireErrors(), next - now + 50);
  }

  private _renderInlineError(keys: string | string[], t: Translate): TemplateResult | typeof nothing {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) this._claiming.add(key);
    const errors = this._errors.filter((e) => e.key !== undefined && list.includes(e.key));
    if (!errors.length) return nothing;
    return html`${errors.map((error) => this._renderErrorStrip(error, t, true))}`;
  }

  private _scheduleRecheck(ms: number): void {
    this._later(() => {
      if (this._pending.refresh(this.hass)) this._pendingVersion++;
    }, Math.max(0, ms) + 50);
  }

  private _later(fn: () => void, ms: number): void {
    const handle = setTimeout(() => {
      this._timeouts.delete(handle);
      fn();
    }, ms);
    this._timeouts.add(handle);
  }

  private async _call(
    key: string,
    fn: () => Promise<unknown>,
    opts: CallOptions,
    barUnavailable: boolean,
    t: Translate,
  ): Promise<boolean> {
    if (barUnavailable && !opts.offline) {
      this._showError(t("error.bar_unavailable"));
      return false;
    }
    // A new try on this control replaces its old error.
    if (this._errors.some((e) => e.key === key)) this._errors = this._errors.filter((e) => e.key !== key);
    this._pending.start(key, opts.value);
    this._pendingVersion++;
    let ok = false;
    try {
      await fn();
      ok = true;
    } catch (err) {
      let message: string | undefined;
      try {
        message = opts.onError?.(err) || undefined;
      } catch {
        message = undefined;
      }
      this._showError(message ?? serviceErrorText(err, t, this.hass), key);
    }
    const timeout = opts.timeoutMs ?? DEFAULT_UNTIL_TIMEOUT;
    const deadline = this._pending.finish(key, ok, this.hass, opts.until, timeout);
    if (deadline !== undefined) this._scheduleRecheck(timeout);
    this._pendingVersion++;
    return ok;
  }

  private _confirm(opts: ConfirmOptions): Promise<boolean> {
    const previous = this._dialog;
    this._dialog = undefined;
    previous?.resolve(false);
    if (!previous) {
      const active = this.shadowRoot?.activeElement;
      this._dialogOpener = active instanceof HTMLElement ? active : undefined;
    }
    this._dialogFocused = false;
    return new Promise((resolve) => {
      this._dialog = { ...opts, resolve };
    });
  }

  private _closeDialog(ok: boolean): void {
    const dialog = this._dialog;
    const opener = this._dialogOpener;
    this._dialog = undefined;
    this._dialogOpener = undefined;
    dialog?.resolve(ok);
    // Give focus back to the control that opened the dialog.
    void this.updateComplete.then(() => {
      if (opener?.isConnected) opener.focus();
    });
  }

  /** Escape closes the dialog; Tab and Shift+Tab stay inside it. */
  private _onDialogKeydown(ev: KeyboardEvent): void {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      this._closeDialog(false);
      return;
    }
    if (ev.key !== "Tab") return;
    const buttons = Array.from(this.renderRoot.querySelectorAll<HTMLButtonElement>(".dialog button:not([disabled])"));
    if (!buttons.length) return;
    const active = this.shadowRoot?.activeElement as HTMLButtonElement | null;
    const index = active ? buttons.indexOf(active) : -1;
    ev.preventDefault();
    let next: number;
    if (ev.shiftKey) next = index <= 0 ? buttons.length - 1 : index - 1;
    else next = index < 0 || index >= buttons.length - 1 ? 0 : index + 1;
    buttons[next].focus();
  }

  private _moreInfo(entityId: string | undefined): void {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  private _startTick(): void {
    if (this._tickTimer) return;
    this._tickTimer = setInterval(() => this.requestUpdate(), 1000);
  }

  private _stopTick(): void {
    if (!this._tickTimer) return;
    clearInterval(this._tickTimer);
    this._tickTimer = undefined;
  }

  /** Build the context every tab renders from. Exposed for tests. */
  buildContext(hass: HomeAssistant, entities: BarEntities, config: NormalizedConfig, lang: Lang): TabContext {
    const t = makeTranslate(lang);
    const resolveId = (roleOrId: string | undefined): string | undefined => {
      if (!roleOrId) return undefined;
      if (roleOrId.includes(".")) return roleOrId;
      return roleOrId in ROLE_DOMAINS ? entities[roleOrId as Role] : undefined;
    };
    const stateOf = (roleOrId: string | undefined): HassEntity | undefined => {
      const id = resolveId(roleOrId);
      return id ? hass.states[id] : undefined;
    };
    const mp = hass.states[entities.media_player];
    const barUnavailable = !mp || mp.state === "unavailable";
    const running = stateOf(entities.command_running);
    const busy: BusyInfo = {
      running: running?.state === "on",
      action: typeof running?.attributes.action === "string" ? running.attributes.action : null,
      source: typeof running?.attributes.source === "string" ? running.attributes.source : null,
    };
    const services = new JblServices(
      hass,
      entities.media_player,
      entities.volumeMax,
      entities.cycles,
      () => this.hass ?? hass,
    );
    return {
      hass,
      config,
      entities,
      services,
      lang,
      t,
      stateOf,
      isAvailable: (roleOrId) => {
        const st = stateOf(roleOrId);
        return st !== undefined && st.state !== "unavailable";
      },
      barUnavailable,
      barOn: isBarOn(mp),
      busy,
      now: Date.now(),
      wantTick: () => {
        this._tickWanted = true;
      },
      call: (key, fn, opts = {}) => this._call(key, fn, opts, barUnavailable, t),
      isPending: (key) => this._pending.isPending(key),
      pendingValue: <T>(key: string) => this._pending.value<T>(key),
      showError: (message, key) => this._showError(message, key),
      renderError: (keys) => this._renderInlineError(keys, t),
      confirm: (opts) => this._confirm(opts),
      local: <T extends object>(key: string, init: () => T): T => {
        let value = this._local.get(key) as T | undefined;
        if (!value) {
          value = init();
          this._local.set(key, value);
        }
        return value;
      },
      requestUpdate: () => this.requestUpdate(),
      moreInfo: (entityId) => this._moreInfo(entityId),
      formatNumber: (value, options) => formatNumber(hass.locale ?? lang, value, options),
      formatTime: (date) => formatTime(hass.locale, date, hass.config?.time_zone),
      formatDuration,
    };
  }

  /* ---------------- Render ---------------- */

  protected override render(): TemplateResult | typeof nothing {
    const config = this._config;
    const hass = this.hass;
    if (!config || !hass) return nothing;
    this._tickWanted = false;
    const lang = langOf(hass);
    const t = makeTranslate(lang);

    const mediaPlayer = resolveBar(hass, config.entity);
    if (!mediaPlayer) return this._renderWarning(hass, t, config.entity);
    if (!this._isJblBar(hass, mediaPlayer)) return this._renderWarning(hass, t, config.entity, true);

    const entities = this._entities(hass, mediaPlayer);
    const ctx = this.buildContext(hass, entities, config, lang);
    const tabs = this._visibleTabs(config, entities);
    const tab: TabId = config.compact ? "home" : tabs.includes(this._tab) ? this._tab : (tabs[0] ?? "home");
    const showTabs = !config.compact && tabs.length > 1;

    // Render the tab first: it claims the errors it shows next to its controls.
    this._claiming = new Set();
    const content = (TABS[tab] ?? TABS.home).render(ctx);
    this._claimed = this._claiming;
    const dialogOpen = this._dialog !== undefined;

    return html`
      <ha-card @keydown=${(ev: KeyboardEvent) => this._onKeydown(ev)}>
        <div class="shell" ?inert=${dialogOpen}>
          ${this._renderHeader(ctx)} ${showTabs ? this._renderTabs(tabs, tab, t) : nothing}
          ${ctx.barUnavailable
            ? html`<div class="strip offline" role="status">
                <ha-icon .icon=${"mdi:lan-disconnect"}></ha-icon><span class="grow">${t("banner.unavailable")}</span>
              </div>`
            : nothing}
          ${this._renderBusy(ctx)} ${this._renderErrors(t)}
          ${showTabs
            ? html`<div class="content" id="jbl-panel" role="tabpanel" aria-labelledby=${`jbl-tab-${tab}`}>${content}</div>`
            : html`<div class="content">${content}</div>`}
        </div>
        ${this._renderDialog(t)}
      </ha-card>
    `;
  }

  /**
   * A configured entity is drawn only when it is a jbl_bar_91 media player. An entity without a
   * registry entry (YAML or template player) is not one: a real bar always has a unique_id.
   */
  private _isJblBar(hass: HomeAssistant, mediaPlayer: string): boolean {
    const entry = hass.entities?.[mediaPlayer];
    if (entry) return !entry.platform || PLATFORMS.includes(entry.platform);
    // No registry loaded at all (very old frontends): trust the configured id.
    return !hass.entities || Object.keys(hass.entities).length === 0;
  }

  private _visibleTabs(config: NormalizedConfig, entities: BarEntities): TabId[] {
    const tabs = config.tabs.filter((tab) => {
      if (tab === "timers") return Boolean(entities.timers || entities.messages || entities.display_clock);
      return true;
    });
    // Every configured tab has nothing to show on this remote (e.g. tabs: [timers] on an older one).
    return tabs.length ? tabs : ["home"];
  }

  private _renderWarning(hass: HomeAssistant, t: Translate, entity: string | undefined, notJbl = false): TemplateResult {
    const bars = findBars(hass);
    const list = bars.length ? bars.join(", ") : t("common.none");
    const message = notJbl
      ? t("error.not_jbl", { entity: entity ?? "", bars: list })
      : entity
        ? t("error.entity_not_found", { entity, bars: list })
        : t("error.no_bar");
    return html`<ha-card>
      <div class="strip error warning" role="alert">
        <ha-icon .icon=${"mdi:alert-circle-outline"}></ha-icon><span class="grow">${message}</span>
      </div>
    </ha-card>`;
  }

  private _deviceName(ctx: TabContext): string {
    if (ctx.config.name) return ctx.config.name;
    const device = ctx.entities.device_id ? ctx.hass.devices?.[ctx.entities.device_id] : undefined;
    const name = device?.name_by_user || device?.name;
    if (name) return name;
    const friendly = ctx.stateOf(ctx.entities.media_player)?.attributes.friendly_name;
    return typeof friendly === "string" && friendly ? friendly : "JBL Bar 9.1";
  }

  private _subtitle(ctx: TabContext): string {
    const { t } = ctx;
    const mp = ctx.stateOf(ctx.entities.media_player);
    if (!mp || mp.state === "unavailable") return t("header.unreachable");
    if (mp.state === "off") return t("header.standby");
    const parts: string[] = [];
    if (typeof mp.attributes.source === "string" && mp.attributes.source) parts.push(mp.attributes.source);
    const soundMode = ctx.stateOf(ctx.entities.sound_mode)?.state;
    const smart = ctx.stateOf(ctx.entities.smart_mode)?.state;
    if (soundMode === "smart" || (soundMode !== "standard" && smart === "on")) parts.push(t("header.mode_smart"));
    else if (soundMode === "standard" || smart === "off") parts.push(t("header.mode_standard"));
    const format = ctx.stateOf(ctx.entities.audio_format)?.state;
    if (format && !isBlankState(format)) parts.push(format);
    else if (ctx.stateOf(ctx.entities.atmos_active)?.state === "on") parts.push("Dolby Atmos");
    return parts.join(" · ");
  }

  private _renderHeader(ctx: TabContext): TemplateResult {
    const { t } = ctx;
    const mediaPlayer = ctx.entities.media_player;
    // The same toggle as the Home model's power key: one pending key and one set of rules.
    const power = powerToggle(ctx);
    return html`
      <div class="header">
        <div class="badge-jbl" aria-hidden="true">JBL</div>
        <button type="button" class="titles" title=${t("header.details")} @click=${() => ctx.moreInfo(mediaPlayer)}>
          <span class="name">${this._deviceName(ctx)}</span>
          <span class="subtitle">${this._subtitle(ctx)}</span>
        </button>
        <button
          class="icon-btn power ${power.on ? "on" : ""} ${power.pending ? "pending" : ""}"
          ?disabled=${!power.enabled}
          aria-pressed=${String(power.on)}
          aria-busy=${power.pending ? "true" : "false"}
          aria-label=${power.name}
          title=${power.label}
          @click=${power.run}
        >
          <ha-icon .icon=${power.icon}></ha-icon>
        </button>
      </div>
    `;
  }

  private _renderTabs(tabs: TabId[], active: TabId, t: Translate): TemplateResult {
    const select = (tab: TabId, focus: boolean): void => {
      this._tab = tab;
      if (focus) void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>(`#jbl-tab-${tab}`)?.focus());
    };
    const onKeydown = (ev: KeyboardEvent): void => {
      const index = tabs.indexOf(active);
      let next: number;
      switch (ev.key) {
        case "ArrowRight":
          next = (index + 1) % tabs.length;
          break;
        case "ArrowLeft":
          next = (index - 1 + tabs.length) % tabs.length;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = tabs.length - 1;
          break;
        default:
          return;
      }
      ev.preventDefault();
      select(tabs[next], true);
    };
    return html`
      <div class="tabs" role="tablist" @keydown=${onKeydown}>
        ${tabs.map(
          (tab) => html`
            <button
              class="tab"
              role="tab"
              id=${`jbl-tab-${tab}`}
              aria-controls="jbl-panel"
              aria-selected=${String(tab === active)}
              tabindex=${tab === active ? "0" : "-1"}
              title=${t(`tab.${tab}`)}
              @click=${() => select(tab, false)}
            >
              <ha-icon .icon=${TABS[tab].icon}></ha-icon><span class="tab-label">${t(`tab.${tab}`)}</span>
            </button>
          `,
        )}
      </div>
    `;
  }

  private _renderBusy(ctx: TabContext): TemplateResult | typeof nothing {
    if (!ctx.busy.running) return nothing;
    const { t } = ctx;
    // During a calibration the remote reports itself busy (source "remote") although this card,
    // or the web page, may have started it: the card cannot tell, so it shows the phase instead.
    const phase = calibrationPhase(ctx.stateOf(ctx.entities.calibration)?.state);
    const calibrating = phase.kind === "running";
    const action = ctx.busy.action ?? (calibrating ? "calibrate" : null);
    const dict = dictionary(ctx.lang);
    const label = action
      ? (dict[`action.${action}`] ?? t("action.unknown", { action }))
      : t("busy.generic");
    let text = action ? t("busy.running", { action: label }) : label;
    if (calibrating && phase.key) text += ` · ${t(`system.${phase.key}`, phase.vars)}`;
    else if (ctx.busy.source === "remote" && action !== "calibrate") text += ` ${t("busy.from_remote")}`;
    return html`<div class="strip busy" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <span class="grow">${text}</span>
    </div>`;
  }

  private _renderErrorStrip(error: CardError, t: Translate, inline: boolean): TemplateResult {
    return html`<div class="strip error ${inline ? "inline" : ""}" role="alert">
      <ha-icon .icon=${"mdi:alert-circle-outline"}></ha-icon>
      <span class="grow">${error.message}</span>
      <button
        class="icon-btn plain"
        aria-label=${t("common.dismiss")}
        title=${t("common.dismiss")}
        @click=${() => this._dismissError(error.id)}
      >
        <ha-icon .icon=${"mdi:close"}></ha-icon>
      </button>
    </div>`;
  }

  private _renderErrors(t: Translate): TemplateResult | typeof nothing {
    const now = Date.now();
    const shown = this._errors.filter((e) => (e.key === undefined || !this._claimed.has(e.key)) && e.expires > now);
    if (!shown.length) return nothing;
    return html`${shown.map((error) => this._renderErrorStrip(error, t, false))}`;
  }

  private _renderDialog(t: Translate): TemplateResult | typeof nothing {
    const dialog = this._dialog;
    if (!dialog) return nothing;
    return html`<div
      class="overlay"
      @click=${(ev: Event) => {
        if (ev.target === ev.currentTarget) this._closeDialog(false);
      }}
      @keydown=${(ev: KeyboardEvent) => this._onDialogKeydown(ev)}
    >
      <div
        class="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="jbl-dialog-title"
        aria-describedby="jbl-dialog-message"
      >
        <h3 id="jbl-dialog-title">${dialog.title}</h3>
        <p id="jbl-dialog-message">${dialog.message}</p>
        <div class="actions">
          <button class="btn ghost cancel" @click=${() => this._closeDialog(false)}>${t("common.cancel")}</button>
          <button class="btn ok ${dialog.destructive ? "danger filled" : "primary"}" @click=${() => this._closeDialog(true)}>
            ${dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>`;
  }
}

if (!customElements.get(CARD_TAG)) customElements.define(CARD_TAG, JblBarCard);

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === CARD_TAG)) {
  window.customCards.push({
    type: CARD_TAG,
    name: "JBL Bar Card",
    description: "Control a JBL Bar 9.1 or a JBL One bar (e.g. Bar 1300MK2): source, volume, sound, timers, display messages and system status.",
    preview: true,
    documentationURL: "https://github.com/VahaC/jbl-bar-card",
    getEntitySuggestion: (hass, entityId) => {
      const entry = (hass as HomeAssistant | undefined)?.entities?.[entityId];
      return entry?.platform !== undefined && PLATFORMS.includes(entry.platform) && entityId.startsWith("media_player.")
        ? { config: { type: `custom:${CARD_TAG}`, entity: entityId } }
        : null;
    },
  });
}

console.info(`%c JBL-BAR-CARD %c ${__CARD_VERSION__} `, "background:#d85a30;color:#fff;font-weight:700", "");

declare global {
  interface HTMLElementTagNameMap {
    "jbl-bar-card": JblBarCard;
  }
}
