import { afterEach, describe, expect, it } from "vitest";
import { render } from "lit";
import { calibrationPhase, renderSystemTab, uptimeSeconds, wifiQuality } from "../src/tabs/system";
import type { HassEntity, TabContext } from "../src/types";
import { cleanup, mountCard, newBar, settle, tabContext } from "./helpers";
import type { Mounted } from "./helpers";

afterEach(cleanup);

const system = (config = {}, bar = newBar()): Promise<Mounted> => mountCard({ default_tab: "system", ...config }, bar);

const tileValue = (m: Mounted, key: string): string | undefined =>
  m.$(`.sys-tile.${key} .tile-value`)?.textContent?.replace(/\s+/g, " ").trim();

const button = (m: Mounted, section: string): HTMLButtonElement => m.$(`.${section} .sys-actions .btn`) as HTMLButtonElement;

const sectionText = (m: Mounted, section: string): string => (m.$(`.${section}`)?.textContent ?? "").replace(/\s+/g, " ").trim();

function renderTab(ctx: TabContext): HTMLElement {
  const host = document.createElement("div");
  render(renderSystemTab(ctx), host);
  return host;
}

describe("System tab: status tiles", () => {
  it("shows CPU, memory, temperature, Wi-Fi, uptime and the mode after standby", async () => {
    const m = await system();
    expect(tileValue(m, "cpu")).toBe("23%");
    expect(tileValue(m, "memory")).toBe("41.7%");
    expect(tileValue(m, "temperature")).toBe("52 °C");
    expect(tileValue(m, "wifi")).toBe("-58 dBm");
    expect(m.$(".sys-tile.wifi .tile-sub")?.textContent).toBe("Good");
    // 186420 s = 2 d 3 h 47 min
    expect(tileValue(m, "uptime")).toBe("2 d 3 h");
    expect(tileValue(m, "mode_after_standby")).toBe("Smart");
    expect(m.$(".sys-details")).toBeNull();
  });

  it("opens more-info from a tile", async () => {
    const m = await system();
    let opened: string | undefined;
    m.card.addEventListener("hass-more-info", (ev) => (opened = (ev as CustomEvent).detail.entityId));
    m.$(".sys-tile.cpu")!.click();
    expect(opened).toBe("sensor.jbl_bar_9_1_cpu");
  });

  it("explains how to enable Wi-Fi signal and uptime when HA left them out", async () => {
    const bar = newBar();
    delete bar.entities["sensor.jbl_bar_9_1_wi_fi_signal"];
    delete bar.entities["sensor.jbl_bar_9_1_uptime"];
    const m = await system({}, bar);
    expect(m.$(".sys-tile.wifi")).toBeNull();
    expect(m.$(".sys-tile.uptime")).toBeNull();
    expect(m.$(".sys-details summary")?.textContent).toBe("Wi-Fi signal, Uptime: turned off in Home Assistant");
    expect(m.$(".sys-details")?.textContent).toContain("Settings → Devices & services → JBL Bar 9.1");
  });

  it("shows unavailable sensors as a dash", async () => {
    const bar = newBar();
    bar.reachable = false;
    bar.update(() => undefined);
    const m = await system({}, bar);
    expect(tileValue(m, "cpu")).toBe("—");
  });
});

describe("System tab: low rear battery", () => {
  it("warns about the low speaker with its level and how to fix it", async () => {
    const m = await system();
    const alert = m.$(".sys-alert")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("Rear speaker battery low");
    expect(alert.textContent).toContain("Rear left: 14%");
    expect(alert.textContent).not.toContain("Rear right");
    expect(alert.textContent).toContain("Put both rear speakers back on the ends of the soundbar");
  });

  it("says they are charging while docked, and hides the warning when both are fine", async () => {
    const bar = newBar();
    const m = await system({}, bar);
    bar.update((b) => (b.docked = true));
    await m.sync();
    expect(m.$(".sys-alert")?.classList.contains("charging")).toBe(true);
    expect(m.$(".sys-alert")?.textContent).toContain("charging");
    bar.update((b) => {
      b.batteryLeft = 20;
      b.batteryRight = 90;
    });
    await m.sync();
    expect(m.$(".sys-alert")).toBeNull();
  });
});

describe("System tab: Bluetooth", () => {
  it("shows the connected device and starts pairing", async () => {
    const m = await system();
    const text = sectionText(m, "bluetooth");
    expect(text).toContain("Pixel 9");
    expect(text).toContain("Streaming");
    expect(m.$(".bluetooth .badge.ok")?.textContent).toBe("Connected");
    const pair = button(m, "bluetooth");
    expect(pair.disabled).toBe(false);
    pair.click();
    await m.card.updateComplete;
    expect(button(m, "bluetooth").classList.contains("pending")).toBe(true);
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({
      domain: "button",
      service: "press",
      target: { entity_id: "button.jbl_bar_9_1_bluetooth_pairing" },
    });
    expect(sectionText(m, "bluetooth")).toContain("The soundbar is ready to pair.");
  });

  it("needs Bluetooth as the source and offers to switch", async () => {
    const bar = newBar();
    bar.update((b) => {
      b.source = "TV";
      b.btConnected = false;
    });
    const m = await system({}, bar);
    expect(sectionText(m, "bluetooth")).toContain("No device connected");
    expect(m.$(".bluetooth .badge")?.textContent).toBe("Not connected");
    expect(button(m, "bluetooth").disabled).toBe(true);
    expect(sectionText(m, "bluetooth")).toContain("Pairing works only while Bluetooth is the source.");
    const switchBtn = m.$$(".bluetooth .sys-actions .btn")[1];
    expect(switchBtn.textContent?.trim()).toBe("Switch to Bluetooth");
    switchBtn.click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "select_source", data: { source: "Bluetooth" } });
    expect(button(m, "bluetooth").disabled).toBe(false);
    expect(m.$$(".bluetooth .sys-actions .btn")).toHaveLength(1);
  });
});

describe("System tab: surround calibration", () => {
  it("starts the next step and follows the bar through it", async () => {
    const bar = newBar();
    const m = await system({}, bar);
    expect(m.$(".calibration .cal-status")?.textContent?.trim()).toBe("Not running");
    expect(button(m, "calibration").textContent?.trim()).toBe("Start calibration");
    expect(sectionText(m, "calibration")).toContain("Step 1: put both rear speakers near your listening position");
    button(m, "calibration").click();
    await settle(m);
    expect(bar.calls.at(-1)).toMatchObject({
      service: "press",
      target: { entity_id: "button.jbl_bar_9_1_calibrate_surround" },
    });
    expect(m.$(".calibration .cal-status")?.textContent?.trim()).toBe("Step 1 starting…");
    expect(m.$(".calibration .cal-status.info .spinner")).not.toBeNull();
    expect(button(m, "calibration").disabled).toBe(true);
    expect(button(m, "calibration").textContent?.trim()).toBe("Measuring…");

    bar.update((b) => (b.calibration = "Step 1 done"));
    await m.sync();
    expect(m.$(".calibration .cal-status.ok")?.textContent?.trim()).toBe("Step 1 done");
    // The display goes back to idle after a few seconds: the card remembers step 1.
    bar.update((b) => (b.calibration = "Idle"));
    await m.sync();
    expect(button(m, "calibration").textContent?.trim()).toBe("Start step 2");
    expect(sectionText(m, "calibration")).toContain("Step 2: put the rear speakers where they will stay");

    bar.update((b) => (b.calibration = "Step 2 done"));
    await m.sync();
    expect(m.$(".calibration .cal-status")?.textContent?.trim()).toBe("Calibration done");
    expect(button(m, "calibration").textContent?.trim()).toBe("Start calibration");
  });

  it("explains why it cannot start: docked rears, standby, subwoofer pairing", async () => {
    const bar = newBar();
    bar.update((b) => (b.docked = true));
    const m = await system({}, bar);
    expect(button(m, "calibration").disabled).toBe(true);
    expect(sectionText(m, "calibration")).toContain("Detach both rear speakers from the soundbar first.");

    bar.update((b) => {
      b.docked = false;
      b.subPairing = true;
    });
    await m.sync();
    expect(sectionText(m, "calibration")).toContain("Wait until subwoofer pairing ends.");

    bar.update((b) => {
      b.subPairing = false;
      b.power = "Standby";
    });
    await m.sync();
    expect(button(m, "calibration").disabled).toBe(true);
    expect(sectionText(m, "calibration")).toContain("Turn the soundbar on first.");
  });

  it("shows a failed step with a retry button", async () => {
    const bar = newBar();
    bar.update((b) => (b.calibration = "Failed, retry"));
    const m = await system({}, bar);
    expect(m.$(".calibration .cal-status.err")?.textContent?.trim()).toBe("Failed");
    expect(button(m, "calibration").textContent?.trim()).toBe("Try again");
  });
});

describe("System tab: subwoofer", () => {
  it("shows the status and starts pairing with instructions", async () => {
    const bar = newBar();
    const m = await system({}, bar);
    // The remote reports the subwoofer only while the display shows a subwoofer message.
    expect(m.$(".subwoofer .sub-status")?.textContent?.trim()).toBe("No recent status");
    bar.update((b) => (b.subStatus = "Connected"));
    await m.sync();
    expect(m.$(".subwoofer .sub-status.ok")?.textContent?.trim()).toBe("Connected");
    button(m, "subwoofer").click();
    await settle(m);
    expect(bar.calls.at(-1)).toMatchObject({ service: "press", target: { entity_id: "button.jbl_bar_9_1_pair_subwoofer" } });
    expect(m.$(".subwoofer .sub-status.info")?.textContent?.trim()).toBe("Pairing");
    expect(button(m, "subwoofer").disabled).toBe(true);
    expect(sectionText(m, "subwoofer")).toContain("hold the pairing button on the subwoofer");
  });

  it("waits for a running calibration", async () => {
    const bar = newBar();
    bar.update((b) => (b.calibration = "Measuring"));
    const m = await system({}, bar);
    expect(button(m, "subwoofer").disabled).toBe(true);
    expect(sectionText(m, "subwoofer")).toContain("Wait until the calibration ends.");
  });
});

describe("System tab: restart", () => {
  it("asks in the card before restarting, and sends nothing on cancel", async () => {
    const bar = newBar();
    const m = await system({}, bar);
    button(m, "restart").click();
    await m.card.updateComplete;
    expect(m.$(".dialog h3")?.textContent).toBe("Restart the soundbar?");
    expect(m.$(".dialog p")?.textContent).toContain("Home Assistant cannot reach it");
    (m.$(".dialog .btn.ghost") as HTMLButtonElement).click();
    await settle(m);
    expect(m.$(".dialog")).toBeNull();
    expect(bar.calls).toHaveLength(0);

    button(m, "restart").click();
    await m.card.updateComplete;
    const confirm = m.$(".dialog .btn.danger") as HTMLButtonElement;
    expect(confirm.textContent?.trim()).toBe("Restart");
    confirm.click();
    await settle(m);
    expect(bar.calls).toHaveLength(1);
    expect(bar.calls[0]).toMatchObject({ domain: "button", service: "press", target: { entity_id: "button.jbl_bar_9_1_restart" } });
  });
});

describe("System tab: missing entities and languages", () => {
  it("hides every block whose entity is missing", () => {
    const ctx = tabContext();
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
      },
    });
    expect(host.querySelector(".calibration")).toBeNull();
    expect(host.querySelector(".subwoofer")).toBeNull();
    expect(host.querySelector(".restart")).toBeNull();
    expect(host.querySelector(".bluetooth .sys-actions")).toBeNull();
    expect(host.querySelector(".bluetooth")).not.toBeNull();
  });

  it("says so when the bar reports nothing", () => {
    const ctx = tabContext();
    const host = renderTab({ ...ctx, entities: { ...ctx.entities, ...emptyRoles() } });
    expect(host.textContent).toContain("This soundbar reports no system information.");
  });

  it("is fully translated in Ukrainian and French", async () => {
    const uk = await system({}, newBar({ language: "uk" }));
    expect(uk.text()).not.toMatch(/system\./);
    expect(uk.text()).toContain("Процесор");
    expect(uk.text()).toContain("Тилова ліва: 14%");
    expect(uk.text()).toContain("Перезапустити саундбар");
    cleanup();
    const fr = await system({}, newBar({ language: "fr" }));
    expect(fr.text()).not.toMatch(/system\./);
    expect(fr.text()).toContain("Arrière gauche : 14 %");
    expect(fr.text()).toContain("Mémoire");
    expect(fr.$(".sys-tile.memory .tile-value")?.textContent).toBe("41,7 %");
  });
});

describe("System tab helpers", () => {
  it("reads every calibration phase", () => {
    expect(calibrationPhase("Idle").kind).toBe("idle");
    expect(calibrationPhase("Step 2 starting")).toMatchObject({ kind: "running", vars: { step: "2" } });
    expect(calibrationPhase("Starting in 3")).toMatchObject({ kind: "running", vars: { seconds: "3" } });
    expect(calibrationPhase("Measuring").kind).toBe("running");
    expect(calibrationPhase("Step 1 done").kind).toBe("done1");
    expect(calibrationPhase("Step 2 done").kind).toBe("done2");
    expect(calibrationPhase("Failed, retry").kind).toBe("failed");
    expect(calibrationPhase("Cancelled").kind).toBe("cancelled");
    expect(calibrationPhase("unknown").kind).toBe("unknown");
    expect(calibrationPhase("Something new").kind).toBe("other");
  });

  it("converts uptime units and grades Wi-Fi", () => {
    const st = (state: string, unit?: string): HassEntity => ({
      entity_id: "sensor.x",
      state,
      attributes: unit ? { unit_of_measurement: unit } : {},
      last_changed: "",
      last_updated: "",
    });
    expect(uptimeSeconds(st("90"))).toBe(90);
    expect(uptimeSeconds(st("2.5", "h"))).toBe(9000);
    expect(uptimeSeconds(st("1", "d"))).toBe(86400);
    expect(uptimeSeconds(st("unavailable"))).toBeUndefined();
    expect(wifiQuality(-50)).toBe("excellent");
    expect(wifiQuality(-60)).toBe("good");
    expect(wifiQuality(-72)).toBe("fair");
    expect(wifiQuality(-80)).toBe("weak");
  });
});

/** Every role this tab reads, set to undefined. */
function emptyRoles(): Partial<TabContext["entities"]> {
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
  return Object.fromEntries(roles.map((role) => [role, undefined]));
}
