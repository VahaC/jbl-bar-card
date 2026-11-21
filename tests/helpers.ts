import "../src/jbl-bar-card";
import type { JblBarCard } from "../src/jbl-bar-card";
import { discover } from "../src/discovery";
import { normalizeConfig } from "../src/config";
import type { JblBarCardConfig, TabContext } from "../src/types";
import { MEDIA_PLAYER, MockBar } from "../demo/mock-hass";
import type { MockOptions } from "../demo/mock-hass";

/** A fixed clock: 2026-11-21 20:00:00 UTC. */
export const NOW = Date.UTC(2026, 10, 21, 20, 0, 0);

export function newBar(options: MockOptions = {}): MockBar {
  return new MockBar({ delayMs: 0, now: () => NOW, ...options });
}

export interface Mounted {
  bar: MockBar;
  card: JblBarCard;
  root: ShadowRoot;
  /** Push the bar's latest hass into the card and wait for the render. */
  sync(): Promise<void>;
  $(selector: string): HTMLElement | null;
  $$(selector: string): HTMLElement[];
  text(): string;
}

/** Mount a real <jbl-bar-card> wired to a MockBar. */
export async function mountCard(config: Partial<JblBarCardConfig> = {}, bar: MockBar = newBar()): Promise<Mounted> {
  const card = document.createElement("jbl-bar-card");
  card.setConfig({ type: "custom:jbl-bar-card", entity: MEDIA_PLAYER, ...config });
  card.hass = bar.hass();
  document.body.appendChild(card);
  bar.subscribe(() => {
    card.hass = bar.hass();
  });
  await card.updateComplete;
  const root = card.shadowRoot!;
  return {
    bar,
    card,
    root,
    async sync() {
      card.hass = bar.hass();
      await card.updateComplete;
    },
    $: (selector) => root.querySelector<HTMLElement>(selector),
    $$: (selector) => Array.from(root.querySelectorAll<HTMLElement>(selector)),
    text: () => (root.textContent ?? "").replace(/\s+/g, " "),
  };
}

/** Wait for queued service calls and re-renders. */
export async function settle(m: Mounted, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await m.sync();
  }
}

/** A TabContext for rendering one tab function directly (tab unit tests). */
export function tabContext(bar: MockBar = newBar(), config: Partial<JblBarCardConfig> = {}): TabContext {
  const card = document.createElement("jbl-bar-card");
  const hass = bar.hass();
  const normalized = normalizeConfig({ type: "custom:jbl-bar-card", entity: MEDIA_PLAYER, ...config });
  return card.buildContext(hass, discover(hass, MEDIA_PLAYER), normalized, "en");
}

export function cleanup(): void {
  document.body.innerHTML = "";
}
