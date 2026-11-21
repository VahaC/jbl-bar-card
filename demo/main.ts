/**
 * Demo harness: renders the card against MockBar (a fake hass) with stand-ins for the two
 * HA elements the card uses (ha-card, ha-icon). Run with `npm run dev`.
 */
import * as mdi from "@mdi/js";
import "../src/jbl-bar-card";
import type { JblBarCard } from "../src/jbl-bar-card";
import type { JblBarCardEditor } from "../src/editor";
import type { JblBarCardConfig, TabId } from "../src/types";
import { MEDIA_PLAYER, MockBar } from "./mock-hass";

/* ---------- HA element stand-ins ---------- */

class DemoHaCard extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host { display: block; background: var(--ha-card-background, var(--card-background-color, #fff));
        border-radius: var(--ha-card-border-radius, 12px); border: 1px solid var(--divider-color);
        color: var(--primary-text-color); }
    </style><slot></slot>`;
  }
}

class DemoHaIcon extends HTMLElement {
  private _icon = "";
  set icon(value: string) {
    this._icon = value;
    this.render();
  }
  get icon(): string {
    return this._icon;
  }
  connectedCallback(): void {
    this.render();
  }
  private render(): void {
    const key = "mdi" + this._icon.replace(/^mdi:/, "").replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());
    const path = (mdi as Record<string, string>)[key] ?? mdi.mdiHelpCircleOutline;
    this.innerHTML = `<svg viewBox="0 0 24 24" width="var(--mdc-icon-size, 24px)" style="width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px);fill:currentColor;display:block"><path d="${path}"></path></svg>`;
  }
}

if (!customElements.get("ha-card")) customElements.define("ha-card", DemoHaCard);
if (!customElements.get("ha-icon")) customElements.define("ha-icon", DemoHaIcon);

/* ---------- Mock bar ---------- */

const logEl = document.getElementById("log") as HTMLPreElement;
const log = (line: string): void => {
  const time = new Date().toLocaleTimeString();
  logEl.textContent = `${time} ${line}\n${logEl.textContent ?? ""}`.slice(0, 20000);
};

const params = new URLSearchParams(location.search);
const bar = new MockBar({ language: params.get("lang") ?? "en", log });
(window as unknown as { bar: MockBar }).bar = bar;
// Screenshot helpers: ?docked=1, ?theme=light|dark, ?tab=sound|timers|system.
if (params.get("docked") === "1") bar.update((b) => (b.docked = true));
const firstTab = (params.get("tab") ?? undefined) as TabId | undefined;

const configs: Record<string, JblBarCardConfig> = {
  full: { type: "custom:jbl-bar-card", entity: MEDIA_PLAYER, ...(firstTab ? { default_tab: firstTab } : {}) },
  narrow: { type: "custom:jbl-bar-card", entity: MEDIA_PLAYER, default_tab: "timers" },
  compact: { type: "custom:jbl-bar-card", entity: MEDIA_PLAYER, compact: true, name: "Living room" },
};

const cards: JblBarCard[] = [];
for (const [slot, config] of Object.entries(configs)) {
  const card = document.createElement("jbl-bar-card");
  card.setConfig(config);
  card.hass = bar.hass();
  document.getElementById(`slot-${slot}`)!.appendChild(card);
  cards.push(card);
}

const editor = document.createElement("jbl-bar-card-editor") as JblBarCardEditor;
editor.hass = bar.hass();
editor.setConfig(configs.full);
editor.addEventListener("config-changed", (ev) => {
  const config = (ev as CustomEvent<{ config: JblBarCardConfig }>).detail.config;
  log(`config-changed ${JSON.stringify(config)}`);
  cards[0].setConfig(config);
});
document.getElementById("editor")!.appendChild(editor);

bar.subscribe(() => {
  const hass = bar.hass();
  for (const card of cards) card.hass = hass;
  editor.hass = hass;
});

document.addEventListener("hass-more-info", (ev) => {
  log(`more-info ${(ev as CustomEvent<{ entityId: string }>).detail.entityId}`);
});

setInterval(() => bar.tick(), 1000);

/* ---------- Controls ---------- */

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const applyTheme = (dark: boolean): void => {
  document.documentElement.classList.toggle("dark", dark);
  bar.setDark(dark);
};
$<HTMLInputElement>("dark").addEventListener("change", (ev) => applyTheme((ev.target as HTMLInputElement).checked));
const wantDark = params.has("theme") ? params.get("theme") === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
$<HTMLInputElement>("dark").checked = wantDark;
applyTheme(wantDark);

const lang = $<HTMLSelectElement>("lang");
lang.value = bar.language;
lang.addEventListener("change", () => bar.setLanguage(lang.value));
// Keep the picker in step when the language is changed from code (tests, console).
bar.subscribe(() => {
  if (lang.value !== bar.language) lang.value = bar.language;
});

$("remote").addEventListener("click", () => void bar.simulateRemote("bass_next"));
$("dock").addEventListener("click", () => bar.update((b) => (b.docked = !b.docked)));
$("reach").addEventListener("click", () => bar.update((b) => (b.reachable = !b.reachable)));
$("battery").addEventListener("click", () =>
  bar.update((b) => {
    b.batteryLeft = b.batteryLeft < 20 ? 82 : 14;
  }),
);
$("eqreset").addEventListener("click", () => bar.update((b) => (b.eqResetNeeded = !b.eqResetNeeded)));
const SUB_CYCLE = ["unknown", "Connected", "Reconnecting", "Not connected"];
$("sub").addEventListener("click", () =>
  bar.update((b) => {
    b.subStatus = SUB_CYCLE[(SUB_CYCLE.indexOf(b.subStatus) + 1) % SUB_CYCLE.length];
  }),
);
$("slow").addEventListener("change", (ev) => {
  bar.delayMs = (ev.target as HTMLInputElement).checked ? 2500 : 600;
});
