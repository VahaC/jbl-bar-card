// tests for System tab layout variant B ("Compact list").
import { afterEach, describe, expect, it } from "vitest";
import { render } from "lit";
import { renderSystemList } from "../src/tabs/system-layouts/list";
import { systemModel } from "../src/tabs/system-model";
import type { TabContext } from "../src/types";
import { cleanup, mountCard, newBar, settle, tabContext } from "./helpers";
import type { Mounted } from "./helpers";

afterEach(cleanup);

const system = (bar = newBar()): Promise<Mounted> => mountCard({ default_tab: "system", layouts: { system: "list" } }, bar);
const rowText = (m: Mounted, cls: string): string => (m.$(`.sys-b .${cls}`)?.textContent ?? "").replace(/\s+/g, " ").trim();
const pill = (m: Mounted, cls: string): HTMLButtonElement | null => m.$(`.sys-b .${cls} .sys-b-pill`) as HTMLButtonElement | null;

function renderB(ctx: TabContext): HTMLElement {
  const host = document.createElement("div");
  render(renderSystemList(ctx, systemModel(ctx)), host);
  return host;
}

describe("System variant B: layout", () => {
  it("shows three ring gauges and one list with every row, restart last", async () => {
    const m = await system();
    const gauges = m.$$(".sys-b-gauge");
    expect(gauges.map((g) => g.getAttribute("aria-label"))).toEqual(["CPU: 23%", "Memory: 41.7%", "Temperature: 52 °C"]);
    expect(m.$(".sys-b-gauge.cpu .sys-b-arc")?.getAttribute("stroke-dasharray")).toBe("23 100");
    const rows = m.$$(".sys-b-list > .sys-b-row").map((r) => Array.from(r.classList).find((c) => c !== "sys-b-row" && c !== "sys-b-link"));
    expect(rows).toEqual(["sys-b-battery", "sys-b-bt", "sys-b-cal", "sys-b-woofer", "sys-b-wifi", "sys-b-uptime", "sys-b-standby", "sys-b-restart"]);
    expect(rowText(m, "sys-b-wifi")).toContain("-58 dBm");
    expect(rowText(m, "sys-b-wifi")).toContain("Good");
    expect(rowText(m, "sys-b-uptime")).toContain("2 d 3 h");
    expect(rowText(m, "sys-b-standby")).toContain("Smart");
    // The old "Status → Not running" row is gone: the guide says what to do instead.
    expect(rowText(m, "sys-b-cal")).not.toContain("Not running");
    expect(rowText(m, "sys-b-cal")).toContain("Step 1: put both rear speakers near your listening position");
    expect(m.$(".sys-b-hidden")).toBeNull();
  });

  it("opens more-info from a gauge and from a diagnostic row", async () => {
    const m = await system();
    const opened: string[] = [];
    m.card.addEventListener("hass-more-info", (ev) => opened.push((ev as CustomEvent).detail.entityId));
    m.$(".sys-b-gauge.memory")!.click();
    m.$(".sys-b-wifi")!.click();
    expect(opened).toEqual(["sensor.jbl_bar_9_1_memory_used", "sensor.jbl_bar_9_1_wi_fi_signal"]);
  });

  it("puts the disabled diagnostics in one muted row that expands to the how-to", async () => {
    const bar = newBar();
    delete bar.entities["sensor.jbl_bar_9_1_wi_fi_signal"];
    delete bar.entities["sensor.jbl_bar_9_1_uptime"];
    const m = await system(bar);
    expect(m.$(".sys-b-wifi")).toBeNull();
    expect(m.$(".sys-b-uptime")).toBeNull();
    expect(m.$(".sys-b-hidden summary")?.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Wi-Fi signal, Uptime: turned off in Home Assistant",
    );
    expect(m.$(".sys-b-hidden .sys-b-note")?.textContent).toContain("Settings → Devices & services → JBL Bar 9.1");
  });

  it("keeps working when the bar is unreachable", async () => {
    const bar = newBar();
    bar.reachable = false;
    bar.update(() => undefined);
    const m = await system(bar);
    expect(m.$(".sys-b-gauge.cpu")?.getAttribute("aria-label")).toBe("CPU: —");
    expect(m.$(".sys-b-gauge.cpu .sys-b-arc")).toBeNull();
    expect(m.$$(".sys-b-pill")).toHaveLength(0);
    // One muted row says why, instead of "Not available right now." under every row.
    const first = m.$(".sys-b-list > .sys-b-row")!;
    expect(first.classList.contains("sys-b-offline")).toBe(true);
    expect(first.getAttribute("role")).toBe("status");
    expect(rowText(m, "sys-b-offline")).toContain("Soundbar offline");
    expect(m.text()).not.toContain("Not available right now.");
    expect(m.$$(".sys-b-list .sys-b-note")).toHaveLength(0);
  });

  it("shows no offline row while the bar is reachable", async () => {
    const m = await system();
    expect(m.$(".sys-b-offline")).toBeNull();
  });
});

describe("System variant B: low battery", () => {
  it("is the first row with the level and the advice", async () => {
    const m = await system();
    const row = m.$(".sys-b-list > .sys-b-row")!;
    expect(row.classList.contains("sys-b-battery")).toBe(true);
    expect(row.getAttribute("role")).toBe("alert");
    expect(row.textContent).toContain("Rear speaker battery low");
    expect(row.textContent).toContain("Rear left: 14%");
    expect(row.textContent).not.toContain("Rear right");
    expect(row.textContent).toContain("Put both rear speakers back on the ends of the soundbar");
  });

  it("turns into a charging status while docked and disappears when charged", async () => {
    const bar = newBar();
    const m = await system(bar);
    bar.update((b) => (b.docked = true));
    await m.sync();
    expect(m.$(".sys-b-battery")?.classList.contains("charging")).toBe(true);
    expect(m.$(".sys-b-battery")?.getAttribute("role")).toBe("status");
    expect(m.$(".sys-b-battery .sys-b-title")?.textContent).toBe("Rear speakers charging");
    expect(rowText(m, "sys-b-battery")).toContain("on the soundbar and charging");
    bar.update((b) => {
      b.batteryLeft = 20;
      b.batteryRight = 90;
    });
    await m.sync();
    expect(m.$(".sys-b-battery")).toBeNull();
  });
});

describe("System variant B: actions", () => {
  it("pairs Bluetooth from the row pill and shows the pairing hint", async () => {
    const m = await system();
    expect(m.$$(".sys-b-bt .sys-b-seg").map((s) => s.textContent)).toEqual(["Connected", "Pixel 9", "Streaming"]);
    const pair = pill(m, "sys-b-bt")!;
    expect(pair.textContent?.trim()).toBe("Add");
    expect(pair.getAttribute("aria-label")).toBe("Pair a device");
    pair.click();
    await m.card.updateComplete;
    expect(m.$(".sys-b-bt .spinner")).not.toBeNull();
    expect(pill(m, "sys-b-bt")).toBeNull();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({
      domain: "button",
      service: "press",
      target: { entity_id: "button.jbl_bar_9_1_bluetooth_pairing" },
    });
    expect(rowText(m, "sys-b-bt")).toContain("The soundbar is ready to pair.");
  });

  it("shows why Bluetooth pairing cannot run and offers the source switch instead", async () => {
    const bar = newBar();
    bar.update((b) => {
      b.source = "TV";
      b.btConnected = false;
    });
    const m = await system(bar);
    expect(rowText(m, "sys-b-bt")).toContain("No device connected");
    expect(rowText(m, "sys-b-bt")).toContain("Pairing works only while Bluetooth is the source.");
    const sw = pill(m, "sys-b-bt")!;
    expect(sw.getAttribute("aria-label")).toBe("Switch to Bluetooth");
    expect(sw.textContent?.trim()).toBe("Use BT");
    sw.click();
    await settle(m);
    expect(bar.calls.at(-1)).toMatchObject({ service: "select_source", data: { source: "Bluetooth" } });
    expect(pill(m, "sys-b-bt")?.getAttribute("aria-label")).toBe("Pair a device");
  });

  it("starts calibration, shows progress, then offers step 2", async () => {
    const bar = newBar();
    const m = await system(bar);
    const start = pill(m, "sys-b-cal")!;
    expect(start.textContent?.trim()).toBe("Start");
    start.click();
    await settle(m);
    expect(bar.calls.at(-1)).toMatchObject({ service: "press", target: { entity_id: "button.jbl_bar_9_1_calibrate_surround" } });
    expect(rowText(m, "sys-b-cal")).toContain("Step 1 starting…");
    expect(rowText(m, "sys-b-cal")).toContain("Keep the room quiet");
    expect(m.$(".sys-b-cal .spinner")).not.toBeNull();
    expect(pill(m, "sys-b-cal")).toBeNull();

    bar.update((b) => (b.calibration = "Step 1 done"));
    await m.sync();
    bar.update((b) => (b.calibration = "Idle"));
    await m.sync();
    expect(pill(m, "sys-b-cal")?.textContent?.trim()).toBe("Step 2");
    expect(rowText(m, "sys-b-cal")).toContain("Step 2: put the rear speakers where they will stay");
  });

  it("always shows a calibration state it does not recognise, even next to the guide", async () => {
    const bar = newBar();
    bar.update((b) => (b.calibration = "Something new"));
    const m = await system(bar);
    expect(m.$(".sys-b-cal .sys-b-sub")?.textContent).toContain("Something new");
    expect(m.$(".sys-b-cal .sys-b-note")?.textContent).toContain("Step 1:");
  });

  it("shows the reason instead of a button when calibration cannot start", async () => {
    const bar = newBar();
    bar.update((b) => (b.docked = true));
    const m = await system(bar);
    expect(pill(m, "sys-b-cal")).toBeNull();
    expect(m.$(".sys-b-cal button")).toBeNull();
    expect(m.$(".sys-b-cal .sys-b-note")?.textContent).toBe("Detach both rear speakers from the soundbar first.");

    bar.update((b) => {
      b.docked = false;
      b.power = "Standby";
    });
    await m.sync();
    expect(m.$(".sys-b-cal .sys-b-note")?.textContent).toBe("Turn the soundbar on first.");
  });

  it("pairs the subwoofer and shows the hint while it pairs; waits for calibration", async () => {
    const bar = newBar();
    const m = await system(bar);
    pill(m, "sys-b-woofer")!.click();
    await settle(m);
    expect(bar.calls.at(-1)).toMatchObject({ service: "press", target: { entity_id: "button.jbl_bar_9_1_pair_subwoofer" } });
    expect(rowText(m, "sys-b-woofer")).toContain("Pairing");
    expect(rowText(m, "sys-b-woofer")).toContain("hold the pairing button on the subwoofer");
    expect(m.$(".sys-b-woofer .spinner")).not.toBeNull();
    cleanup();

    const bar2 = newBar();
    bar2.update((b) => (b.calibration = "Measuring"));
    const m2 = await system(bar2);
    expect(pill(m2, "sys-b-woofer")).toBeNull();
    expect(rowText(m2, "sys-b-woofer")).toContain("Wait until the calibration ends.");
  });

  it("asks before restarting and sends nothing on cancel", async () => {
    const bar = newBar();
    const m = await system(bar);
    const restart = m.$(".sys-b-restart") as HTMLButtonElement;
    expect(restart.tagName).toBe("BUTTON");
    expect(restart.textContent).toContain("Restart soundbar");
    expect(restart.textContent).toContain("Use this when the soundbar stops responding.");
    restart.click();
    await m.card.updateComplete;
    expect(m.$(".dialog h3")?.textContent).toBe("Restart the soundbar?");
    (m.$(".dialog .btn.ghost") as HTMLButtonElement).click();
    await settle(m);
    expect(bar.calls).toHaveLength(0);

    (m.$(".sys-b-restart") as HTMLButtonElement).click();
    await m.card.updateComplete;
    (m.$(".dialog .btn.danger") as HTMLButtonElement).click();
    await settle(m);
    expect(bar.calls).toHaveLength(1);
    expect(bar.calls[0]).toMatchObject({ service: "press", target: { entity_id: "button.jbl_bar_9_1_restart" } });
  });
});

describe("System variant B: accessibility and layout details", () => {
  it("names the restart row by its label and describes it by the hint", async () => {
    const m = await system();
    const restart = m.$(".sys-b-restart")!;
    expect(restart.getAttribute("aria-label")).toBe("Restart soundbar");
    const hintId = restart.getAttribute("aria-describedby")!;
    expect(m.$(`#${hintId}`)?.textContent).toBe("Use this when the soundbar stops responding.");
  });

  it("keeps live regions out of alert rows and control rows", async () => {
    const m = await system();
    expect(m.$(".sys-b-battery")?.getAttribute("role")).toBe("alert");
    expect(m.$$(".sys-b-battery [aria-live]")).toHaveLength(0);
    expect(m.$$("button.sys-b-row [aria-live]")).toHaveLength(0);
    expect(m.$(".sys-b-bt .sys-b-sub")?.getAttribute("aria-live")).toBe("polite");
  });

  it("renders the status as separate segments under the title, not beside the pill", async () => {
    const m = await system();
    expect(m.$$(".sys-b-bt .sys-b-seg").map((s) => s.textContent)).toEqual(["Connected", "Pixel 9", "Streaming"]);
    expect(m.$(".sys-b-bt .sys-b-below .sys-b-sub")).not.toBeNull();
    expect(m.$(".sys-b-bt .sys-b-trail .sys-b-sub")).toBeNull();
  });
});

describe("System variant B: missing entities and languages", () => {
  it("hides every row whose entity is missing", () => {
    const ctx = tabContext(undefined, { layouts: { system: "list" } });
    const host = renderB({
      ...ctx,
      entities: {
        ...ctx.entities,
        calibrate: undefined,
        calibration: undefined,
        subwoofer: undefined,
        sub_pair: undefined,
        restart: undefined,
        bluetooth_pairing: undefined,
        temperature: undefined,
        rear_battery_left: undefined,
        rear_battery_right: undefined,
      },
    });
    expect(host.querySelector(".sys-b-cal")).toBeNull();
    expect(host.querySelector(".sys-b-woofer")).toBeNull();
    expect(host.querySelector(".sys-b-restart")).toBeNull();
    expect(host.querySelector(".sys-b-battery")).toBeNull();
    expect(host.querySelector(".sys-b-bt .sys-b-pill")).toBeNull();
    expect(host.querySelector(".sys-b-bt")).not.toBeNull();
    expect(host.querySelectorAll(".sys-b-gauge")).toHaveLength(2);
  });

  it("shows only the empty note when the bar reports nothing", () => {
    const ctx = tabContext(undefined, { layouts: { system: "list" } });
    const roles = [
      "rear_battery_left", "rear_battery_right", "cpu", "memory", "temperature", "wifi_signal", "uptime",
      "mode_after_standby", "bluetooth_device", "bluetooth_connected", "bluetooth_pairing", "calibrate",
      "calibration", "subwoofer", "sub_pair", "restart",
    ];
    const host = renderB({ ...ctx, entities: { ...ctx.entities, ...Object.fromEntries(roles.map((r) => [r, undefined])) } });
    expect(host.querySelector(".sys-b-list")).toBeNull();
    expect(host.querySelector(".sys-b-gauges")).toBeNull();
    expect(host.textContent).toContain("This soundbar reports no system information.");
  });

  it("is fully translated in Ukrainian and French", async () => {
    const uk = await system(newBar({ language: "uk" }));
    expect(uk.text()).not.toMatch(/system(_list)?\./);
    expect(uk.$(".sys-b-battery .sys-b-sub")?.textContent).toMatch(/14\s?%/);
    expect(pill(uk, "sys-b-bt")?.textContent?.trim()).toBe("Додати");
    expect(pill(uk, "sys-b-woofer")?.textContent?.trim()).toBe("Сполучити");
    expect(pill(uk, "sys-b-cal")?.textContent?.trim()).toBe("Почати");
    expect(uk.text()).toContain("Перезапустити саундбар");
    cleanup();
    const fr = await system(newBar({ language: "fr" }));
    expect(fr.text()).not.toMatch(/system(_list)?\./);
    expect(pill(fr, "sys-b-woofer")?.textContent?.trim()).toBe("Appairer");
    expect(pill(fr, "sys-b-bt")?.textContent?.trim()).toBe("Ajouter");
    expect(fr.$(".sys-b-gauge.memory")?.getAttribute("aria-label")?.replace(/\s/g, " ")).toBe("Mémoire: 41,7 %");
  });
});
