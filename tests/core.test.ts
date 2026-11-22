import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../src/config";
import { cleanConfig } from "../src/editor";
import { formatDuration, numericState } from "../src/format";
import { PendingRegistry } from "../src/pending";
import { isBlankState, numAttr, selectOptions, textAttr } from "../src/state";
import { JblBarCard } from "../src/jbl-bar-card";
import type { HassEntity, HomeAssistant } from "../src/types";
import { MEDIA_PLAYER } from "../demo/mock-hass";
import { newBar } from "./helpers";

describe("config", () => {
  it("fills defaults", () => {
    expect(normalizeConfig({ type: "custom:jbl-bar-card" })).toEqual({
      type: "custom:jbl-bar-card",
      entity: undefined,
      name: undefined,
      tabs: ["home", "sound", "timers", "system"],
      default_tab: "home",
      compact: false,
      recent: false,
      layouts: { home: "classic", sound: "classic", timers: "classic", system: "list" },
    });
  });

  it("takes a layout per tab and refuses unknown ones", () => {
    const c = normalizeConfig({ type: "x", layouts: { sound: "mixer", system: "health" } });
    expect(c.layouts).toEqual({ home: "classic", sound: "mixer", timers: "classic", system: "health" });
    expect(() => normalizeConfig({ type: "x", layouts: { sound: "disco" } })).toThrow(/disco.*sound.*classic, mixer, cards/);
    expect(() => normalizeConfig({ type: "x", layouts: { kitchen: "x" } as never })).toThrow(/kitchen/);
    expect(() => normalizeConfig({ type: "x", layouts: ["mixer"] as never })).toThrow(/layouts/);
  });

  it("keeps the card's tab order and a valid default tab", () => {
    const c = normalizeConfig({ type: "x", tabs: ["system", "home", "system"], default_tab: "sound" });
    expect(c.tabs).toEqual(["home", "system"]);
    expect(c.default_tab).toBe("home");
  });

  it("rejects wrong values with a message that says how to fix them", () => {
    expect(() => normalizeConfig({ type: "x", entity: "switch.tv" })).toThrow(/media_player\.jbl_bar_9_1/);
    expect(() => normalizeConfig({ type: "x", tabs: ["eq" as never] })).toThrow(/Allowed: home, sound, timers, system/);
  });

  it("cleans editor output", () => {
    expect(
      cleanConfig({ type: "x", entity: MEDIA_PLAYER, name: "", compact: false, tabs: ["home", "sound", "timers", "system"] }),
    ).toEqual({ type: "x", entity: MEDIA_PLAYER });
    expect(cleanConfig({ type: "x", tabs: ["system", "home"] })).toEqual({ type: "x", tabs: ["home", "system"] });
  });

  it("offers a stub config with the first bar", () => {
    expect(JblBarCard.getStubConfig(newBar().hass())).toEqual({ entity: MEDIA_PLAYER });
    expect(JblBarCard.getStubConfig()).toEqual({});
  });
});

describe("PendingRegistry", () => {
  const hass = (state: string) => ({ states: { "x.y": { state } } }) as unknown as HomeAssistant;

  it("stays pending until the state confirms", () => {
    const p = new PendingRegistry();
    p.start("k", 5);
    expect(p.isPending("k")).toBe(true);
    expect(p.value("k")).toBe(5);
    const deadline = p.finish("k", true, hass("old"), (h) => h.states["x.y"].state === "new", 1000, 0);
    expect(deadline).toBe(1000);
    expect(p.isPending("k")).toBe(true);
    expect(p.refresh(hass("old"), 10)).toBe(false);
    expect(p.refresh(hass("new"), 20)).toBe(true);
    expect(p.isPending("k")).toBe(false);
  });

  it("gives up after the timeout and clears on error", () => {
    const p = new PendingRegistry();
    p.start("k", 1);
    p.finish("k", true, hass("old"), () => false, 1000, 0);
    expect(p.refresh(hass("old"), 1001)).toBe(true);
    p.start("e", 1);
    p.finish("e", false, hass("old"), () => false);
    expect(p.isPending("e")).toBe(false);
  });

  it("waits for every call of the same key", () => {
    const p = new PendingRegistry();
    p.start("v", 15);
    p.start("v", 16);
    p.finish("v", true, hass("x"), undefined);
    expect(p.isPending("v")).toBe(true);
    expect(p.value("v")).toBe(16);
    p.finish("v", true, hass("x"), undefined);
    expect(p.isPending("v")).toBe(false);
  });
});

describe("format", () => {
  it("formats countdowns and numeric states", () => {
    expect(formatDuration(7)).toBe("0:07");
    expect(formatDuration(425)).toBe("7:05");
    expect(formatDuration(3930)).toBe("1:05:30");
    expect(numericState("14")).toBe(14);
    expect(numericState("unavailable")).toBeUndefined();
  });
});

describe("state helpers", () => {
  const st = (state: string, attributes: Record<string, unknown> = {}): HassEntity => ({
    entity_id: "select.x",
    state,
    attributes,
    last_changed: "",
    last_updated: "",
  });

  it("treats missing, empty, unknown and unavailable as blank", () => {
    for (const blank of [undefined, "", "unknown", "unavailable"]) expect(isBlankState(blank)).toBe(true);
    expect(isBlankState("0")).toBe(false);
    expect(isBlankState("off")).toBe(false);
  });

  it("reads attributes with fallbacks", () => {
    const entity = st("3", { min: -6, step: "x", error: "  ", status: "active", options: ["a", 1, "b"] });
    expect(numAttr(entity, "min", 0)).toBe(-6);
    expect(numAttr(entity, "step", 0.5)).toBe(0.5);
    expect(textAttr(entity, "error")).toBeUndefined();
    expect(textAttr(entity, "status")).toBe("active");
    expect(selectOptions(entity, ["z"])).toEqual(["a", "b"]);
    expect(selectOptions(st("x"), ["standby", "always"])).toEqual(["standby", "always"]);
    expect(selectOptions(undefined, ["z"])).toEqual(["z"]);
  });
});
