import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "lit";
import { SOUND_TIMING, renderSoundTab } from "../src/tabs/sound";
import type { TabContext } from "../src/types";
import { cleanup, mountCard, newBar, settle, tabContext } from "./helpers";
import type { Mounted } from "./helpers";

const ID = {
  bass: "select.jbl_bar_9_1_bass_level",
  atmos: "select.jbl_bar_9_1_atmos_height",
  rear: "select.jbl_bar_9_1_rear_speakers",
  eqStatus: "sensor.jbl_bar_9_1_front_eq_status",
  band125: "number.jbl_bar_9_1_front_eq_125_hz",
  band8k: "number.jbl_bar_9_1_front_eq_8_khz",
  bassOffset: "number.jbl_bar_9_1_bass_offset",
};

const saved = { ...SOUND_TIMING };
beforeEach(() => {
  Object.assign(SOUND_TIMING, { levelMs: 0, audioSyncMs: 0, eqMs: 0, bassOffsetMs: 0 });
});
afterEach(() => {
  Object.assign(SOUND_TIMING, saved);
  cleanup();
});

const CONFIG = { default_tab: "sound" as const, layouts: { sound: "cards" as const } };
const mountCards = (bar = newBar()): Promise<Mounted> => mountCard(CONFIG, bar);
const value = (m: Mounted, tile: string): string | undefined =>
  m.$(`.sound-cards-${tile} .sound-cards-value`)?.textContent?.replace(/\s+/g, "");
const button = (m: Mounted, selector: string): HTMLButtonElement => m.$(selector) as HTMLButtonElement;
const knobs = (m: Mounted): HTMLElement[] => m.$$(".sound-cards-knob");

function renderCtx(ctx: TabContext): HTMLElement {
  const host = document.createElement("div");
  render(renderSoundTab(ctx), host);
  return host;
}

function pointer(el: Element, type: string, clientY: number, pointerType = "mouse"): void {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientY, button: 0, pointerType }));
}

/** happy-dom has no layout: give the EQ plot area a 120 px height (the full -6..0 dB range). */
function sizeArea(m: Mounted): void {
  const area = m.$(".sound-cards-area")!;
  area.getBoundingClientRect = () =>
    ({ top: 0, bottom: 120, left: 0, right: 300, height: 120, width: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

describe("Sound cards: tiles", () => {
  it("shows every value as a card, without the classic layout", async () => {
    const m = await mountCards();
    expect(m.$(".sound-cards")).not.toBeNull();
    expect(m.$(".sound")).toBeNull();
    expect(m.$(".sound-cards-note")).toBeNull();
    expect(value(m, "bass")).toBe("3/5");
    expect(value(m, "center")).toBe("+2.4dB");
    expect(m.$(".sound-cards-center .sound-cards-sub")?.textContent).toBe("Level 2 of 6");
    expect(value(m, "atmos")).toBe("Mid");
    expect(value(m, "rear")).toBe("High");
    expect(value(m, "offset")).toBe("+0.5dB");
    expect(m.$(".sound-cards-offset .badge")?.textContent).toBe("Active");
    expect(m.$(".sound-cards-bass .sound-cards-value")?.getAttribute("aria-live")).toBe("polite");
    expect(button(m, ".sound-cards-bass .sound-cards-prev").getAttribute("aria-label")).toBe("Bass: lower");
    expect(button(m, ".sound-cards-atmos .sound-cards-next").getAttribute("aria-label")).toBe("Atmos height: next option");
  });

  it("steps bass with + and shows the target as pending until the bar confirms", async () => {
    const bar = newBar();
    bar.delayMs = 20;
    const m = await mountCards(bar);
    button(m, ".sound-cards-bass .sound-cards-next").click();
    await m.card.updateComplete;
    expect(value(m, "bass")).toBe("4/5");
    expect(m.$(".sound-cards-bass .sound-cards-value")?.classList.contains("pending")).toBe(true);
    expect(m.$(".sound-cards-bass .sound-cards-spinner")).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await settle(m);
    expect(bar.calls.map((c) => [c.service, c.data, c.target?.entity_id])).toEqual([["select_option", { option: "4" }, ID.bass]]);
    expect(m.$(".sound-cards-bass .sound-cards-spinner")).toBeNull();
    expect(value(m, "bass")).toBe("4/5");
  });

  it("steps center down and stops bass at the top", async () => {
    const m = await mountCards();
    button(m, ".sound-cards-center .sound-cards-prev").click();
    await settle(m);
    expect(m.bar.calls.map((c) => c.data.option)).toEqual(["0"]);
    expect(value(m, "center")).toBe("Original");
    button(m, ".sound-cards-bass .sound-cards-next").click();
    await m.card.updateComplete;
    button(m, ".sound-cards-bass .sound-cards-next").click();
    await settle(m);
    expect(value(m, "bass")).toBe("5/5");
    expect(button(m, ".sound-cards-bass .sound-cards-next").disabled).toBe(true);
  });

  it("cycles atmos and rear through their options, sending only the last one", async () => {
    const m = await mountCards();
    button(m, ".sound-cards-atmos .sound-cards-prev").click();
    await settle(m);
    expect(value(m, "atmos")).toBe("Low");
    // Rear: High -> Mute -> (wraps) Low; only Low goes to the bar.
    SOUND_TIMING.levelMs = 20;
    button(m, ".sound-cards-rear .sound-cards-next").click();
    await m.card.updateComplete;
    expect(value(m, "rear")).toBe("Mute");
    button(m, ".sound-cards-rear .sound-cards-next").click();
    await m.card.updateComplete;
    expect(value(m, "rear")).toBe("Low");
    await new Promise((resolve) => setTimeout(resolve, 40));
    await settle(m);
    expect(m.bar.calls.map((c) => [c.target?.entity_id, c.data.option])).toEqual([
      [ID.atmos, "low"],
      [ID.rear, "low"],
    ]);
  });

  it("disables the rear card while the rears are docked and says why", async () => {
    const bar = newBar();
    bar.docked = true;
    bar.update(() => undefined);
    const m = await mountCards(bar);
    expect(m.$(".sound-cards-rear")?.classList.contains("blocked")).toBe(true);
    expect(button(m, ".sound-cards-rear .sound-cards-prev").disabled).toBe(true);
    expect(button(m, ".sound-cards-rear .sound-cards-next").disabled).toBe(true);
    expect(m.$(".sound-cards-rear .sound-cards-reason")?.textContent).toContain("Take both rear speakers off the soundbar");
    // The reason sits above the buttons, so the buttons line up with the next tile's.
    const parts = Array.from(m.$(".sound-cards-rear")!.children).map((el) => el.classList[0]);
    expect(parts.indexOf("sound-cards-msg")).toBeLessThan(parts.indexOf("sound-cards-controls"));
    expect(parts.at(-1)).toBe("sound-cards-controls");
  });

  it("explains every disabled tile with the model's reason when the bar is unreachable", async () => {
    const bar = newBar();
    bar.reachable = false;
    bar.update(() => undefined);
    const m = await mountCards(bar);
    expect(button(m, ".sound-cards-offset .sound-cards-less").disabled).toBe(true);
    expect(m.$(".sound-cards-offset .sound-cards-reason")?.textContent).toBe("The soundbar is unreachable.");
    expect(m.$(".sound-cards-bass .sound-cards-reason")?.textContent).toBe("The soundbar is unreachable.");
    // One line under the graph for the whole EQ, not repeated for the preset; no drag hint.
    expect(m.$(".sound-cards-bands-reason")?.textContent).toBe("The soundbar is unreachable.");
    expect(m.$(".sound-cards-preset-reason")).toBeNull();
    expect(m.$(".sound-cards-eq-hint")).toBeNull();
  });

  it("shows no reason on an enabled stepper", async () => {
    const m = await mountCards();
    expect(m.$(".sound-cards-offset .sound-cards-reason")).toBeNull();
    expect(m.$(".sound-cards-bass .sound-cards-reason")).toBeNull();
  });

  it("explains why audio sync cannot change on Bluetooth", async () => {
    const m = await mountCards();
    expect(value(m, "sync")).toBe("—");
    expect(button(m, ".sound-cards-sync .sound-cards-more").disabled).toBe(true);
    expect(m.$(".sound-cards-sync .sound-cards-reason")?.textContent).toBe("Audio sync works only with the TV or HDMI input.");
  });

  it("sets audio sync and keeps the buttons focusable but locked while the bar re-syncs", async () => {
    const bar = newBar();
    bar.source = "TV";
    bar.update(() => undefined);
    const m = await mountCards(bar);
    expect(value(m, "sync")).toBe("40ms");
    bar.delayMs = 30;
    button(m, ".sound-cards-sync .sound-cards-more").click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await m.sync();
    const more = button(m, ".sound-cards-sync .sound-cards-more");
    expect(more.disabled).toBe(false);
    expect(more.getAttribute("aria-disabled")).toBe("true");
    expect(m.$(".sound-cards-sync .sound-cards-reason")?.textContent).toContain("re-syncing");
    await new Promise((resolve) => setTimeout(resolve, 150));
    await settle(m);
    expect(bar.calls.map((c) => [c.service, c.data])).toEqual([["set_value", { value: 50 }]]);
    expect(value(m, "sync")).toBe("50ms");
    expect(button(m, ".sound-cards-sync .sound-cards-more").getAttribute("aria-disabled")).toBe("false");
  });

  it("steps the bass offset by 0.5 dB", async () => {
    const m = await mountCards();
    button(m, ".sound-cards-offset .sound-cards-less").click();
    await settle(m);
    expect(m.bar.calls.map((c) => [c.target?.entity_id, c.data])).toEqual([[ID.bassOffset, { value: 0 }]]);
    expect(value(m, "offset")).toBe("0dB");
  });
});

describe("Sound cards: Front EQ", () => {
  it("draws the curve with one slider point per band", async () => {
    const m = await mountCards();
    expect(m.$(".sound-cards-eq-status")?.textContent).toBe("Active");
    expect(m.$(".sound-cards-eq-status")?.classList.contains("ok")).toBe(true);
    expect((m.$(".sound-cards-preset option[selected]") as HTMLOptionElement).value).toBe("warm");
    expect(knobs(m).map((k) => k.getAttribute("aria-valuenow"))).toEqual(["0", "0", "-1", "-2", "-3"]);
    expect(knobs(m)[0].getAttribute("role")).toBe("slider");
    expect(knobs(m)[0].getAttribute("aria-label")).toBe("Front EQ 125 Hz");
    expect(knobs(m)[4].getAttribute("aria-valuetext")).toBe("-3 dB");
    expect(m.$$(".sound-cards-freq").map((e) => e.textContent)).toEqual(["125 Hz", "500 Hz", "2 kHz", "4 kHz", "8 kHz"]);
    expect(m.$(".sound-cards-line")?.getAttribute("d")).toMatch(/^M 0 0 C /);
  });

  it("moves a point with the arrow keys and sends only the final value", async () => {
    SOUND_TIMING.eqMs = 30;
    const m = await mountCards();
    for (let i = 0; i < 3; i++) {
      knobs(m)[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await m.card.updateComplete;
    }
    expect(knobs(m)[0].getAttribute("aria-valuenow")).toBe("-1.5");
    expect(m.$$(".sound-cards-col")[0].classList.contains("pending")).toBe(true);
    expect(m.bar.calls).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await settle(m);
    expect(m.bar.calls.map((c) => [c.target?.entity_id, c.data.value])).toEqual([[ID.band125, -1.5]]);
    expect(m.bar.gains[0]).toBe(-1.5);
    // End jumps to the minimum.
    knobs(m)[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    await settle(m);
    expect(m.bar.gains[0]).toBe(-6);
  });

  it("drags a point relative to where it was grabbed: previews while moving, sends the snapped value on release", async () => {
    const m = await mountCards();
    sizeArea(m);
    const col = () => m.$$(".sound-cards-col")[4];
    // Grabbed anywhere on the knob, the point does not jump: -3 dB stays -3 dB.
    pointer(knobs(m)[4], "pointerdown", 10);
    await m.card.updateComplete;
    expect(col().classList.contains("dragging")).toBe(false);
    expect(knobs(m)[4].getAttribute("aria-valuenow")).toBe("-3");
    pointer(knobs(m)[4], "pointermove", 42); // 32 px of 120 px = -1.6 dB -> -4.6 -> -4.5
    await m.card.updateComplete;
    expect(col().classList.contains("dragging")).toBe(true);
    expect(col().querySelector(".sound-cards-tag")?.textContent).toBe("-4.5");
    expect(m.bar.calls).toHaveLength(0);
    pointer(knobs(m)[4], "pointerup", 42);
    await settle(m);
    expect(m.bar.calls.map((c) => [c.target?.entity_id, c.data.value])).toEqual([[ID.band8k, -4.5]]);
    expect(col().classList.contains("dragging")).toBe(false);
    expect(knobs(m)[4].getAttribute("aria-valuenow")).toBe("-4.5");
  });

  it("ignores a touch beside a point and a tap without a move", async () => {
    const m = await mountCards();
    sizeArea(m);
    // A swipe or tap on the graph away from the knob (the column, the plot) changes nothing.
    for (const el of [m.$$(".sound-cards-col")[0], m.$(".sound-cards-area")!, m.$(".sound-cards-plot")!]) {
      pointer(el, "pointerdown", 100, "touch");
      pointer(el, "pointermove", 20, "touch");
      pointer(el, "pointerup", 20, "touch");
    }
    // A tap on the knob that does not move it sends nothing either.
    pointer(knobs(m)[1], "pointerdown", 50, "touch");
    pointer(knobs(m)[1], "pointermove", 51, "touch");
    pointer(knobs(m)[1], "pointerup", 51, "touch");
    await settle(m);
    expect(m.$$(".sound-cards-col.dragging")).toHaveLength(0);
    expect(knobs(m).map((k) => k.getAttribute("aria-valuenow"))).toEqual(["0", "0", "-1", "-2", "-3"]);
    expect(m.bar.calls).toHaveLength(0);
  });

  it("drops a cancelled drag without sending anything", async () => {
    const m = await mountCards();
    sizeArea(m);
    pointer(knobs(m)[2], "pointerdown", 50);
    pointer(knobs(m)[2], "pointermove", 90); // -1 -> -3
    await m.card.updateComplete;
    expect(knobs(m)[2].getAttribute("aria-valuenow")).toBe("-3");
    pointer(knobs(m)[2], "pointercancel", 90);
    await settle(m);
    expect(knobs(m)[2].getAttribute("aria-valuenow")).toBe("-1");
    expect(m.$$(".sound-cards-col")[2].classList.contains("dragging")).toBe(false);
    // A capture lost without a pointerup drops the drag the same way.
    pointer(knobs(m)[2], "pointerdown", 50);
    pointer(knobs(m)[2], "pointermove", 10);
    pointer(knobs(m)[2], "lostpointercapture", 10);
    await settle(m);
    expect(knobs(m)[2].getAttribute("aria-valuenow")).toBe("-1");
    expect(m.bar.calls).toHaveLength(0);
  });

  it("keeps a value set with the keys when a drag over it is cancelled", async () => {
    SOUND_TIMING.eqMs = 30;
    const m = await mountCards();
    sizeArea(m);
    for (let i = 0; i < 2; i++) {
      knobs(m)[0].dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }));
      await m.card.updateComplete;
    }
    expect(knobs(m)[0].getAttribute("aria-valuenow")).toBe("-2");
    pointer(knobs(m)[0], "pointerdown", 50);
    pointer(knobs(m)[0], "pointermove", 10); // -2 -> 0
    await m.card.updateComplete;
    expect(knobs(m)[0].getAttribute("aria-valuenow")).toBe("0");
    pointer(knobs(m)[0], "pointercancel", 10);
    await m.card.updateComplete;
    expect(knobs(m)[0].getAttribute("aria-valuenow")).toBe("-2");
    await new Promise((resolve) => setTimeout(resolve, 60));
    await settle(m);
    expect(m.bar.calls.map((c) => [c.target?.entity_id, c.data.value])).toEqual([[ID.band125, -2]]);
    expect(m.bar.gains[0]).toBe(-2);
  });

  it("selects a preset", async () => {
    const m = await mountCards();
    const select = m.$(".sound-cards-preset") as HTMLSelectElement;
    select.value = "bright";
    select.dispatchEvent(new Event("change"));
    await settle(m);
    expect(m.bar.calls.map((c) => [c.service, c.data])).toEqual([["select_option", { option: "bright" }]]);
    expect(knobs(m).map((k) => k.getAttribute("aria-valuenow"))).toEqual(["-3", "-2", "-1", "0", "0"]);
  });

  it("hides the drag hint and ignores drags while a preset is applied", async () => {
    const bar = newBar();
    bar.delayMs = 30;
    const m = await mountCards(bar);
    sizeArea(m);
    expect(m.$(".sound-cards-eq-hint")?.textContent).toBe("Drag the points to shape the sound.");
    const select = m.$(".sound-cards-preset") as HTMLSelectElement;
    select.value = "bright";
    select.dispatchEvent(new Event("change"));
    await m.card.updateComplete;
    expect(knobs(m).every((k) => k.getAttribute("aria-disabled") === "true")).toBe(true);
    expect(m.$(".sound-cards-eq-hint")).toBeNull();
    // The model's reason takes the hint's place; one spinner for the EQ comes from eq.pending.
    expect(m.$(".sound-cards-bands-reason")?.textContent).toBe("The preset is being applied. The EQ unlocks once it is set.");
    expect(m.$(".sound-cards-eq .sound-cards-head .sound-cards-spinner")).not.toBeNull();
    expect(select.getAttribute("title")).toBe("The preset is being applied. The EQ unlocks once it is set.");
    pointer(knobs(m)[0], "pointerdown", 50);
    pointer(knobs(m)[0], "pointermove", 100);
    pointer(knobs(m)[0], "pointerup", 100);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await settle(m);
    expect(bar.calls.map((c) => [c.service, c.data])).toEqual([["select_option", { option: "bright" }]]);
    expect(m.$(".sound-cards-eq-hint")).not.toBeNull();
  });

  it("shows the reason in Smart mode and offers a reset when the EQ needs one", async () => {
    const smart = newBar();
    smart.smart = true;
    smart.update(() => undefined);
    const s = await mountCards(smart);
    expect(s.$(".sound-cards-eq-status")?.classList.contains("warn")).toBe(true);
    expect(s.$(".sound-cards-eq-reason")?.textContent).toBe("Front EQ requires Standard Mode and active audio");
    cleanup();

    const bar = newBar();
    bar.update((b) => (b.eqResetNeeded = true));
    const m = await mountCards(bar);
    expect(m.$(".sound-cards-eq-status.err")?.textContent).toBe("Reset needed");
    button(m, ".sound-cards-reset").click();
    await settle(m);
    expect(bar.calls.at(-1)).toMatchObject({ service: "select_option", data: { option: "original" } });
    expect(m.$(".sound-cards-reset")).toBeNull();
  });
});

describe("Sound cards: missing entities and languages", () => {
  it("hides every card whose entity is missing", () => {
    const base = tabContext(newBar(), CONFIG);
    const ctx: TabContext = {
      ...base,
      entities: {
        ...base.entities,
        center: undefined,
        audio_sync: undefined,
        bass_offset: undefined,
        eq_preset: undefined,
        front_eq_status: undefined,
        eqBands: [base.entities.eqBands[0], undefined, undefined, base.entities.eqBands[3], undefined],
      },
    };
    const host = renderCtx(ctx);
    expect(host.querySelector(".sound-cards-center")).toBeNull();
    expect(host.querySelector(".sound-cards-sync")).toBeNull();
    expect(host.querySelector(".sound-cards-offset")).toBeNull();
    expect(host.querySelector(".sound-cards-preset")).toBeNull();
    expect(host.querySelector(".sound-cards-eq-status")).toBeNull();
    expect(host.querySelectorAll(".sound-cards-knob")).toHaveLength(2);
    expect(Array.from(host.querySelectorAll(".sound-cards-freq")).map((e) => e.textContent)).toEqual(["125 Hz", "4 kHz"]);
    expect(host.querySelector(".sound-cards-bass")).not.toBeNull();
  });

  it("drops the EQ card without EQ entities and explains an empty bar", () => {
    const base = tabContext(newBar(), CONFIG);
    const noEq = renderCtx({
      ...base,
      entities: { ...base.entities, eq_preset: undefined, front_eq_status: undefined, eqBands: [] },
    });
    expect(noEq.querySelector(".sound-cards-eq")).toBeNull();
    expect(noEq.querySelector(".sound-cards-offset")).not.toBeNull();
    const empty = renderCtx({
      ...base,
      entities: {
        media_player: base.entities.media_player,
        eqBands: [],
        eqBandsGuessed: [],
        timerLines: [],
        messageLines: [],
        recentTimers: [],
        recentMessages: [],
        multipleBars: false,
      },
    });
    expect(empty.querySelector(".sound-cards")?.textContent).toContain("This soundbar does not report any sound settings.");
  });

  it("translates to Ukrainian and French", async () => {
    const uk = await mountCards(newBar({ language: "uk" }));
    expect(uk.$(".sound-cards-center .sound-cards-sub")?.textContent).toBe("Рівень 2 з 6");
    expect(button(uk, ".sound-cards-bass .sound-cards-next").getAttribute("aria-label")).toBe("Баси: більше");
    expect(uk.$(".sound-cards-eq-hint")?.textContent).toBe("Перетягуйте точки, щоб налаштувати звук.");
    cleanup();
    const fr = await mountCards(newBar({ language: "fr" }));
    expect(fr.$(".sound-cards-center .sound-cards-sub")?.textContent).toBe("Niveau 2 sur 6");
    expect(fr.$(".sound-cards-eq-status")?.textContent).toBe("Actif");
  });
});
