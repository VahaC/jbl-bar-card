import { afterEach, describe, expect, it } from "vitest";
import { render } from "lit";
import { homeModel } from "../src/tabs/home-model";
import { mediaStyles, renderMedia } from "../src/tabs/home-layouts/media";
import type { TabContext } from "../src/types";
import { cleanup, mountCard, newBar, settle, tabContext } from "./helpers";
import type { Mounted } from "./helpers";
import type { MockBar } from "../demo/mock-hass";

afterEach(cleanup);

const CONFIG = { default_tab: "home", layouts: { home: "media" } } as const;

function mount(bar?: MockBar): Promise<Mounted> {
  return mountCard(CONFIG, bar);
}

/** Render the layout from a ctx directly (for entity sets the mock bar cannot produce). */
function renderWith(ctx: TabContext): HTMLElement {
  const host = document.createElement("div");
  render(renderMedia(ctx, homeModel(ctx)), host);
  return host;
}

function standbyBar(): MockBar {
  const bar = newBar();
  bar.power = "Standby";
  bar.update(() => undefined);
  return bar;
}

const ring = (m: Mounted): HTMLElement => m.$(".home-media .ring")!;
const number = (m: Mounted): string => m.$(".home-media .m-num")?.textContent?.replace(/\s+/g, "") ?? "";

describe("Home media layout", () => {
  it("renders the now playing panel, knob, source row and chips instead of the classic layout", async () => {
    const m = await mount();
    expect(m.$(".home-media")).not.toBeNull();
    expect(m.$(".room")).toBeNull();
    expect(m.$(".layout-note")).toBeNull();
    expect(m.$(".home-media .hero")?.classList.contains("track")).toBe(true);
    expect(m.$(".home-media .eyebrow")?.textContent?.trim()).toBe("Bluetooth");
    expect(m.$(".home-media .m-title")?.textContent?.trim()).toBe("Midnight Drive");
    expect(m.$(".home-media .m-sub")?.textContent?.trim()).toBe("The Neon Lights · via Spotify");
    expect(m.$$(".home-media .m-transport button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Previous",
      "Pause",
      "Stop",
      "Next",
    ]);
    expect(m.$(".home-media .m-transport .primary")?.getAttribute("aria-label")).toBe("Pause");
    const knob = ring(m);
    expect(knob.getAttribute("role")).toBe("slider");
    expect(knob.getAttribute("aria-valuenow")).toBe("14");
    expect(knob.getAttribute("aria-valuemax")).toBe("32");
    expect(knob.getAttribute("aria-valuetext")).toBe("14 / 32");
    expect(number(m)).toBe("14/32");
    expect(m.$$(".home-media .src .seg button").map((b) => b.textContent?.trim())).toEqual(["TV", "HDMI", "Bluetooth"]);
    expect(m.$(".home-media .src .seg button.active")?.textContent?.trim()).toBe("Bluetooth");
    expect(m.$$(".home-media .modes .chip").map((c) => c.textContent?.trim())).toEqual(["Smart mode", "Night"]);
  });

  it("shows the rear batteries as badges, the low one marked, and the dock state", async () => {
    const m = await mount();
    const badges = m.$$(".home-media .status .m-batt");
    expect(badges.map((b) => b.textContent?.replace(/\s+/g, " ").trim())).toEqual(["L 14%", "R 76%"]);
    expect(badges[0].classList.contains("low")).toBe(true);
    expect(badges[0].getAttribute("aria-label")).toBe("Rear left 14%, Low battery");
    // Low is not told by colour alone: an alert icon too.
    expect(badges[0].querySelector(".alert")).not.toBeNull();
    expect(badges[1].classList.contains("low")).toBe(false);
    expect(badges[1].querySelector(".alert")).toBeNull();
    // The dock state is an icon with a label, no text.
    const dock = m.$(".home-media .dock")!;
    expect(dock.getAttribute("role")).toBe("img");
    expect(dock.getAttribute("aria-label")).toBe("Rears detached");
    expect(dock.textContent?.trim()).toBe("");
    expect((dock.querySelector("ha-icon") as HTMLElement & { icon: string }).icon).toBe("mdi:link-variant-off");

    const bar = newBar();
    bar.update((b) => (b.docked = true));
    cleanup();
    const docked = await mount(bar);
    const dockedIcon = docked.$(".home-media .dock")!;
    expect(dockedIcon.classList.contains("docked")).toBe(true);
    expect(dockedIcon.getAttribute("aria-label")).toBe("Rears docked");
    expect((dockedIcon.querySelector("ha-icon") as HTMLElement & { icon: string }).icon).toBe("mdi:link-variant");
  });

  it("names the source with its icon when there is no track", async () => {
    const bar = newBar();
    bar.update((b) => (b.source = "TV"));
    const m = await mount(bar);
    expect(m.$(".home-media .hero")?.classList.contains("source")).toBe(true);
    expect(m.$(".home-media .eyebrow")?.textContent?.trim()).toBe("Source");
    expect(m.$(".home-media .m-title")?.textContent?.trim()).toBe("TV");
    expect((m.$(".home-media .art ha-icon") as HTMLElement & { icon: string }).icon).toBe("mdi:television");
    expect(m.$(".home-media .m-transport")).toBeNull();
  });

  it("names a source that is none of the options once", async () => {
    const bar = newBar();
    bar.update((b) => (b.source = "Chromecast" as never));
    const m = await mount(bar);
    expect(m.$(".home-media .m-title")?.textContent?.trim()).toBe("Chromecast");
    expect(m.$(".home-media .m-sub")).toBeNull();
    expect(m.$(".home-media .hero")?.textContent?.split("Chromecast")).toHaveLength(2);
  });

  it("sends the transport button's command", async () => {
    const m = await mount();
    m.$(".home-media .m-transport .primary")!.click();
    await settle(m);
    expect(m.bar.calls.map((c) => c.service)).toEqual(["media_pause"]);
  });

  it("selects the source with a pending state until the bar confirms", async () => {
    const m = await mount();
    const seg = () => m.$$(".home-media .src .seg button");
    seg()[1].click();
    await m.card.updateComplete;
    expect(seg()[1].classList.contains("pending")).toBe(true);
    expect(seg()[1].getAttribute("aria-busy")).toBe("true");
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "select_source", data: { source: "HDMI" } });
    expect(seg()[1].classList.contains("active")).toBe(true);
    expect(seg()[1].classList.contains("pending")).toBe(false);
  });

  it("steps the volume with - / + and shows the pending target", async () => {
    const m = await mount();
    const [down, up] = m.$$(".home-media .dial .step");
    expect(down.getAttribute("aria-label")).toBe("Volume down");
    up.click();
    await m.card.updateComplete;
    expect(number(m)).toBe("15/32");
    expect(m.$(".home-media .m-num")?.classList.contains("pending")).toBe(true);
    expect(ring(m).getAttribute("aria-busy")).toBe("true");
    await settle(m);
    expect(m.bar.calls.map((c) => c.service)).toEqual(["volume_up"]);
    expect(m.bar.volume).toBe(15);
    expect(m.$(".home-media .m-num")?.classList.contains("pending")).toBe(false);
  });

  it("moves the knob with the keyboard and sends only the final value", async () => {
    const m = await mount();
    for (let i = 0; i < 3; i++) {
      ring(m).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      await m.card.updateComplete;
    }
    expect(number(m)).toBe("17/32");
    expect(ring(m).getAttribute("aria-valuenow")).toBe("17");
    expect(m.bar.calls).toHaveLength(0);
    ring(m).dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp", bubbles: true }));
    await settle(m);
    expect(m.bar.calls.map((c) => [c.service, c.data])).toEqual([["volume_set", { volume_level: 17 / 32 }]]);
    expect(m.bar.volume).toBe(17);

    ring(m).dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    await m.card.updateComplete;
    expect(number(m)).toBe("32/32");
    ring(m).dispatchEvent(new FocusEvent("blur"));
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "volume_set", data: { volume_level: 1 } });
  });

  /** A 200 px knob at the origin (centre 100, 100) and a pointer on it. */
  function knobPointer(m: Mounted): (type: string, x: number, y: number) => void {
    const el = ring(m);
    el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}) });
    return (type, x, y) => {
      ring(m).dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, button: 0, bubbles: true }));
    };
  }
  /** The point on the ring for a value of 0..32 (the arc starts at 135 deg and sweeps 270). */
  function onArc(value: number): [number, number] {
    const a = ((135 + (value / 32) * 270) * Math.PI) / 180;
    return [100 + 95 * Math.cos(a), 100 + 95 * Math.sin(a)];
  }

  it("drags the knob and sends one volume_set on release", async () => {
    const m = await mount();
    const pointer = knobPointer(m);
    // The middle (the number) does not move the knob.
    pointer("pointerdown", 100, 110);
    await m.card.updateComplete;
    expect(number(m)).toBe("14/32");
    // Straight up is the middle of the scale, straight right is 3/4 of the way past it.
    pointer("pointerdown", 100, 5);
    await m.card.updateComplete;
    expect(number(m)).toBe("16/32");
    pointer("pointermove", 195, 100);
    await m.card.updateComplete;
    expect(number(m)).toBe("27/32");
    // The number is not announced while dragging: the slider's value text already is.
    expect(m.$(".home-media .m-num")?.getAttribute("aria-live")).toBe("off");
    // Crossing the gap at the bottom does not jump to 0.
    pointer("pointermove", 90, 195);
    await m.card.updateComplete;
    expect(number(m)).toBe("32/32");
    expect(m.bar.calls).toHaveLength(0);
    pointer("pointerup", 90, 195);
    // The capture is lost after pointerup: nothing is sent twice.
    pointer("lostpointercapture", 90, 195);
    await settle(m);
    expect(m.bar.calls.map((c) => [c.service, c.data])).toEqual([["volume_set", { volume_level: 1 }]]);
    expect(m.$(".home-media .m-num")?.getAttribute("aria-live")).toBe("polite");
  });

  it("follows a fast swipe over the top and stops at the end it left in the gap", async () => {
    const m = await mount();
    const pointer = knobPointer(m);
    pointer("pointerdown", ...onArc(10));
    await m.card.updateComplete;
    expect(number(m)).toBe("10/32");
    // One coalesced move from 10 straight to the right side (27): no gap was crossed.
    pointer("pointermove", 195, 100);
    await m.card.updateComplete;
    expect(number(m)).toBe("27/32");
    // Back over the top down to 2, then into the gap on the left: rests on 0, not on 32.
    pointer("pointermove", ...onArc(16));
    pointer("pointermove", ...onArc(2));
    pointer("pointermove", 60, 186);
    await m.card.updateComplete;
    expect(number(m)).toBe("0/32");
    pointer("pointermove", 100, 195);
    await m.card.updateComplete;
    expect(number(m)).toBe("0/32");
    // Back out of the gap on the same side follows the pointer again.
    pointer("pointermove", ...onArc(3));
    await m.card.updateComplete;
    expect(number(m)).toBe("3/32");
    pointer("pointerup", ...onArc(3));
    await settle(m);
    expect(m.bar.calls.map((c) => [c.service, c.data])).toEqual([["volume_set", { volume_level: 3 / 32 }]]);
  });

  it("ends a drag without sending when the capture is lost or the bar goes to standby", async () => {
    const m = await mount();
    let pointer = knobPointer(m);
    pointer("pointerdown", 100, 5);
    pointer("pointermove", 195, 100);
    await m.card.updateComplete;
    expect(number(m)).toBe("27/32");
    // Lost capture without a pointerup: the drag ends with the value previewed.
    pointer("lostpointercapture", 195, 100);
    await settle(m);
    expect(m.bar.calls.map((c) => [c.service, c.data])).toEqual([["volume_set", { volume_level: 27 / 32 }]]);

    pointer = knobPointer(m);
    pointer("pointerdown", 100, 5);
    await m.card.updateComplete;
    expect(number(m)).toBe("16/32");
    m.bar.update((b) => (b.power = "Standby"));
    await settle(m);
    pointer("pointerup", 100, 5);
    ring(m).dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp", bubbles: true }));
    await settle(m);
    expect(m.bar.calls).toHaveLength(1);

    // Back on: the keyboard is not blocked by the drag that was cut short.
    m.bar.update((b) => (b.power = "On"));
    await settle(m);
    // The preview of the cut-short drag is gone: the number is the bar's volume again.
    expect(number(m)).toBe("27/32");
    ring(m).dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    ring(m).dispatchEvent(new KeyboardEvent("keyup", { key: "Home", bubbles: true }));
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "volume_set", data: { volume_level: 0 } });
  });

  it("toggles mute with a pending state and shows the muted badge", async () => {
    const m = await mount();
    const mute = () => m.$(".home-media .knob .mute")!;
    // The label names the action, so the button has no aria-pressed ("Unmute, pressed").
    expect(mute().hasAttribute("aria-pressed")).toBe(false);
    expect(mute().getAttribute("aria-label")).toBe("Mute");
    mute().click();
    await m.card.updateComplete;
    expect(mute().classList.contains("pending")).toBe(true);
    expect(mute().getAttribute("aria-busy")).toBe("true");
    // The model shows the pending target: the button already offers to unmute.
    expect(mute().getAttribute("aria-label")).toBe("Unmute");
    await settle(m);
    expect(m.bar.muted).toBe(true);
    expect(m.bar.calls.map((c) => c.service)).toEqual(["volume_mute"]);
    expect(mute().classList.contains("pending")).toBe(false);
    expect(m.$(".home-media .knob")?.classList.contains("muted")).toBe(true);
    expect(m.$(".home-media .readout .badge")?.textContent?.trim()).toBe("Muted");
    expect(ring(m).getAttribute("aria-valuetext")).toBe("14 / 32, Muted");
    expect(mute().getAttribute("aria-label")).toBe("Unmute");
  });

  it("switches Night and Smart mode from the chips", async () => {
    const m = await mount();
    const chips = () => m.$$(".home-media .modes .chip");
    expect(chips()[1].getAttribute("role")).toBe("switch");
    chips()[1].click();
    await m.card.updateComplete;
    expect(chips()[1].classList.contains("pending")).toBe(true);
    await settle(m);
    expect(m.bar.night).toBe(true);
    expect(chips()[1].getAttribute("aria-checked")).toBe("true");
    chips()[0].click();
    await settle(m);
    expect(m.bar.smart).toBe(true);
    expect(m.bar.calls.map((c) => c.service)).toEqual(["turn_on", "turn_on"]);
  });

  it("explains why a mode chip is unavailable", () => {
    const ctx = tabContext(newBar(), CONFIG);
    const smart = ctx.entities.smart_mode!;
    const host = renderWith({
      ...ctx,
      stateOf: (id) => {
        const st = ctx.stateOf(id);
        return st && st.entity_id === smart ? { ...st, state: "unavailable" } : st;
      },
    });
    expect((host.querySelector(".home-media .modes .chip") as HTMLButtonElement).disabled).toBe(true);
    expect(Array.from(host.querySelectorAll(".home-media .reasons .hint")).map((h) => h.textContent)).toEqual([
      "Smart mode is unavailable right now.",
    ]);
  });

  it("explains standby once and disables what cannot run", async () => {
    const m = await mount(standbyBar());
    const hint = "The soundbar is in standby. Turn it on to change the source or the volume.";
    expect(m.$(".home-media .hero")?.classList.contains("m-standby")).toBe(true);
    expect(m.$(".home-media .m-title")?.textContent?.trim()).toBe("Standby");
    expect(m.$(".home-media .m-sub")?.textContent?.trim()).toBe(hint);
    expect(m.text().split(hint)).toHaveLength(2);
    expect(m.$(".home-media .m-transport")).toBeNull();
    expect(ring(m).getAttribute("aria-disabled")).toBe("true");
    expect(ring(m).getAttribute("tabindex")).toBe("-1");
    expect(m.$$(".home-media .dial .step").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect((m.$(".home-media .knob .mute") as HTMLButtonElement).disabled).toBe(true);
    expect(m.$$(".home-media .src .seg button").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    ring(m).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    ring(m).dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp", bubbles: true }));
    await settle(m);
    expect(m.bar.calls).toHaveLength(0);
  });

  it("hides the status line and chips without their entities", () => {
    const ctx = tabContext(newBar(), CONFIG);
    const host = renderWith({
      ...ctx,
      entities: {
        ...ctx.entities,
        rear_battery_left: undefined,
        rear_battery_right: undefined,
        rear_docked: undefined,
        smart_mode: undefined,
        standard_mode: undefined,
        night: undefined,
      },
    });
    expect(host.querySelector(".home-media .status")).toBeNull();
    expect(host.querySelector(".home-media .modes")).toBeNull();
    expect(host.querySelector(".home-media .dial")).not.toBeNull();
  });

  it("hides the knob and the source row without a media player", () => {
    const ctx = tabContext(newBar(), CONFIG);
    const host = renderWith({ ...ctx, entities: { ...ctx.entities, media_player: "media_player.gone" } });
    expect(host.querySelector(".home-media .dial")).toBeNull();
    expect(host.querySelector(".home-media .src")).toBeNull();
    expect(host.querySelector(".home-media .m-transport")).toBeNull();
    expect(host.querySelector(".home-media .m-title")?.textContent?.trim()).toBe("Soundbar");
    expect(host.querySelector(".home-media .eyebrow")).toBeNull();
    expect(host.querySelector(".home-media .status")).not.toBeNull();
  });

  it("speaks Ukrainian", async () => {
    const m = await mount(newBar({ language: "uk" }));
    expect(m.$$(".home-media .status .m-batt").map((b) => b.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "Л 14%",
      "П 76%",
    ]);
    expect(ring(m).getAttribute("aria-label")).toBe("Гучність");
    cleanup();
    const standby = newBar({ language: "uk" });
    standby.update((b) => (b.power = "Standby"));
    const off = await mount(standby);
    expect(off.$(".home-media .m-title")?.textContent?.trim()).toBe("Режим очікування");
  });

  it("prefixes every selector with .home-media", () => {
    const selectors = mediaStyles.cssText.match(/[^{}]+(?=\{)/g)!.flatMap((s) => s.split(",").map((x) => x.trim()));
    expect(selectors.length).toBeGreaterThan(10);
    expect(selectors.filter((s) => !s.startsWith(".home-media"))).toEqual([]);
  });
});
