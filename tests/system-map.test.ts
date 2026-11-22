// tests for System tab layout variant A ("Hardware map").
import { afterEach, describe, expect, it } from "vitest";
import { render } from "lit";
import { renderSystemMap } from "../src/tabs/system-layouts/map";
import { systemModel } from "../src/tabs/system-model";
import type { TabContext } from "../src/types";
import { cleanup, mountCard, newBar, settle, tabContext } from "./helpers";
import type { Mounted } from "./helpers";

afterEach(cleanup);

const system = (bar = newBar()): Promise<Mounted> => mountCard({ default_tab: "system", layouts: { system: "map" } }, bar);
const text = (el: Element | null): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const btn = (m: Mounted, key: string): HTMLButtonElement => m.$(`.sys-a-btn[data-key="${key}"]`) as HTMLButtonElement;

async function open(m: Mounted, node: "phone" | "cal" | "sub"): Promise<void> {
  m.$(`.sys-a-${node}`)!.click();
  await m.card.updateComplete;
}

function renderA(ctx: TabContext): HTMLElement {
  const host = document.createElement("div");
  render(renderSystemMap(ctx, systemModel(ctx)), host);
  return host;
}

describe("System variant A: hardware map", () => {
  it("draws the devices, the low battery banner, the metric chips and a quiet restart", async () => {
    const m = await system();
    expect(m.$(".sys-a")).not.toBeNull();
    expect(m.$(".system")).toBeNull();
    // Phone node linked to the bar with a solid line.
    expect(text(m.$(".sys-a-phone"))).toContain("Pixel 9");
    expect(m.$(".sys-a-link.solid")).not.toBeNull();
    expect(text(m.$(".sys-a-cal"))).toContain("Not running");
    expect(m.$$(".sys-a-rear")).toHaveLength(2);
    expect(m.$(".sys-a-batt.left.low")?.textContent).toContain("14%");
    expect(m.$(".sys-a-batt.right.low")).toBeNull();
    expect(text(m.$(".sys-a-sub"))).toContain("No recent status");
    // Banner: prominent, with the level and the advice.
    const banner = m.$(".sys-a-banner")!;
    expect(banner.getAttribute("role")).toBe("alert");
    expect(text(banner)).toContain("Rear left: 14%");
    expect(text(banner)).toContain("Put both rear speakers back on the ends of the soundbar");
    // Metrics strip.
    expect(m.$$(".sys-a-chip").map((c) => text(c))).toEqual([
      "CPU 23%",
      "RAM 41.7%",
      "52 °C",
      "Wi-Fi -58 dBm",
      "up 2 d 3 h",
      "after standby: Smart",
    ]);
    // No panel until a device is tapped; a hint says what tapping does.
    expect(m.$(".sys-a-panel")).toBeNull();
    expect(text(m.$(".sys-a-taphint"))).toBe("Tap a device to pair or calibrate it.");
    const restart = m.$(".sys-a-restart")!;
    expect(text(restart)).toBe("Restart soundbar…");
    expect(restart.getAttribute("title")).toBe("Use this when the soundbar stops responding.");
    expect(text(m.$(".sys-a-foot-hint"))).toBe("Use this when the soundbar stops responding.");
  });

  it("opens one device panel at a time and closes it again", async () => {
    const m = await system();
    await open(m, "phone");
    expect(m.$(".sys-a-panel.bt")).not.toBeNull();
    expect(m.$(".sys-a-phone")?.getAttribute("aria-expanded")).toBe("true");
    expect(text(m.$(".sys-a-panel"))).toContain("Streaming");
    await open(m, "cal");
    expect(m.$(".sys-a-panel.bt")).toBeNull();
    expect(m.$(".sys-a-panel.cal")).not.toBeNull();
    expect(text(m.$(".sys-a-panel"))).toContain("Step 1: put both rear speakers near your listening position");
    (m.$(".sys-a-close") as HTMLButtonElement).click();
    await m.card.updateComplete;
    expect(m.$(".sys-a-panel")).toBeNull();
  });

  it("opens more-info from a metric chip and from the panel's Details", async () => {
    const m = await system();
    const opened: string[] = [];
    m.card.addEventListener("hass-more-info", (ev) => opened.push((ev as CustomEvent).detail.entityId));
    m.$(".sys-a-chip.cpu")!.click();
    await open(m, "sub");
    (m.$(".sys-a-link-btn") as HTMLButtonElement).click();
    expect(opened).toEqual(["sensor.jbl_bar_9_1_cpu", "sensor.jbl_bar_9_1_subwoofer"]);
  });

  it("explains hidden diagnostics", async () => {
    const bar = newBar();
    delete bar.entities["sensor.jbl_bar_9_1_wi_fi_signal"];
    delete bar.entities["sensor.jbl_bar_9_1_uptime"];
    const m = await system(bar);
    expect(m.$(".sys-a-chip.wifi")).toBeNull();
    expect(text(m.$(".sys-a-hidden summary"))).toBe("Wi-Fi signal, Uptime: turned off in Home Assistant");
    expect(text(m.$(".sys-a-hidden"))).toContain("Settings → Devices & services → JBL Bar 9.1");
  });
});

describe("System variant A: actions", () => {
  it("pairs Bluetooth and shows the pairing hint", async () => {
    const m = await system();
    await open(m, "phone");
    const pair = btn(m, "system.bluetooth_pairing");
    expect(pair.getAttribute("aria-disabled")).toBe("false");
    pair.click();
    await m.card.updateComplete;
    expect(btn(m, "system.bluetooth_pairing").classList.contains("pending")).toBe(true);
    expect(btn(m, "system.bluetooth_pairing").getAttribute("aria-busy")).toBe("true");
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({
      domain: "button",
      service: "press",
      target: { entity_id: "button.jbl_bar_9_1_bluetooth_pairing" },
    });
    expect(text(m.$(".sys-a-panel"))).toContain("The soundbar is ready to pair.");
  });

  it("shows why pairing cannot run, ignores the press, and offers to switch source", async () => {
    const bar = newBar();
    bar.update((b) => {
      b.source = "TV";
      b.btConnected = false;
    });
    const m = await system(bar);
    expect(text(m.$(".sys-a-phone"))).toContain("No device");
    expect(m.$(".sys-a-link.dashed")).not.toBeNull();
    await open(m, "phone");
    // "Not connected" is said once, by the status line; there is no device block to repeat it.
    expect(m.$(".sys-a-device")).toBeNull();
    expect(text(m.$(".sys-a-status-text"))).toBe("Not connected");
    const pair = btn(m, "system.bluetooth_pairing");
    expect(pair.getAttribute("aria-disabled")).toBe("true");
    expect(pair.classList.contains("blocked")).toBe(true);
    const why = m.$(`#${pair.getAttribute("aria-describedby")}`);
    expect(text(why)).toBe("Pairing works only while Bluetooth is the source.");
    pair.click();
    await settle(m);
    expect(bar.calls).toHaveLength(0);
    btn(m, "system.bluetooth_source").click();
    await settle(m);
    expect(bar.calls.at(-1)).toMatchObject({ service: "select_source", data: { source: "Bluetooth" } });
    expect(btn(m, "system.bluetooth_source")).toBeNull();
    expect(btn(m, "system.bluetooth_pairing").getAttribute("aria-disabled")).toBe("false");
  });

  it("starts calibration and follows it with a spinner on the map", async () => {
    const bar = newBar();
    const m = await system(bar);
    await open(m, "cal");
    btn(m, "system.calibrate").click();
    await settle(m);
    expect(bar.calls.at(-1)).toMatchObject({ service: "press", target: { entity_id: "button.jbl_bar_9_1_calibrate_surround" } });
    expect(text(m.$(".sys-a-cal"))).toContain("Step 1 starting…");
    expect(m.$(".sys-a-cal .spinner")).not.toBeNull();
    expect(m.$$(".sys-a-rear.measuring")).toHaveLength(2);
    // While measuring, the panel keeps the status and the guide but drops the start button that would repeat them.
    expect(btn(m, "system.calibrate")).toBeNull();
    expect(text(m.$(".sys-a-status-text"))).toBe("Step 1 starting…");
    expect(text(m.$(".sys-a-panel"))).toContain("Keep the room quiet until the soundbar finishes");
  });

  it("opens the busy device by itself and explains blocked calibration while docked", async () => {
    const bar = newBar();
    bar.update((b) => (b.subPairing = true));
    const m = await system(bar);
    // Subwoofer pairing in progress: its panel opens with the instructions.
    expect(m.$(".sys-a-panel.sub")).not.toBeNull();
    expect(text(m.$(".sys-a-panel"))).toContain("hold the pairing button on the subwoofer");
    expect(m.$(".sys-a-subdot.busy")).not.toBeNull();
    bar.update((b) => {
      b.subPairing = false;
      b.docked = true;
    });
    await m.sync();
    await open(m, "cal");
    const start = btn(m, "system.calibrate");
    expect(start.getAttribute("aria-disabled")).toBe("true");
    expect(text(m.$(".sys-a-panel"))).toContain("Detach both rear speakers from the soundbar first.");
  });

  it("pairs the subwoofer", async () => {
    const bar = newBar();
    const m = await system(bar);
    await open(m, "sub");
    btn(m, "system.sub_pair").click();
    await settle(m);
    expect(bar.calls.at(-1)).toMatchObject({ service: "press", target: { entity_id: "button.jbl_bar_9_1_pair_subwoofer" } });
    expect(text(m.$(".sys-a-sub"))).toContain("Pairing");
  });

  it("asks before restarting", async () => {
    const bar = newBar();
    const m = await system(bar);
    m.$(".sys-a-restart")!.click();
    await m.card.updateComplete;
    expect(m.$(".dialog h3")?.textContent).toBe("Restart the soundbar?");
    (m.$(".dialog .btn.ghost") as HTMLButtonElement).click();
    await settle(m);
    expect(bar.calls).toHaveLength(0);
    m.$(".sys-a-restart")!.click();
    await m.card.updateComplete;
    (m.$(".dialog .btn.danger") as HTMLButtonElement).click();
    await settle(m);
    expect(bar.calls).toHaveLength(1);
    expect(bar.calls[0]).toMatchObject({ service: "press", target: { entity_id: "button.jbl_bar_9_1_restart" } });
  });
});

describe("System variant A: states", () => {
  it("shows charging rears while docked", async () => {
    const bar = newBar();
    bar.update((b) => (b.docked = true));
    const m = await system(bar);
    const banner = m.$(".sys-a-banner")!;
    expect(banner.classList.contains("charging")).toBe(true);
    expect(banner.getAttribute("role")).toBe("status");
    expect(text(banner)).toContain("The rear speakers are on the soundbar and charging.");
    expect(m.$$(".sys-a-rear")).toHaveLength(0);
    expect(m.$$(".sys-a-batt.charging")).toHaveLength(2);
    // The low rear is charging, so its pill no longer warns (the banner is green too).
    expect(m.$$(".sys-a-batt.low")).toHaveLength(0);
    expect(m.$(".sys-a-map.docked")).not.toBeNull();
  });

  it("opens a battery's more-info from its pill", async () => {
    const m = await system();
    const opened: string[] = [];
    m.card.addEventListener("hass-more-info", (ev) => opened.push((ev as CustomEvent).detail.entityId));
    const pill = m.$(".sys-a-batt.left") as HTMLButtonElement;
    expect(pill.tagName).toBe("BUTTON");
    expect(text(pill)).toContain("Rear left");
    pill.click();
    expect(opened).toEqual(["sensor.jbl_bar_9_1_rear_left_battery"]);
  });

  it("keeps a closed busy panel closed until the device gets busy again", async () => {
    const bar = newBar();
    const m = await system(bar);
    // Opening and closing an idle panel does not stop the next busy device from opening by itself.
    await open(m, "phone");
    (m.$(".sys-a-close") as HTMLButtonElement).click();
    await m.card.updateComplete;
    bar.update((b) => (b.subPairing = true));
    await m.sync();
    expect(m.$(".sys-a-panel.sub")).not.toBeNull();
    // Closing the busy panel keeps it closed while the same device stays busy.
    (m.$(".sys-a-close") as HTMLButtonElement).click();
    await m.card.updateComplete;
    await m.sync();
    expect(m.$(".sys-a-panel")).toBeNull();
    // Once pairing ends and starts again, it opens again.
    bar.update((b) => (b.subPairing = false));
    await m.sync();
    bar.update((b) => (b.subPairing = true));
    await m.sync();
    expect(m.$(".sys-a-panel.sub")).not.toBeNull();
  });

  it("hides the banner when the batteries are fine", async () => {
    const bar = newBar();
    bar.update((b) => (b.batteryLeft = 60));
    const m = await system(bar);
    expect(m.$(".sys-a-banner")).toBeNull();
  });

  it("says why nothing can run while the bar is unreachable", async () => {
    const bar = newBar();
    bar.reachable = false;
    bar.update(() => undefined);
    const m = await system(bar);
    expect(m.$(".sys-a-chip.cpu")?.textContent).toContain("—");
    expect(text(m.$(".sys-a-cal"))).toContain("Unreachable");
    expect(text(m.$(".sys-a-cal"))).not.toContain("—");
    await open(m, "cal");
    expect(btn(m, "system.calibrate").getAttribute("aria-disabled")).toBe("true");
    expect(text(m.$(".sys-a-panel"))).toContain("The soundbar is unreachable.");
    // No "● —" status row: the blocked action already says why.
    expect(m.$(".sys-a-panel .sys-a-status")).toBeNull();
  });

  it("hides every block whose entities are missing", () => {
    const ctx = tabContext(undefined, { layouts: { system: "map" } });
    const host = renderA({
      ...ctx,
      entities: {
        ...ctx.entities,
        calibrate: undefined,
        calibration: undefined,
        subwoofer: undefined,
        sub_pair: undefined,
        restart: undefined,
        bluetooth_device: undefined,
        bluetooth_connected: undefined,
        bluetooth_pairing: undefined,
      },
    });
    expect(host.querySelector(".sys-a-map")).not.toBeNull();
    expect(host.querySelector(".sys-a-cal")).toBeNull();
    expect(host.querySelector(".sys-a-phone")).toBeNull();
    expect(host.querySelector(".sys-a-subpic")).toBeNull();
    expect(host.querySelector(".sys-a-restart")).toBeNull();
    expect(host.querySelector(".sys-a-taphint")).toBeNull();
    expect(host.querySelector(".sys-a-barname")?.textContent).toBe("Soundbar");
  });

  it("says so when the bar reports nothing", () => {
    const ctx = tabContext(undefined, { layouts: { system: "map" } });
    const roles = [
      "rear_battery_left",
      "rear_battery_right",
      "cpu",
      "memory",
      "temperature",
      "wifi_signal",
      "uptime",
      "mode_after_standby",
      "bluetooth_device",
      "bluetooth_connected",
      "bluetooth_pairing",
      "calibrate",
      "calibration",
      "subwoofer",
      "sub_pair",
      "restart",
    ] as const;
    const host = renderA({ ...ctx, entities: { ...ctx.entities, ...Object.fromEntries(roles.map((r) => [r, undefined])) } });
    expect(host.querySelector(".sys-a-map")).toBeNull();
    expect(host.querySelector(".sys-a-metrics")).toBeNull();
    expect(host.textContent).toContain("This soundbar reports no system information.");
  });

  it("is translated in Ukrainian and French", async () => {
    const uk = await system(newBar({ language: "uk" }));
    expect(uk.text()).not.toMatch(/system(_map)?\./);
    expect(uk.text()).toContain("ЦП 23%");
    expect(uk.text()).toContain("Ліва задня: 14%");
    expect(uk.text()).toContain("Перезапустити саундбар…");
    cleanup();
    const fr = await system(newBar({ language: "fr" }));
    expect(fr.text()).not.toMatch(/system(_map)?\./);
    expect(fr.text()).toContain("RAM 41,7 %");
    expect(fr.text()).toContain("Redémarrer la barre de son…");
  });
});
