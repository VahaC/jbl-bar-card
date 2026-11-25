import { afterEach, describe, expect, it } from "vitest";
import { render } from "lit";
import { IMAGES } from "../src/assets";
import { HOME_KEYS, homeModel } from "../src/tabs/home-model";
import { homeStyles, renderHomeTab } from "../src/tabs/home";
import { mediaStyles } from "../src/tabs/home-layouts/media";
import { remoteStyles } from "../src/tabs/home-layouts/remote";
import type { TabContext } from "../src/types";
import { MEDIA_PLAYER } from "../demo/mock-hass";
import { cleanup, newBar, tabContext } from "./helpers";

afterEach(cleanup);

/** Let ctx.call's promise chain run. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

/** A ctx whose media_player shows extra attributes. */
function withPlayer(ctx: TabContext, attributes: Record<string, unknown>): TabContext {
  return {
    ...ctx,
    stateOf: (id) => {
      const st = ctx.stateOf(id);
      return id === MEDIA_PLAYER && st ? { ...st, attributes: { ...st.attributes, ...attributes } } : st;
    },
  };
}

describe("homeModel: room", () => {
  it("describes detached rears, batteries and the bass level", () => {
    const { room } = homeModel(tabContext());
    expect(room.hasRears).toBe(true);
    expect(room.docked).toBe(false);
    expect(room.showRearPictures).toBe(true);
    expect(room.barImage).toBe(IMAGES.barCenter);
    expect(room.dockText).toBe("Rears detached");
    const [left, right] = room.rears;
    expect(left).toMatchObject({ side: "left", level: 14, low: true, batteryText: "14%", label: "Rear left 14%" });
    expect(left.batteryIcon).toBe("mdi:battery-10");
    expect(left.batteryTitle).toBe("Low battery");
    expect(left.image).toBe(IMAGES.rearLeft);
    expect(right).toMatchObject({ side: "right", level: 76, low: false, batteryTitle: "" });
    expect(room.sub).toMatchObject({ bassLevel: "3", bassText: "Bass 3/5", label: "Subwoofer, Bass 3/5", enabled: true });
  });

  it("draws one bar with charging batteries while docked", () => {
    const bar = newBar();
    bar.update((b) => (b.docked = true));
    const { room } = homeModel(tabContext(bar));
    expect(room.docked).toBe(true);
    expect(room.showRearPictures).toBe(false);
    expect(room.barImage).toBe(IMAGES.barDocked);
    expect(room.dockText).toBe("Rears docked");
    expect(room.rears[0].batteryIcon).toBe("mdi:battery-charging-10");
  });

  it("has no rears and names the bar when the rear entities are missing", () => {
    const ctx = tabContext();
    const { room } = homeModel({
      ...ctx,
      entities: { ...ctx.entities, rear_battery_left: undefined, rear_battery_right: undefined, rear_docked: undefined },
    });
    expect(room.hasRears).toBe(false);
    expect(room.rears).toEqual([]);
    expect(room.showRearPictures).toBe(false);
    expect(room.dockKnown).toBe(false);
    expect(room.dockText).toBeUndefined();
    expect(room.barName).toBe("Soundbar");
  });
});

describe("homeModel: source", () => {
  it("lists the bar's sources and selects one with a pending target", async () => {
    const bar = newBar();
    const ctx = tabContext(bar);
    const source = homeModel(ctx).source!;
    expect(source.options.map((o) => [o.label, o.active, o.enabled])).toEqual([
      ["TV", false, true],
      ["HDMI", false, true],
      ["Bluetooth", true, true],
    ]);
    source.options[2].select();
    expect(ctx.isPending(HOME_KEYS.source)).toBe(false);
    source.options[1].select();
    expect(ctx.pendingValue(HOME_KEYS.source)).toBe("HDMI");
    expect(homeModel(ctx).source!.options[1].pending).toBe(true);
    await tick();
    expect(bar.calls.at(-1)).toMatchObject({ service: "select_source", data: { source: "HDMI" } });
  });

  it("names a source that is none of the buttons", () => {
    const source = homeModel(withPlayer(tabContext(), { source: "Spotify" })).source!;
    expect(source.current).toBe("Spotify");
    expect(source.otherText).toBe("Now playing from Spotify");
    expect(source.options.some((o) => o.active)).toBe(false);
  });
});

describe("homeModel: volume", () => {
  it("steps from the pending target so quick presses add up", async () => {
    const bar = newBar();
    const ctx = tabContext(bar);
    const volume = homeModel(ctx).volume!;
    expect(volume).toMatchObject({ current: 14, shown: 14, shownText: "14", max: 32, pending: false, muted: false, off: false });
    expect(volume.up.enabled && volume.down.enabled).toBe(true);
    volume.up.run();
    expect(ctx.pendingValue(HOME_KEYS.volume)).toBe(15);
    volume.up.run();
    expect(ctx.pendingValue(HOME_KEYS.volume)).toBe(16);
    const next = homeModel(ctx).volume!;
    expect(next.shown).toBe(16);
    expect(next.pending && next.up.pending).toBe(true);
    await tick();
    expect(bar.calls.map((c) => c.service)).toEqual(["volume_up", "volume_up"]);
  });

  it("stops at the ends of the scale", () => {
    const bar = newBar();
    bar.update((b) => (b.volume = 32));
    const volume = homeModel(tabContext(bar)).volume!;
    expect(volume.up.enabled).toBe(false);
    expect(volume.down.enabled).toBe(true);
  });

  it("previews the slider without sending and commits once", async () => {
    const bar = newBar();
    const ctx = tabContext(bar);
    const slider = homeModel(ctx).volume!.slider;
    expect(slider).toMatchObject({ min: 0, max: 32, step: 1, value: 14, enabled: true });
    slider.preview(20);
    expect(homeModel(ctx).volume!.shown).toBe(20);
    expect(ctx.local<{ dragVolume?: number }>("home", () => ({})).dragVolume).toBe(20);
    slider.commit(14);
    await tick();
    expect(bar.calls).toHaveLength(0);
    expect(homeModel(ctx).volume!.shown).toBe(14);
    homeModel(ctx).volume!.slider.commit(20);
    expect(ctx.pendingValue(HOME_KEYS.volume)).toBe(20);
    await tick();
    expect(bar.calls.map((c) => [c.service, c.data])).toEqual([["volume_set", { volume_level: 20 / 32 }]]);
  });

  it("ignores a second mute tap while the first is pending", async () => {
    const bar = newBar();
    const ctx = tabContext(bar);
    const mute = homeModel(ctx).volume!.mute;
    expect(mute).toMatchObject({ kind: "switch", on: false, label: "Mute", icon: "mdi:volume-high", enabled: true });
    mute.run();
    mute.run();
    expect(homeModel(ctx).volume!.mute.pending).toBe(true);
    await tick();
    expect(bar.calls.map((c) => c.service)).toEqual(["volume_mute"]);
  });

  it("shows the muted state", () => {
    const volume = homeModel(withPlayer(tabContext(), { is_volume_muted: true })).volume!;
    expect(volume.muted).toBe(true);
    expect(volume.mutedText).toBe("Muted");
    expect(volume.mute).toMatchObject({ on: true, label: "Unmute", name: "Mute", icon: "mdi:volume-off" });
  });

  it("shows the mute target while pending and keeps the fixed name", async () => {
    const bar = newBar({ delayMs: 20 });
    const ctx = tabContext(bar);
    homeModel(ctx).volume!.mute.run();
    const pending = homeModel(ctx).volume!;
    // The bar has not confirmed yet: the raw state is still unmuted, the control shows the target.
    expect(pending.muted).toBe(false);
    expect(pending.mute).toMatchObject({ on: true, pending: true, label: "Unmute", name: "Mute", icon: "mdi:volume-off" });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(bar.calls.map((c) => [c.service, c.data])).toEqual([["volume_mute", { is_volume_muted: true }]]);
  });
});

describe("homeModel: power", () => {
  it("turns the bar off with the header's pending key and ignores repeats", async () => {
    const bar = newBar();
    const ctx = tabContext(bar);
    const power = homeModel(ctx).power!;
    expect(power).toMatchObject({
      kind: "switch",
      id: "power",
      key: "header.power",
      on: true,
      label: "Turn off",
      name: "Power",
      icon: "mdi:power",
      enabled: true,
      pending: false,
    });
    expect(power.reason).toBeUndefined();
    expect(HOME_KEYS.power).toBe("header.power");
    power.run();
    power.run();
    // The pending target is shown straight away.
    expect(homeModel(ctx).power).toMatchObject({ on: false, pending: true, label: "Turn on" });
    await tick();
    expect(bar.calls.map((c) => `${c.domain}.${c.service}`)).toEqual(["media_player.turn_off"]);
  });

  it("turns the bar on from standby", async () => {
    const bar = newBar();
    bar.power = "Standby";
    bar.update(() => undefined);
    const ctx = tabContext(bar);
    const power = homeModel(ctx).power!;
    expect(power).toMatchObject({ on: false, label: "Turn on", enabled: true });
    power.run();
    await tick();
    expect(bar.calls.at(-1)).toMatchObject({ domain: "media_player", service: "turn_on" });
  });

  it("is disabled with a reason while the bar is unreachable, and missing without a media_player", () => {
    const bar = newBar();
    bar.reachable = false;
    bar.update(() => undefined);
    const power = homeModel(tabContext(bar)).power!;
    expect(power).toMatchObject({ enabled: false, on: false, reason: "The soundbar is unreachable." });
    const ctx = tabContext();
    expect(homeModel({ ...ctx, stateOf: (id) => (id === MEDIA_PLAYER ? undefined : ctx.stateOf(id)) }).power).toBeUndefined();
  });
});

describe("homeModel: standby", () => {
  it("disables source and volume, explains why and hides playback", () => {
    const bar = newBar();
    bar.power = "Standby";
    bar.update(() => undefined);
    const model = homeModel(tabContext(bar));
    expect(model.standby).toBe(true);
    expect(model.standbyHint).toContain("The soundbar is in standby.");
    expect(model.source!.enabled).toBe(false);
    expect(model.source!.options.every((o) => !o.enabled)).toBe(true);
    expect(model.source!.reason).toBe(model.standbyHint);
    expect(model.volume!.slider.enabled).toBe(false);
    expect(model.volume!.mute.enabled).toBe(false);
    expect(model.volume!.up.reason).toBe(model.standbyHint);
    expect(model.volume).toMatchObject({ off: true, offText: "Off" });
    expect(model.playback).toBeUndefined();
    // The bar reports Smart mode unavailable in standby: the reason is the standby hint.
    expect(model.modes!.smart).toMatchObject({ enabled: false, reason: model.standbyHint });
    // Power stays usable: it is how the bar leaves standby.
    expect(model.power).toMatchObject({ enabled: true, on: false });
  });
});

describe("homeModel: modes", () => {
  it("offers Smart mode and Night switches and ignores repeats while pending", async () => {
    const bar = newBar();
    const ctx = tabContext(bar);
    const modes = homeModel(ctx).modes!;
    expect(modes.smart).toMatchObject({ kind: "switch", label: "Smart mode", on: false, enabled: true });
    expect(modes.night).toMatchObject({ kind: "switch", label: "Night", on: false, icon: "mdi:weather-night" });
    modes.night!.run();
    modes.night!.run();
    expect(homeModel(ctx).modes!.night).toMatchObject({ on: true, pending: true });
    await tick();
    expect(bar.calls.map((c) => [c.domain, c.service])).toEqual([["switch", "turn_on"]]);
  });

  it("falls back to the Standard mode button without the Smart mode switch", async () => {
    const bar = newBar();
    const ctx = tabContext(bar);
    const button = "button.jbl_bar_9_1_bluetooth_pairing";
    const modes = homeModel({ ...ctx, entities: { ...ctx.entities, smart_mode: undefined, standard_mode: button } })!.modes!;
    expect(modes.smart).toMatchObject({ kind: "button", label: "Standard mode", enabled: true });
    modes.smart!.run();
    await tick();
    expect(bar.calls.at(-1)).toMatchObject({ domain: "button", service: "press" });
  });

  it("explains why a mode control is unavailable", () => {
    const ctx = tabContext();
    const night = ctx.entities.night!;
    const unavailable = (id: string | undefined): boolean => id === night || id === "night";
    const modes = homeModel({
      ...ctx,
      stateOf: (id) => {
        const st = ctx.stateOf(id);
        return unavailable(id) && st ? { ...st, state: "unavailable" } : st;
      },
    }).modes!;
    expect(modes.night).toMatchObject({ enabled: false, reason: "Night is unavailable right now.", name: "Night" });
    expect(modes.smart).toMatchObject({ enabled: true, reason: undefined });

    const button = "button.jbl_bar_9_1_missing";
    const standard = homeModel({ ...ctx, entities: { ...ctx.entities, smart_mode: undefined, standard_mode: button } }).modes!.smart!;
    expect(standard).toMatchObject({ kind: "button", enabled: false, reason: "Standard mode is unavailable right now." });
  });

  it("says the bar is unreachable when that is why the modes are off", () => {
    const ctx = tabContext();
    const switches = [ctx.entities.smart_mode, ctx.entities.night];
    const modes = homeModel({
      ...ctx,
      barUnavailable: true,
      stateOf: (id) => {
        const st = ctx.stateOf(id);
        return st && switches.includes(st.entity_id) ? { ...st, state: "unavailable" } : st;
      },
    }).modes!;
    expect(modes.smart).toMatchObject({ enabled: false, reason: "The soundbar is unreachable." });
    expect(modes.night).toMatchObject({ enabled: false, reason: "The soundbar is unreachable." });
  });

  it("has no modes without the entities", () => {
    const ctx = tabContext();
    const model = homeModel({ ...ctx, entities: { ...ctx.entities, smart_mode: undefined, standard_mode: undefined, night: undefined } });
    expect(model.modes).toBeUndefined();
  });
});

describe("homeModel: playback", () => {
  it("lists the supported transport buttons and the track", async () => {
    const bar = newBar();
    const ctx = tabContext(bar);
    const pb = homeModel(ctx).playback!;
    expect(pb.actions.map((a) => [a.action, a.label, a.primary])).toEqual([
      ["previous", "Previous", false],
      ["pause", "Pause", true],
      ["stop", "Stop", false],
      ["next", "Next", false],
    ]);
    expect(pb.title).toBe("Midnight Drive");
    expect(pb.subtitle).toBe("The Neon Lights · via Spotify");
    expect(pb.hasInfo).toBe(true);
    pb.actions[3].run();
    expect(homeModel(ctx).playback!.actions[3].pending).toBe(true);
    await tick();
    expect(bar.calls.at(-1)).toMatchObject({ service: "media_next_track" });
  });

  it("is absent when the source has neither controls nor a track", () => {
    const bar = newBar();
    bar.update((b) => {
      b.source = "TV";
      b.playerState = "IDLE";
    });
    expect(homeModel(tabContext(bar)).playback).toBeUndefined();
  });
});

describe("home layouts", () => {
  it("dispatches on layouts.home", () => {
    for (const layout of ["remote", "media"] as const) {
      const host = document.createElement("div");
      render(renderHomeTab(tabContext(newBar(), { layouts: { home: layout } })), host);
      expect(host.querySelector(`.home-${layout}`)).not.toBeNull();
      expect(host.querySelector(".layout-note")).toBeNull();
      expect(host.querySelector(".home > .room")).toBeNull();
    }
    const classic = document.createElement("div");
    render(renderHomeTab(tabContext()), classic);
    expect(classic.querySelector(".layout-note")).toBeNull();
    expect(classic.querySelector(".home > .room")).not.toBeNull();
  });

  it("exports every layout's styles, each layout's selectors prefixed", () => {
    expect(homeStyles).toHaveLength(3);
    for (const [name, sheet] of [
      ["remote", remoteStyles],
      ["media", mediaStyles],
    ] as const) {
      const selectors = sheet.cssText
        .match(/[^{}]+(?=\{)/g)!
        .flatMap((s) => s.split(",").map((x) => x.trim()))
        // at-rules (@media, @container, @keyframes) and keyframe steps are not selectors
        .filter((s) => s && !s.startsWith("@") && !/^(from|to|\d+(\.\d+)?%)$/.test(s));
      expect(selectors.filter((s) => !s.startsWith(`.home-${name}`))).toEqual([]);
    }
  });
});
