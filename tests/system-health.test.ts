// tests of System tab layout variant C ("Health dashboard").
import { afterEach, describe, expect, it } from "vitest";
import { render } from "lit";
import { renderSystemTab } from "../src/tabs/system";
import type { TabContext } from "../src/types";
import { cleanup, mountCard, newBar, settle, tabContext } from "./helpers";
import type { Mounted } from "./helpers";

afterEach(cleanup);

const system = (bar = newBar()): Promise<Mounted> => mountCard({ default_tab: "system", layouts: { system: "health" } }, bar);

const clean = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();
const cardText = (m: Mounted, card: string): string => clean(m.$(`.sys-c-card.${card}`)?.textContent);
const cardButtons = (m: Mounted, card: string): HTMLButtonElement[] =>
  m.$$(card === "restart" ? ".sys-c-restart .sys-c-btn" : `.sys-c-card.${card} .sys-c-btn`) as HTMLButtonElement[];

/** Cards in DOM order, and a check that grid placement keeps that order (no hole before a wide card). */
function gridOrder(m: Mounted): string[] {
  const cards = m.$$(".sys-c-grid > .sys-c-card");
  let col = 0;
  for (const card of cards) {
    const wide = card.classList.contains("wide");
    // A half card waiting for a partner must never be followed by a wide card.
    if (wide) expect(col, `half card before wide ${card.classList[1]}`).toBe(0);
    else col = col === 0 ? 1 : 0;
  }
  expect(col, "a half card is left alone in the last row").toBe(0);
  return cards.map((card) => card.classList[1]);
}

function renderTab(ctx: TabContext): HTMLElement {
  const host = document.createElement("div");
  render(renderSystemTab(ctx), host);
  return host;
}

describe("System variant C: layout", () => {
  it("renders the health hero, the device cards and the diagnostics chips", async () => {
    const m = await system();
    expect(m.$(".sys-c")).not.toBeNull();
    const hero = m.$(".sys-c-hero")!;
    // Only the title is live, so a battery tick does not re-read the whole hero.
    expect(hero.getAttribute("aria-live")).toBeNull();
    expect(hero.querySelector(".sys-c-hero-title")?.getAttribute("aria-live")).toBe("polite");
    expect(clean(hero.querySelector(".sys-c-hero-title")?.textContent)).toBe("1 thing needs attention");
    expect(hero.classList.contains("tone-warn")).toBe(true);
    expect(gridOrder(m)).toEqual(["bluetooth", "subwoofer", "calibration"]);
    // Restart is a slim row after the device cards, not a card in the grid.
    expect(m.$(".sys-c-grid + .sys-c-restart")).not.toBeNull();
    expect(m.$(".sys-c-grid .sys-c-restart")).toBeNull();
    expect(cardText(m, "bluetooth")).toContain("Pixel 9");
    expect(m.$(".sys-c-card.bluetooth .sys-c-status.tone-ok")?.textContent).toContain("Connected");
    expect(m.$(".sys-c-card.bluetooth .sys-c-status")?.getAttribute("aria-live")).toBe("polite");
    // The calibration guide shows in its card, and its start is the one filled button.
    expect(cardText(m, "calibration")).toContain("Step 1: put both rear speakers near your listening position");
    expect(m.$$(".sys-c-btn.primary").map((b) => clean(b.textContent))).toEqual(["Start calibration"]);
    expect(m.$(".sys-c-note")?.getAttribute("aria-live")).toBeNull();
    const chips = m.$$(".sys-c-chip");
    expect(chips.map((c) => c.classList[1])).toEqual(["cpu", "memory", "temperature", "wifi", "uptime", "mode_after_standby"]);
    expect(clean(m.$(".sys-c-chip.cpu .sys-c-chip-value")?.textContent)).toBe("23%");
    expect(m.$(".sys-c-chip.cpu .sys-c-gauge.tone-ok")).not.toBeNull();
    expect(m.$(".sys-c-chip.uptime .sys-c-gauge")).toBeNull();
    expect(clean(m.$(".sys-c-chip.wifi .sys-c-chip-value")?.textContent)).toBe("-58 dBm Good");
    expect(m.$(".sys-c-hidden")).toBeNull();
  });

  it("opens more-info from a diagnostics chip", async () => {
    const m = await system();
    let opened: string | undefined;
    m.card.addEventListener("hass-more-info", (ev) => (opened = (ev as CustomEvent).detail.entityId));
    m.$(".sys-c-chip.memory")!.click();
    expect(opened).toBe("sensor.jbl_bar_9_1_memory_used");
  });

  it("says all good when nothing needs attention", async () => {
    const bar = newBar();
    bar.update((b) => {
      b.batteryLeft = 80;
      b.batteryRight = 90;
    });
    const m = await system(bar);
    const hero = m.$(".sys-c-hero")!;
    expect(hero.classList.contains("tone-ok")).toBe(true);
    expect(clean(hero.textContent)).toContain("All good");
    expect(hero.querySelector(".sys-c-issues")).toBeNull();
    expect(hero.querySelector(".sys-c-advice")).toBeNull();
  });
});

describe("System variant C: low rear battery", () => {
  it("lists the low speaker and the advice in the hero", async () => {
    const m = await system();
    const hero = m.$(".sys-c-hero")!;
    expect(clean(hero.querySelector(".sys-c-issues")?.textContent)).toBe("Rear left: 14%");
    expect(hero.querySelector(".sys-c-advice")?.textContent).toContain("Put both rear speakers back on the ends of the soundbar");
  });

  it("keeps the calm hero while they charge on the bar", async () => {
    const bar = newBar();
    bar.update((b) => (b.docked = true));
    const m = await system(bar);
    const hero = m.$(".sys-c-hero")!;
    expect(hero.classList.contains("tone-ok")).toBe(true);
    expect(clean(hero.querySelector(".sys-c-hero-title")?.textContent)).toBe("All good");
    expect(clean(hero.textContent)).not.toContain("needs attention");
    expect(hero.querySelector(".sys-c-issues li.tone-info")?.textContent).toContain("Rear left: 14%");
    expect(m.$(".sys-c-advice.charging")?.textContent).toContain("charging");
  });
});

describe("System variant C: actions", () => {
  it("pairs Bluetooth, shows the pending state and then the pairing hint", async () => {
    const m = await system();
    const [pair] = cardButtons(m, "bluetooth");
    expect(clean(pair.textContent)).toBe("Pair a device");
    pair.click();
    await m.card.updateComplete;
    const pending = cardButtons(m, "bluetooth")[0];
    expect(pending.classList.contains("pending")).toBe(true);
    expect(pending.getAttribute("aria-disabled")).toBe("true");
    expect(pending.querySelector(".spinner")).not.toBeNull();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({
      domain: "button",
      service: "press",
      target: { entity_id: "button.jbl_bar_9_1_bluetooth_pairing" },
    });
    expect(m.$(".sys-c-card.bluetooth .sys-c-note")?.textContent).toContain("The soundbar is ready to pair.");
    expect(m.$(".sys-c-card.bluetooth")?.classList.contains("wide")).toBe(true);
    // The order stays Bluetooth, Subwoofer, Calibration, then Restart, with no half card before a wide one.
    expect(gridOrder(m)).toEqual(["bluetooth", "subwoofer", "calibration"]);
    expect(m.$(".sys-c-grid + .sys-c-restart")).not.toBeNull();
  });

  it("shows why pairing cannot run, offers to switch the source, and switches", async () => {
    const bar = newBar();
    bar.update((b) => {
      b.source = "TV";
      b.btConnected = false;
    });
    const m = await system(bar);
    expect(m.$(".sys-c-card.bluetooth .sys-c-status.tone-neutral")?.textContent).toContain("Not connected");
    expect(m.$(".sys-c-card.bluetooth .sys-c-lines")).toBeNull();
    const blocked = m.$(".sys-c-card.bluetooth .sys-c-blocked")!;
    expect(blocked.textContent).toContain("Pair a device");
    expect(blocked.textContent).toContain("Pairing works only while Bluetooth is the source.");
    const buttons = cardButtons(m, "bluetooth");
    expect(buttons).toHaveLength(1);
    expect(clean(buttons[0].textContent)).toBe("Switch to Bluetooth");
    // The way forward sits right under the reason.
    expect(blocked.contains(buttons[0])).toBe(true);
    buttons[0].click();
    await settle(m);
    expect(bar.calls.at(-1)).toMatchObject({ service: "select_source", data: { source: "Bluetooth" } });
    expect(m.$(".sys-c-card.bluetooth .sys-c-blocked")).toBeNull();
    expect(cardButtons(m, "bluetooth").map((b) => clean(b.textContent))).toEqual(["Pair a device"]);
  });

  it("starts calibration, then lets the status spinner and the guide carry the measurement", async () => {
    const bar = newBar();
    const m = await system(bar);
    cardButtons(m, "calibration")[0].click();
    await settle(m);
    expect(bar.calls.at(-1)).toMatchObject({ service: "press", target: { entity_id: "button.jbl_bar_9_1_calibrate_surround" } });
    expect(m.$(".sys-c-card.calibration .sys-c-status .spinner")).not.toBeNull();
    expect(m.$(".sys-c-card.calibration .sys-c-status")?.getAttribute("aria-live")).toBe("polite");
    expect(cardText(m, "calibration")).toContain("Keep the room quiet");
    // No third "Measuring…": nothing to press while it runs.
    expect(cardButtons(m, "calibration")).toHaveLength(0);
    expect(cardText(m, "calibration")).not.toContain("Measuring…");
  });

  it("presses an action only once while its command is on the way", async () => {
    const bar = newBar();
    const m = await system(bar);
    const [pair] = cardButtons(m, "bluetooth");
    pair.click();
    await m.card.updateComplete;
    const pending = cardButtons(m, "bluetooth")[0];
    expect(pending.getAttribute("aria-disabled")).toBe("true");
    pending.click();
    await settle(m);
    expect(bar.calls.filter((c) => c.service === "press")).toHaveLength(1);
  });

  it("explains why calibration and subwoofer pairing cannot run", async () => {
    const bar = newBar();
    bar.update((b) => (b.docked = true));
    const m = await system(bar);
    expect(cardButtons(m, "calibration")).toHaveLength(0);
    expect(m.$(".sys-c-card.calibration .sys-c-blocked")?.textContent).toContain("Detach both rear speakers from the soundbar first.");
    bar.update((b) => {
      b.docked = false;
      b.calibration = "Measuring";
    });
    await m.sync();
    expect(m.$(".sys-c-card.subwoofer .sys-c-blocked")?.textContent).toContain("Wait until the calibration ends.");
  });

  it("pairs the subwoofer with instructions in its card", async () => {
    const bar = newBar();
    const m = await system(bar);
    cardButtons(m, "subwoofer")[0].click();
    await settle(m);
    expect(bar.calls.at(-1)).toMatchObject({ service: "press", target: { entity_id: "button.jbl_bar_9_1_pair_subwoofer" } });
    expect(m.$(".sys-c-card.subwoofer .sys-c-status.tone-info")?.textContent).toContain("Pairing");
    expect(m.$(".sys-c-card.subwoofer .sys-c-note")?.textContent).toContain("hold the pairing button on the subwoofer");
    expect(cardButtons(m, "subwoofer")).toHaveLength(0);
    // The wide subwoofer card does not pull Calibration above it.
    expect(gridOrder(m)).toEqual(["bluetooth", "subwoofer", "calibration"]);
  });

  it("asks before restarting and sends nothing on cancel", async () => {
    const bar = newBar();
    const m = await system(bar);
    const restart = (): HTMLButtonElement => cardButtons(m, "restart")[0];
    expect(restart().classList.contains("danger")).toBe(true);
    restart().click();
    await m.card.updateComplete;
    expect(m.$(".dialog h3")?.textContent).toBe("Restart the soundbar?");
    (m.$(".dialog .btn.ghost") as HTMLButtonElement).click();
    await settle(m);
    expect(bar.calls).toHaveLength(0);
    restart().click();
    await m.card.updateComplete;
    (m.$(".dialog .btn.danger") as HTMLButtonElement).click();
    await settle(m);
    expect(bar.calls).toHaveLength(1);
    expect(bar.calls[0]).toMatchObject({ service: "press", target: { entity_id: "button.jbl_bar_9_1_restart" } });
  });
});

describe("System variant C: unreachable bar and missing entities", () => {
  it("does not claim all good when the bar is unreachable, and explains blocked actions once", async () => {
    const bar = newBar();
    bar.update((b) => {
      b.reachable = false;
      b.batteryLeft = 80;
    });
    const m = await system(bar);
    // The card's offline strip already says it; no hero repeats it, and nothing says "All good".
    expect(m.$(".sys-c-hero")).toBeNull();
    expect(clean(m.$(".sys-c")?.textContent)).not.toContain("All good");
    // Every action that cannot run is a label, never a bare disabled button...
    for (const btn of m.$$(".sys-c button.sys-c-btn")) {
      expect(btn.getAttribute("aria-disabled")).toBe(btn.classList.contains("pending") ? "true" : "false");
    }
    const blocked = m.$$(".sys-c-blocked");
    expect(blocked.length).toBeGreaterThan(0);
    // ...and one shared line says why, instead of the same reason in every box.
    expect(clean(m.$(".sys-c-offline")?.textContent)).toBe("Actions come back when the soundbar is reachable again.");
    for (const box of blocked) {
      if (!box.classList.contains("silent")) expect(clean(box.querySelector(".sys-c-reason")?.textContent).length).toBeGreaterThan(0);
    }
    expect(m.$$(".sys-c-blocked.silent .sys-c-reason")).toHaveLength(0);
    // The unknown dash is not shown as a status.
    expect(m.$$(".sys-c-status:not(.empty) .sys-c-status-text").map((s) => clean(s.textContent))).not.toContain("—");
  });

  it("marks stale issues as possibly out of date while the bar is unreachable", async () => {
    const bar = newBar();
    bar.update((b) => (b.reachable = false));
    const m = await system(bar);
    const hero = m.$(".sys-c-hero");
    if (hero) expect(clean(hero.textContent)).toContain("may be out of date");
    else expect(m.$(".sys-c-issues")).toBeNull();
  });

  it("shows no shared offline line while the bar is reachable", async () => {
    const m = await system();
    expect(m.$(".sys-c-offline")).toBeNull();
  });

  it("hides every block whose entity is missing", () => {
    const ctx = tabContext(undefined, { layouts: { system: "health" } });
    const host = renderTab({
      ...ctx,
      entities: {
        ...ctx.entities,
        calibrate: undefined,
        calibration: undefined,
        subwoofer: undefined,
        sub_pair: undefined,
        restart: undefined,
        bluetooth_pairing: undefined,
        wifi_signal: undefined,
        uptime: undefined,
      },
    });
    expect(host.querySelector(".sys-c")).not.toBeNull();
    expect(host.querySelector(".sys-c-card.calibration")).toBeNull();
    expect(host.querySelector(".sys-c-card.subwoofer")).toBeNull();
    expect(host.querySelector(".sys-c-restart")).toBeNull();
    expect(host.querySelector(".sys-c-card.bluetooth")).not.toBeNull();
    expect(host.querySelector(".sys-c-card.bluetooth .sys-c-actions")).toBeNull();
    expect(host.querySelector(".sys-c-chip.wifi")).toBeNull();
    expect(clean(host.querySelector(".sys-c-hidden summary")?.textContent)).toBe("Wi-Fi signal, Uptime: turned off in Home Assistant");
    expect(host.querySelector(".sys-c-hidden")?.textContent).toContain("Settings → Devices & services → JBL Bar 9.1");
  });

  it("hides the grid and diagnostics when nothing is there, and says so when the bar reports nothing", () => {
    const ctx = tabContext(undefined, { layouts: { system: "health" } });
    const noDevices = renderTab({
      ...ctx,
      entities: {
        ...ctx.entities,
        calibrate: undefined,
        calibration: undefined,
        subwoofer: undefined,
        sub_pair: undefined,
        restart: undefined,
        bluetooth_pairing: undefined,
        bluetooth_device: undefined,
        bluetooth_connected: undefined,
      },
    });
    expect(noDevices.querySelector(".sys-c-grid")).toBeNull();
    expect(noDevices.querySelector(".sys-c-diag")).not.toBeNull();

    const roles = [
      "rear_battery_left",
      "rear_battery_right",
      "rear_docked",
      "cpu",
      "memory",
      "temperature",
      "wifi_signal",
      "uptime",
      "mode_after_standby",
      "bluetooth_device",
      "bluetooth_audio",
      "bluetooth_connected",
      "bluetooth_pairing",
      "calibrate",
      "calibration",
      "subwoofer",
      "sub_pair",
      "restart",
    ];
    const empty = Object.fromEntries(roles.map((r) => [r, undefined]));
    const host = renderTab({ ...ctx, entities: { ...ctx.entities, ...empty } });
    expect(host.querySelector(".sys-c-hero")).toBeNull();
    expect(host.textContent).toContain("This soundbar reports no system information.");
  });

  it("is translated in Ukrainian and French", async () => {
    const uk = await system(newBar({ language: "uk" }));
    expect(uk.text()).not.toMatch(/system(_health)?\./);
    expect(clean(uk.$(".sys-c-hero-title")?.textContent)).toBe("Потребує уваги: 1");
    expect(uk.text()).toContain("Діагностика");
    expect(uk.text()).toContain("Ліва задня: 14%");
    cleanup();
    const fr = await system(newBar({ language: "fr" }));
    expect(fr.text()).not.toMatch(/system(_health)?\./);
    expect(clean(fr.$(".sys-c-hero-title")?.textContent)).toBe("1 point à vérifier");
    expect(clean(fr.$(".sys-c-chip.memory .sys-c-chip-value")?.textContent)).toBe("41,7 %");
  });
});
