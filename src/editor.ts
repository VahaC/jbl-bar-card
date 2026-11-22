import { LitElement, css, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { EDITOR_TAG } from "./config";
import { DOMAIN, findBars } from "./discovery";
import { langOf, makeTranslate } from "./i18n";
import { TAB_IDS, TAB_LAYOUTS } from "./types";
import type { HomeAssistant, JblBarCardConfig, TabId, Translate } from "./types";

/**
 * ha-form is lazy-loaded by HA: it exists only once a built-in card editor was loaded.
 * Loading the entities card editor pulls it in (entities is an always-loaded card type).
 */
async function ensureHaForm(): Promise<boolean> {
  if (customElements.get("ha-form")) return true;
  try {
    await window.loadCardHelpers?.();
    const entitiesCard = customElements.get("hui-entities-card") as unknown as
      | { getConfigElement?: () => Promise<unknown> }
      | undefined;
    await entitiesCard?.getConfigElement?.();
  } catch {
    // fall through to the wait below
  }
  if (customElements.get("ha-form")) return true;
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 4000));
  return Promise.race([customElements.whenDefined("ha-form").then(() => true), timeout]);
}

type FormData = Partial<JblBarCardConfig>;

/** Drop keys that only repeat the defaults, so the YAML stays short. */
export function cleanConfig(config: JblBarCardConfig): JblBarCardConfig {
  const out: Record<string, unknown> = { ...config };
  for (const [key, value] of Object.entries(out)) {
    if (value === undefined || value === "" || value === null) delete out[key];
  }
  if (out.compact === false) delete out.compact;
  if (out.layouts && typeof out.layouts === "object") {
    // Keep only layouts that differ from the tab's default (its first layout).
    const layouts = Object.fromEntries(
      Object.entries(out.layouts as Record<string, unknown>).filter(
        ([tab, value]) =>
          (TAB_IDS as string[]).includes(tab) && typeof value === "string" && value !== TAB_LAYOUTS[tab as TabId][0],
      ),
    );
    if (Object.keys(layouts).length) out.layouts = layouts;
    else delete out.layouts;
  }
  if (out.recent === false) delete out.recent;
  if (Array.isArray(out.tabs)) {
    let tabs = TAB_IDS.filter((tab) => (out.tabs as string[]).includes(tab));
    // Unticking the last tab leaves Home, as the card does with `tabs: []` (not all four again).
    if (!tabs.length) tabs = ["home"];
    if (tabs.length === TAB_IDS.length) delete out.tabs;
    else out.tabs = tabs;
  }
  // default_tab only when it is a visible tab other than the first one (the card's default).
  const visible = (out.tabs as TabId[] | undefined) ?? [...TAB_IDS];
  if (out.default_tab !== undefined && (!visible.includes(out.default_tab as TabId) || out.default_tab === visible[0])) {
    delete out.default_tab;
  }
  return out as unknown as JblBarCardConfig;
}

export class JblBarCardEditor extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  @state() private _config?: JblBarCardConfig;
  /** undefined = loading, true = ha-form, false = native fallback */
  @state() private _haForm?: boolean;

  setConfig(config: JblBarCardConfig): void {
    this._config = { ...config };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this._haForm === undefined) {
      void ensureHaForm().then((ok) => {
        this._haForm = ok;
      });
    }
  }

  private _schema(t: Translate, compact: boolean, tabs: readonly TabId[]): unknown[] {
    const tabOptions = TAB_IDS.map((id) => ({ value: id, label: t(`tab.${id}`) }));
    // The default tab can only be one of the ticked tabs.
    const defaultOptions = tabOptions.filter((option) => tabs.includes(option.value));
    return [
      { name: "entity", selector: { entity: { filter: { integration: DOMAIN, domain: "media_player" } } } },
      { name: "name", selector: { text: {} } },
      { name: "compact", selector: { boolean: {} } },
      ...(compact
        ? []
        : [
            { name: "tabs", selector: { select: { multiple: true, mode: "list", options: tabOptions } } },
            { name: "default_tab", selector: { select: { mode: "dropdown", options: defaultOptions } } },
          ]),
      {
        type: "expandable",
        name: "layouts",
        title: t("editor.layouts"),
        schema: (compact ? (["home"] as TabId[]) : tabs).map((tab) => ({
          name: tab,
          selector: {
            select: {
              mode: "dropdown",
              options: TAB_LAYOUTS[tab].map((layout) => ({ value: layout, label: t(`layout.${tab}.${layout}`) })),
            },
          },
        })),
      },
      {
        type: "expandable",
        name: "",
        title: t("editor.advanced"),
        flatten: true,
        schema: [{ name: "recent", selector: { boolean: {} } }],
      },
    ];
  }

  private _update(patch: FormData): void {
    if (!this._config) return;
    const config = cleanConfig({ ...this._config, ...patch } as JblBarCardConfig);
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this.hass || !this._config) return nothing;
    const t = makeTranslate(langOf(this.hass));
    if (this._haForm === undefined) return html`<div class="loading">${t("editor.loading")}</div>`;
    const tabs = (this._config.tabs?.length ? TAB_IDS.filter((tab) => this._config!.tabs!.includes(tab)) : [...TAB_IDS]) as TabId[];
    const defaultTab = this._config.default_tab && tabs.includes(this._config.default_tab) ? this._config.default_tab : tabs[0];
    const layouts = Object.fromEntries(
      TAB_IDS.map((tab) => [tab, this._config!.layouts?.[tab] ?? TAB_LAYOUTS[tab][0]]),
    ) as Record<TabId, string>;
    const data = { ...this._config, tabs, default_tab: defaultTab, layouts };
    if (this._haForm) {
      return html`<ha-form
        .hass=${this.hass}
        .data=${data}
        .schema=${this._schema(t, this._config.compact === true, tabs)}
        .computeLabel=${(schema: { name: string; title?: string }) =>
          schema.title
            ? schema.title
            : (TAB_IDS as string[]).includes(schema.name)
              ? t(`tab.${schema.name}`)
              : t(`editor.${schema.name}`)}
        .computeHelper=${(schema: { name: string }) =>
          schema.name === "name" ? t("editor.name_helper") : schema.name === "recent" ? t("editor.recent_helper") : undefined}
        @value-changed=${(ev: CustomEvent<{ value: FormData }>) => this._update(ev.detail.value)}
      ></ha-form>`;
    }
    return this._renderNative(t, data as JblBarCardConfig);
  }

  /** Plain HTML form for when ha-form cannot be loaded (very old or future HA, demo page). */
  private _renderNative(t: Translate, data: JblBarCardConfig): TemplateResult {
    const bars = findBars(this.hass!);
    const tabs = (data.tabs ?? [...TAB_IDS]) as TabId[];
    const toggleTab = (tab: TabId, on: boolean): void => {
      const next = on ? [...tabs, tab] : tabs.filter((x) => x !== tab);
      this._update({ tabs: TAB_IDS.filter((x) => next.includes(x)) });
    };
    return html`<div class="native">
      <label
        >${t("editor.entity")}
        <select @change=${(ev: Event) => this._update({ entity: (ev.target as HTMLSelectElement).value || undefined })}>
          <option value="" ?selected=${!data.entity}>—</option>
          ${bars.map((id) => html`<option value=${id} ?selected=${data.entity === id}>${id}</option>`)}
        </select>
      </label>
      <label
        >${t("editor.name")}
        <input
          type="text"
          .value=${data.name ?? ""}
          placeholder=${t("editor.name_helper")}
          @change=${(ev: Event) => this._update({ name: (ev.target as HTMLInputElement).value })}
        />
      </label>
      <label class="check"
        ><input
          type="checkbox"
          .checked=${data.compact === true}
          @change=${(ev: Event) => this._update({ compact: (ev.target as HTMLInputElement).checked })}
        />${t("editor.compact")}</label
      >
      ${data.compact
        ? nothing
        : html`<fieldset>
              <legend>${t("editor.tabs")}</legend>
              ${TAB_IDS.map(
                (tab) =>
                  html`<label class="check"
                    ><input
                      type="checkbox"
                      .checked=${tabs.includes(tab)}
                      @change=${(ev: Event) => toggleTab(tab, (ev.target as HTMLInputElement).checked)}
                    />${t(`tab.${tab}`)}</label
                  >`,
              )}
            </fieldset>
            <label
              >${t("editor.default_tab")}
              <select @change=${(ev: Event) => this._update({ default_tab: (ev.target as HTMLSelectElement).value as TabId })}>
                ${tabs.map(
                  (tab) => html`<option value=${tab} ?selected=${(data.default_tab ?? tabs[0]) === tab}>${t(`tab.${tab}`)}</option>`,
                )}
              </select>
            </label>`}
      <fieldset>
        <legend>${t("editor.layouts")}</legend>
        ${(data.compact ? (["home"] as TabId[]) : tabs).map(
          (tab) =>
            html`<label
              >${t(`tab.${tab}`)}
              <select
                @change=${(ev: Event) =>
                  this._update({ layouts: { ...data.layouts, [tab]: (ev.target as HTMLSelectElement).value } })}
              >
                ${TAB_LAYOUTS[tab].map(
                  (layout) =>
                    html`<option value=${layout} ?selected=${(data.layouts?.[tab] ?? TAB_LAYOUTS[tab][0]) === layout}>
                      ${t(`layout.${tab}.${layout}`)}
                    </option>`,
                )}
              </select>
            </label>`,
        )}
      </fieldset>
      <label class="check"
        ><input
          type="checkbox"
          .checked=${data.recent === true}
          @change=${(ev: Event) => this._update({ recent: (ev.target as HTMLInputElement).checked })}
        />${t("editor.recent")}</label
      >
      <div class="helper">${t("editor.recent_helper")}</div>
    </div>`;
  }

  static override styles = css`
    .loading,
    .helper {
      color: var(--secondary-text-color);
      font-size: 0.9rem;
    }
    .native {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .native label {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .native label.check {
      flex-direction: row;
      align-items: center;
      gap: 8px;
    }
    .native select,
    .native input[type="text"] {
      font: inherit;
      padding: 6px 8px;
    }
    fieldset {
      border: 1px solid var(--divider-color, #ccc);
      border-radius: 8px;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
  `;
}

if (!customElements.get(EDITOR_TAG)) customElements.define(EDITOR_TAG, JblBarCardEditor);

declare global {
  interface HTMLElementTagNameMap {
    "jbl-bar-card-editor": JblBarCardEditor;
  }
}
