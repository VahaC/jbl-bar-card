import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeConfig } from "../src/config";
import { cleanConfig } from "../src/editor";
import { formatNumber, formatTime } from "../src/format";
import { makeTranslate } from "../src/i18n";
import { JblBarCard } from "../src/jbl-bar-card";
import { MEDIA_PLAYER } from "../demo/mock-hass";
import { cleanup, mountCard, newBar, settle } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("card shell: tabs", () => {
  it("falls back to Home when every configured tab is hidden on this remote", async () => {
    // An older remote: no timers, messages or clock entities at all.
    const gone = ["sensor.jbl_bar_9_1_timers", "sensor.jbl_bar_9_1_messages", "switch.jbl_display_clock", "select.jbl_display_clock_when"];
    const base = newBar().hass();
    const states = { ...base.states };
    const entities = { ...base.entities };
    for (const id of gone) {
      delete states[id];
      delete entities[id];
    }
    const card = document.createElement("jbl-bar-card");
    card.setConfig({ type: "custom:jbl-bar-card", entity: MEDIA_PLAYER, tabs: ["timers"] });
    card.hass = { ...base, states, entities };
    document.body.appendChild(card);
    await card.updateComplete;
    const root = card.shadowRoot!;
    expect(root.querySelector(".content")?.textContent).toContain("Volume");
    expect(root.querySelector('[role="tablist"]')).toBeNull();
    // No tablist, so the content is not announced as a tab panel.
    expect(root.querySelector('[role="tabpanel"]')).toBeNull();
  });

  it("follows the ARIA tab pattern: one Tab stop, arrows and Home/End switch tabs", async () => {
    const m = await mountCard();
    const tabs = m.$$('[role="tab"]');
    expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1"]);
    expect(tabs[0].getAttribute("aria-controls")).toBe("jbl-panel");
    expect(m.$('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe("jbl-tab-home");

    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true }));
    await m.card.updateComplete;
    expect(m.$('[role="tab"][aria-selected="true"]')?.id).toBe("jbl-tab-sound");
    expect(m.$('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe("jbl-tab-sound");

    m.$("#jbl-tab-sound")!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, composed: true }));
    await m.card.updateComplete;
    expect(m.$('[role="tab"][aria-selected="true"]')?.id).toBe("jbl-tab-system");
    m.$("#jbl-tab-system")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true }));
    await m.card.updateComplete;
    expect(m.$('[role="tab"][aria-selected="true"]')?.id).toBe("jbl-tab-home");
  });

  it("makes only the checked radio of a group a Tab stop, and arrows select the next one", async () => {
    const m = await mountCard();
    const radios = m.$$('.section [role="radiogroup"] [role="radio"]').slice(0, 3);
    expect(radios.map((r) => r.textContent?.trim())).toEqual(["TV", "HDMI", "Bluetooth"]);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
    radios[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true }));
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "select_source", data: { source: "TV" } });
  });
});

describe("card shell: entity checks", () => {
  it("refuses a media player that is not in the entity registry (YAML or template player)", async () => {
    const bar = newBar();
    const base = bar.hass();
    const sonos = {
      entity_id: "media_player.sonos",
      state: "playing",
      attributes: { friendly_name: "Sonos", volume_level: 0.5 },
      last_changed: "",
      last_updated: "",
    };
    const card = document.createElement("jbl-bar-card");
    card.setConfig({ type: "custom:jbl-bar-card", entity: "media_player.sonos" });
    card.hass = { ...base, states: { ...base.states, "media_player.sonos": sonos } };
    document.body.appendChild(card);
    await card.updateComplete;
    const text = card.shadowRoot!.textContent ?? "";
    expect(text).toContain("is not a media player of the JBL Bar 9.1 integration");
    expect(text).toContain(MEDIA_PLAYER);
    expect(card.shadowRoot!.querySelector(".tabs")).toBeNull();
  });
});

describe("card shell: toggles send one command per change", () => {
  it("ignores a second tap on Night, mute and power while the first is pending", async () => {
    const bar = newBar({ delayMs: 20 });
    const m = await mountCard({}, bar);
    const night = m.$$(".chip").find((c) => c.textContent?.includes("Night")) as HTMLButtonElement;
    night.click();
    await m.card.updateComplete;
    night.click();
    const mute = m.$(".mute") as HTMLButtonElement;
    mute.click();
    await m.card.updateComplete;
    mute.click();
    const power = m.$(".power") as HTMLButtonElement;
    power.click();
    await m.card.updateComplete;
    power.click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    await settle(m);
    const services = bar.calls.map((c) => `${c.domain}.${c.service}`);
    expect(services.filter((s) => s.startsWith("switch.")).length).toBe(1);
    expect(services.filter((s) => s === "media_player.volume_mute").length).toBe(1);
    expect(services.filter((s) => s === "media_player.turn_off").length).toBe(1);
  });
});

describe("card shell: busy strip", () => {
  it("does not blame the web page for a calibration and shows its phase", async () => {
    const bar = newBar();
    bar.update((b) => (b.calibration = "Measuring"));
    const m = await mountCard({}, bar);
    const strip = m.$(".strip.busy")?.textContent ?? "";
    expect(strip).toContain("Calibrating the surround sound");
    expect(strip).toContain("Measuring");
    expect(strip).not.toContain("from the web page");
  });

  it("still names the web page for other remote-side commands", async () => {
    const bar = newBar();
    bar.update((b) => (b.local = { action: "bass_next", source: "remote" }));
    const m = await mountCard({}, bar);
    expect(m.$(".strip.busy")?.textContent).toContain("(from the web page)");
  });
});

describe("card shell: errors", () => {
  it("shows a lost connection as a readable, translated message", async () => {
    const bar = newBar({ language: "uk" });
    const m = await mountCard({}, bar);
    vi.spyOn(bar, "callService").mockRejectedValue({ type: "result", success: false, error: { code: 3, message: "Connection lost" } });
    (m.$(".mute") as HTMLButtonElement).click();
    await settle(m);
    const strip = m.$(".strip.error")?.textContent ?? "";
    expect(strip).toContain("Зв'язок із Home Assistant обірвався");
    expect(strip).not.toContain("[object Object]");
  });

  it("drops an expired error after Lovelace detached and re-attached the card", async () => {
    const m = await mountCard();
    vi.spyOn(m.bar, "callService").mockRejectedValue({ code: "x", message: "Boom" });
    (m.$(".mute") as HTMLButtonElement).click();
    await settle(m);
    expect(m.$(".strip.error")?.textContent).toContain("Boom");
    // A view switch: the card is detached (its timeouts are cleared) and attached again later.
    m.card.remove();
    const later = Date.now() + 25000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    document.body.appendChild(m.card);
    await m.card.updateComplete;
    expect(m.$(".strip.error")).toBeNull();
  });
});

describe("card shell: confirmation dialog", () => {
  it("takes focus, closes on Escape and gives focus back to its opener", async () => {
    const m = await mountCard({ default_tab: "system" });
    const restart = m.$(".sys-b-restart") as HTMLButtonElement;
    restart.focus();
    restart.click();
    await m.card.updateComplete;
    await m.card.updateComplete;
    const dialog = m.$(".dialog")!;
    expect(dialog.getAttribute("aria-describedby")).toBe("jbl-dialog-message");
    expect(m.root.activeElement).toBe(m.$(".dialog .btn.cancel"));
    expect(m.$(".shell")?.hasAttribute("inert")).toBe(true);

    // Tab stays in the dialog.
    m.$(".dialog .btn.cancel")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, composed: true }));
    expect(m.root.activeElement).toBe(m.$(".dialog .btn.ok"));
    m.$(".dialog .btn.ok")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, composed: true }));
    expect(m.root.activeElement).toBe(m.$(".dialog .btn.cancel"));

    m.root.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
    await m.card.updateComplete;
    await m.card.updateComplete;
    expect(m.$(".dialog")).toBeNull();
    expect(m.root.activeElement).toBe(restart);
    expect(m.bar.calls).toHaveLength(0);
  });
});

describe("card shell: header and grid", () => {
  it("opens more-info from a real button in the header", async () => {
    const m = await mountCard();
    let opened: string | undefined;
    m.card.addEventListener("hass-more-info", (ev) => (opened = (ev as CustomEvent).detail.entityId));
    const titles = m.$(".titles") as HTMLButtonElement;
    expect(titles.tagName).toBe("BUTTON");
    titles.click();
    expect(opened).toBe(MEDIA_PLAYER);
  });

  it("cannot be shrunk below the full width of a section", () => {
    expect(new JblBarCard().getGridOptions().min_columns).toBe(12);
  });
});

describe("config errors and the editor", () => {
  it("translates config errors", () => {
    const uk = makeTranslate("uk");
    expect(() => normalizeConfig({ type: "x", default_tab: "eq" as never }, uk)).toThrow(/Невідома default_tab «eq»/);
    expect(() => normalizeConfig({ type: "x", entity: "switch.tv" }, makeTranslate("fr"))).toThrow(/doit être le lecteur multimédia/);
  });

  it("keeps Home when every tab is unticked and drops a default_tab that adds nothing", () => {
    expect(cleanConfig({ type: "x", tabs: [] })).toEqual({ type: "x", tabs: ["home"] });
    expect(cleanConfig({ type: "x", name: "Bar", default_tab: "home" })).toEqual({ type: "x", name: "Bar" });
    expect(cleanConfig({ type: "x", tabs: ["sound", "timers"], default_tab: "home" })).toEqual({ type: "x", tabs: ["sound", "timers"] });
    expect(cleanConfig({ type: "x", tabs: ["sound", "timers"], default_tab: "timers" })).toEqual({
      type: "x",
      tabs: ["sound", "timers"],
      default_tab: "timers",
    });
  });

  it("keeps only the layouts that differ from each tab's default", () => {
    expect(
      cleanConfig({ type: "x", layouts: { home: "classic", sound: "mixer", timers: "classic", system: "list" } }),
    ).toEqual({ type: "x", layouts: { sound: "mixer" } });
    expect(cleanConfig({ type: "x", layouts: { home: "classic", system: "list" } })).toEqual({ type: "x" });
  });
});

describe("number and time formats", () => {
  it("follows HA's number_format", () => {
    expect(formatNumber({ language: "en", number_format: "decimal_comma" }, 41.7)).toBe("41,7");
    expect(formatNumber({ language: "en", number_format: "comma_decimal" }, 1234.5)).toBe("1,234.5");
    expect(formatNumber({ language: "en", number_format: "none" }, 1234.5)).toBe("1234.5");
    expect(formatNumber({ language: "uk", number_format: "language" }, 41.7)).toBe("41,7");
    expect(formatNumber("en", 41.7)).toBe("41.7");
  });

  it("shows times in the server's zone when the profile asks for it", () => {
    const at = Date.UTC(2026, 10, 21, 20, 15);
    expect(formatTime({ language: "en", time_format: "24", time_zone: "server" }, at, "Asia/Tokyo")).toBe("05:15");
    expect(formatTime({ language: "en", time_format: "24", time_zone: "server" }, at, "Europe/Kyiv")).toBe("22:15");
    // An unknown zone falls back to the browser's zone instead of failing.
    expect(formatTime({ language: "en", time_format: "24", time_zone: "server" }, at, "Not/AZone")).toMatch(/^\d\d:\d\d$/);
  });
});
