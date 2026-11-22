import { afterEach, describe, expect, it } from "vitest";
import { calibrationPhase, uptimeSeconds, wifiQuality } from "../src/tabs/system";
import { systemModel } from "../src/tabs/system-model";
import type { HassEntity } from "../src/types";
import { cleanup, mountCard, newBar, tabContext } from "./helpers";

afterEach(cleanup);

describe("System tab layouts", () => {
  it("uses the list layout by default and the configured one otherwise", async () => {
    const byDefault = await mountCard({ default_tab: "system" });
    expect(byDefault.$(".sys-b")).not.toBeNull();
    cleanup();
    const map = await mountCard({ default_tab: "system", layouts: { system: "map" } });
    expect(map.$(".sys-a")).not.toBeNull();
    expect(map.$(".sys-b")).toBeNull();
    cleanup();
    const health = await mountCard({ default_tab: "system", layouts: { system: "health" } });
    expect(health.$(".sys-c")).not.toBeNull();
  });
});

describe("System model", () => {
  it("collects the metrics with gauge ratios and tones", () => {
    const model = systemModel(tabContext());
    const keys = model.metrics.map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(["cpu", "memory", "temperature"]));
    for (const m of model.metrics.filter((x) => x.key === "cpu" || x.key === "memory")) {
      expect(m.ratio).toBeGreaterThanOrEqual(0);
      expect(m.ratio).toBeLessThanOrEqual(1);
      expect(["ok", "warn", "err"]).toContain(m.tone);
    }
  });

  it("flags a low rear battery with advice, as an issue", () => {
    const model = systemModel(tabContext());
    expect(model.lowBatteries.map((b) => b.side)).toEqual(["left"]);
    expect(model.batteryAdvice).toMatch(/charge/i);
    expect(model.issues[0]?.text).toContain("14%");
  });

  it("explains why Bluetooth pairing cannot start away from the Bluetooth source", () => {
    const bar = newBar();
    bar.update((b) => (b.source = "TV"));
    const bt = systemModel(tabContext(bar)).bluetooth!;
    expect(bt.pair?.enabled).toBe(false);
    expect(bt.pair?.reason).toBeTruthy();
    expect(bt.switchSource?.enabled).toBe(true);
  });

  it("needs undocked rears before calibrating", () => {
    const bar = newBar();
    bar.update((b) => (b.docked = true));
    const cal = systemModel(tabContext(bar)).calibration!;
    expect(cal.start?.enabled).toBe(false);
    expect(cal.start?.reason).toMatch(/undock|detach/i);
  });

  it("marks restart as destructive", () => {
    const restart = systemModel(tabContext()).restart!;
    expect(restart.danger).toBe(true);
    expect(restart.enabled).toBe(true);
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
