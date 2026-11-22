import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "lit";
import { SOUND_TIMING, renderSoundTab } from "../src/tabs/sound";
import type { TabContext } from "../src/types";
import { cleanup, mountCard, newBar, settle, tabContext } from "./helpers";
import type { Mounted } from "./helpers";

const ID = {
  bass: "select.jbl_bar_9_1_bass_level",
  rear: "select.jbl_bar_9_1_rear_speakers",
  preset: "select.jbl_bar_9_1_front_eq_preset",
  band0: "number.jbl_bar_9_1_front_eq_125_hz",
  band4: "number.jbl_bar_9_1_front_eq_8_khz",
  bassOffset: "number.jbl_bar_9_1_bass_offset",
  audioSync: "number.jbl_bar_9_1_audio_sync",
};

const saved = { ...SOUND_TIMING };
beforeEach(() => {
  // No debounce in tests: a scheduled send runs on the next macrotask.
  Object.assign(SOUND_TIMING, { levelMs: 0, audioSyncMs: 0, eqMs: 0, bassOffsetMs: 0 });
});
afterEach(() => {
  Object.assign(SOUND_TIMING, saved);
  cleanup();
});

const mountMixer = (bar = newBar()): Promise<Mounted> => mountCard({ default_tab: "sound", layouts: { sound: "mixer" } }, bar);

const fader = (m: Mounted, id: string): HTMLInputElement => m.$(`#sound-mixer-${id}`) as HTMLInputElement;
const strip = (m: Mounted, id: string): HTMLElement => fader(m, id).closest(".sound-mixer-strip") as HTMLElement;
const valueOf = (m: Mounted, id: string): string | undefined => strip(m, id).querySelector(".sound-mixer-value")?.textContent?.trim();
const notes = (m: Mounted): string => (m.$(".sound-mixer-notes")?.textContent ?? "").replace(/\s+/g, " ");

function drag(input: HTMLInputElement, value: number | string, events: ("input" | "change")[] = ["input"]): void {
  input.value = String(value);
  for (const type of events) input.dispatchEvent(new Event(type));
}

function renderCtx(ctx: TabContext): HTMLElement {
  const host = document.createElement("div");
  render(renderSoundTab(ctx), host);
  return host;
}

describe("Sound mixer: console", () => {
  it("renders one row of faders: levels, a divider, the EQ bands and the bass offset", async () => {
    const m = await mountMixer();
    expect(m.$(".sound-mixer")).not.toBeNull();
    expect(m.$(".sound")).toBeNull();
    expect(m.$(".sound-mixer-note")).toBeNull();
    const ids = m.$$(".sound-mixer-console .sound-mixer-fader").map((f) => f.id);
    expect(ids).toEqual([
      "sound-mixer-bass",
      "sound-mixer-center",
      "sound-mixer-atmos",
      "sound-mixer-rear",
      "sound-mixer-band-0",
      "sound-mixer-band-1",
      "sound-mixer-band-2",
      "sound-mixer-band-3",
      "sound-mixer-band-4",
      "sound-mixer-offset",
    ]);
    expect(m.$$(".sound-mixer-divider")).toHaveLength(1);
    // Values on top, names under each fader.
    expect(valueOf(m, "bass")).toBe("3");
    expect(valueOf(m, "center")).toBe("2");
    expect(strip(m, "center").querySelector(".sound-mixer-sub")?.textContent).toBe("+2.4 dB");
    expect(valueOf(m, "atmos")).toBe("Mid");
    expect(valueOf(m, "rear")).toBe("High");
    expect(m.$$(".sound-mixer-name").map((n) => n.textContent?.trim()).filter(Boolean)).toEqual([
      "Bass",
      "Center",
      "Atmos",
      "Rear",
      "Hz",
      "125",
      "500",
      "2k",
      "4k",
      "8k",
      "Bass ±",
    ]);
    expect(m.$$(".sound-mixer-band .sound-mixer-fader").map((f) => (f as HTMLInputElement).value)).toEqual(["0", "0", "-1", "-2", "-3"]);
    expect(fader(m, "band-0").getAttribute("aria-label")).toBe("Front EQ 125 Hz");
    expect(fader(m, "atmos").getAttribute("aria-label")).toBe("Atmos height");
    expect(fader(m, "center").getAttribute("aria-valuetext")).toBe("2, +2.4 dB");
    // Numbers only on the strips: the units sit once in the scale column.
    expect(valueOf(m, "offset")).toBe("+0.5");
    expect(fader(m, "offset").getAttribute("aria-valuetext")).toBe("+0.5 dB");
    expect(m.$(".sound-mixer-scale .sound-mixer-value")?.textContent).toBe("dB");
    // Only the EQ status and audio sync announce changes; faders speak through aria-valuetext.
    expect(m.$$(".sound-mixer-value[aria-live]")).toHaveLength(0);
    expect(m.$(".sound-mixer-eq-status")?.getAttribute("aria-live")).toBe("polite");
    expect(strip(m, "offset").querySelector(".sound-mixer-badge")?.textContent).toBe("Active");
    // EQ status and preset above the EQ group, audio sync under the console.
    expect(m.$(".sound-mixer-eq .sound-mixer-eq-status")?.textContent).toBe("Active");
    expect(m.$(".sound-mixer-eq .sound-mixer-eq-status")?.classList.contains("ok")).toBe(true);
    expect((m.$(".sound-mixer-eq #sound-mixer-preset option[selected]") as HTMLOptionElement).value).toBe("warm");
    expect(m.$(".sound-mixer-sync .stepper-value")?.getAttribute("aria-live")).toBe("polite");
  });

  it("puts the bar's own position on the level scale and mute at the bottom of the rear fader", async () => {
    const m = await mountMixer();
    const rear = fader(m, "rear");
    expect(rear.max).toBe("3");
    expect(rear.value).toBe("3");
    drag(rear, 0, ["input", "change"]);
    await settle(m);
    expect(m.bar.calls.map((c) => [c.target?.entity_id, c.data])).toEqual([[ID.rear, { option: "muted" }]]);
    expect(valueOf(m, "rear")).toBe("Mute");
  });
});

describe("Sound mixer: levels", () => {
  it("previews a drag without sending, then sends only the released level", async () => {
    SOUND_TIMING.levelMs = 20;
    const m = await mountMixer();
    drag(fader(m, "bass"), 3);
    await m.card.updateComplete;
    expect(valueOf(m, "bass")).toBe("4");
    expect(strip(m, "bass").querySelector(".sound-mixer-value")?.classList.contains("is-dragging")).toBe(true);
    expect(fader(m, "bass").getAttribute("aria-valuetext")).toBe("4");
    // A drag that pauses longer than the debounce still sends nothing.
    await new Promise((resolve) => setTimeout(resolve, 40));
    await m.sync();
    expect(m.bar.calls).toHaveLength(0);
    expect(strip(m, "bass").classList.contains("is-pending")).toBe(false);
    expect(fader(m, "bass").value).toBe("3");
    drag(fader(m, "bass"), 4, ["input", "change"]);
    await m.card.updateComplete;
    expect(valueOf(m, "bass")).toBe("5");
    expect(strip(m, "bass").querySelector(".sound-mixer-value")?.classList.contains("is-dragging")).toBe(false);
    expect(strip(m, "bass").classList.contains("is-pending")).toBe(true);
    expect(strip(m, "bass").querySelector(".spinner")).not.toBeNull();
    expect(fader(m, "bass").getAttribute("aria-busy")).toBe("true");
    // The bar's own level stays marked on the scale while the new one is pending.
    const ticks = Array.from(strip(m, "bass").querySelectorAll(".sound-mixer-tick"));
    expect(ticks.findIndex((t) => t.classList.contains("on"))).toBe(2);
    expect(m.bar.calls).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 40));
    await settle(m);
    expect(m.bar.calls.map((c) => [c.service, c.data, c.target?.entity_id])).toEqual([["select_option", { option: "5" }, ID.bass]]);
    expect(valueOf(m, "bass")).toBe("5");
    expect(strip(m, "bass").classList.contains("is-pending")).toBe(false);
  });

  it("disables the rear fader while the rears are docked and writes the reason under the console", async () => {
    const bar = newBar();
    bar.docked = true;
    bar.update(() => undefined);
    const m = await mountMixer(bar);
    const rear = fader(m, "rear");
    expect(rear.disabled).toBe(true);
    expect(rear.getAttribute("aria-describedby")).toBe("sound-mixer-note-rear");
    expect(m.$("#sound-mixer-note-rear")?.textContent).toContain("Take both rear speakers off the soundbar");
    expect(strip(m, "rear").querySelector(".sound-mixer-lock")).not.toBeNull();
    bar.update((b) => (b.docked = false));
    await m.sync();
    expect(fader(m, "rear").disabled).toBe(false);
    expect(m.$("#sound-mixer-note-rear")).toBeNull();
  });

  it("lists the controls that are unavailable when the bar is unreachable", async () => {
    const bar = newBar();
    bar.reachable = false;
    bar.update(() => undefined);
    const m = await mountMixer(bar);
    expect(fader(m, "bass").disabled).toBe(true);
    expect(fader(m, "band-0").disabled).toBe(true);
    expect(fader(m, "offset").disabled).toBe(true);
    // One note per reason the model gives, linked from every fader it explains.
    const id = fader(m, "bass").getAttribute("aria-describedby");
    expect(id).toBe("sound-mixer-note-off-0");
    expect(fader(m, "band-0").getAttribute("aria-describedby")).toBe(id);
    expect(fader(m, "offset").getAttribute("aria-describedby")).toBe(id);
    // The whole EQ is out: it is named once, not band by band.
    expect(m.$(`#${id}`)?.textContent?.replace(/\s+/g, " ")).toContain(
      "Bass, Center, Atmos height, Rear speakers, Front EQ, Bass offset: The soundbar is unreachable.",
    );
    expect(notes(m)).not.toContain("125 Hz");
  });

  it("names unavailable bands with their group and the model's reason", () => {
    const ctx = tabContext(newBar(), { layouts: { sound: "mixer" } });
    const st = ctx.hass.states[ID.band4];
    ctx.hass.states[ID.band4] = { ...st, state: "unavailable" };
    const host = renderCtx(ctx);
    expect(host.querySelector("#sound-mixer-note-off-0")?.textContent?.replace(/\s+/g, " ")).toContain(
      "Front EQ 8 kHz: The soundbar does not report this setting right now.",
    );
    expect(host.querySelector("#sound-mixer-band-4")?.getAttribute("aria-describedby")).toBe("sound-mixer-note-off-0");
    expect(host.querySelector("#sound-mixer-band-3")?.hasAttribute("aria-describedby")).toBe(false);
  });

  it("drops a level preview that is dragged back onto the shown option", async () => {
    const m = await mountMixer();
    drag(fader(m, "bass"), 4);
    await m.card.updateComplete;
    expect(strip(m, "bass").querySelector(".sound-mixer-value")?.classList.contains("is-dragging")).toBe(true);
    // Back to the start: a range input fires no change, so the preview must not stick.
    drag(fader(m, "bass"), 2);
    await m.card.updateComplete;
    expect(valueOf(m, "bass")).toBe("3");
    expect(strip(m, "bass").querySelector(".sound-mixer-value")?.classList.contains("is-dragging")).toBe(false);
    await settle(m);
    expect(m.bar.calls).toHaveLength(0);
  });

  it("draws no cap while the level is unknown and still selects the bottom option on a click", async () => {
    const bar = newBar();
    bar.bass = -1;
    bar.update(() => undefined);
    const m = await mountMixer(bar);
    expect(valueOf(m, "bass")).toBe("—");
    expect(strip(m, "bass").classList.contains("is-unknown")).toBe(true);
    expect(fader(m, "bass").disabled).toBe(false);
    expect(fader(m, "bass").value).toBe("0");
    fader(m, "bass").click();
    await m.card.updateComplete;
    expect(strip(m, "bass").classList.contains("is-pending")).toBe(true);
    expect(valueOf(m, "bass")).toBe("1");
    expect(strip(m, "bass").classList.contains("is-unknown")).toBe(false);
  });
});

describe("Sound mixer: Front EQ", () => {
  it("previews a band while dragging and sends it on release, bands one after another", async () => {
    const bar = newBar();
    bar.delayMs = 10;
    const m = await mountMixer(bar);
    drag(fader(m, "band-0"), -4);
    await m.card.updateComplete;
    expect(valueOf(m, "band-0")).toBe("-4");
    expect(strip(m, "band-0").querySelector(".sound-mixer-value")?.classList.contains("is-dragging")).toBe(true);
    expect(bar.calls).toHaveLength(0);
    drag(fader(m, "band-0"), -4, ["change"]);
    drag(fader(m, "band-4"), -1.5, ["input", "change"]);
    await m.card.updateComplete;
    expect(strip(m, "band-4").classList.contains("is-pending")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await settle(m);
    expect(bar.calls.map((c) => [c.target?.entity_id, c.data.value])).toEqual([
      [ID.band0, -4],
      [ID.band4, -1.5],
    ]);
    expect(bar.gains).toEqual([-4, 0, -1, -2, -1.5]);
    expect(m.$("#sound-mixer-preset option[selected]")?.textContent?.trim()).toBe("Custom");
  });

  it("selects a preset and locks the bands with the reason while it applies", async () => {
    const bar = newBar();
    bar.delayMs = 20;
    const m = await mountMixer(bar);
    const select = m.$("#sound-mixer-preset") as HTMLSelectElement;
    select.value = "bright";
    select.dispatchEvent(new Event("change"));
    await m.card.updateComplete;
    expect(select.getAttribute("aria-busy")).toBe("true");
    expect(m.$(".sound-mixer-preset .spinner")).not.toBeNull();
    expect(fader(m, "band-2").disabled).toBe(true);
    expect(fader(m, "band-2").getAttribute("aria-describedby")).toBe("sound-mixer-note-preset");
    expect(m.$("#sound-mixer-note-preset")?.textContent).toContain("The preset is being applied. The EQ unlocks once it is set.");
    // The preset says why it ignores changes now; the general "unavailable" note is not used.
    expect(select.getAttribute("title")).toBe("The preset is being applied. The EQ unlocks once it is set.");
    expect(m.$("[id^='sound-mixer-note-off']")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await settle(m);
    expect(bar.calls.map((c) => [c.target?.entity_id, c.data])).toEqual([[ID.preset, { option: "bright" }]]);
    expect(bar.gains).toEqual([-3, -2, -1, 0, 0]);
    expect(fader(m, "band-2").disabled).toBe(false);
    expect(m.$("#sound-mixer-note-preset")).toBeNull();
  });

  it("shows Waiting with the reason in Smart mode", async () => {
    const bar = newBar();
    bar.smart = true;
    bar.update(() => undefined);
    const m = await mountMixer(bar);
    expect(m.$(".sound-mixer-eq-status")?.textContent).toBe("Waiting");
    expect(m.$(".sound-mixer-eq-status")?.classList.contains("warn")).toBe(true);
    expect(m.$("#sound-mixer-note-eq")?.textContent).toContain("Front EQ requires Standard Mode and active audio");
  });

  it("offers the reset next to its reason and resets through the original preset", async () => {
    const bar = newBar();
    bar.update((b) => (b.eqResetNeeded = true));
    const m = await mountMixer(bar);
    expect(m.$(".sound-mixer-eq-status.err")?.textContent).toBe("Reset needed");
    const reset = m.$("#sound-mixer-note-eq .sound-mixer-reset") as HTMLButtonElement;
    expect(reset.textContent?.trim()).toBe("Reset EQ");
    reset.click();
    await settle(m);
    expect(bar.calls.at(-1)).toMatchObject({ domain: "select", service: "select_option", data: { option: "original" } });
    expect(m.$(".sound-mixer-reset")).toBeNull();
    expect(m.$(".sound-mixer-eq-status")?.textContent).toBe("Off");
  });

  it("moves the bass offset fader in 0.5 dB steps and sends it on release", async () => {
    const m = await mountMixer();
    drag(fader(m, "offset"), 1.2);
    await settle(m);
    expect(m.bar.calls).toHaveLength(0);
    expect(valueOf(m, "offset")).toBe("+1");
    expect(fader(m, "offset").getAttribute("aria-valuetext")).toBe("+1 dB");
    drag(fader(m, "offset"), 1.2, ["change"]);
    await settle(m);
    expect(m.bar.calls.map((c) => [c.target?.entity_id, c.data])).toEqual([[ID.bassOffset, { value: 1 }]]);
    expect(m.bar.bassOffset).toBe(1);
    expect(valueOf(m, "offset")).toBe("+1");
  });

  it("writes the bass offset error under the console", () => {
    const ctx = tabContext(newBar(), { layouts: { sound: "mixer" } });
    const st = ctx.hass.states[ID.bassOffset];
    ctx.hass.states[ID.bassOffset] = { ...st, attributes: { ...st.attributes, error: "Bass offset needs Standard Mode" } };
    const host = renderCtx(ctx);
    expect(host.querySelector("#sound-mixer-note-offset")?.textContent).toContain("Bass offset needs Standard Mode");
    expect(host.querySelector("#sound-mixer-offset")?.getAttribute("aria-describedby")).toBe("sound-mixer-note-offset");
  });
});

describe("Sound mixer: scrolling console", () => {
  it("marks the side with hidden faders and the pinned EQ start for the edge fade", async () => {
    const m = await mountMixer();
    const con = m.$(".sound-mixer-console") as HTMLElement;
    const eq = m.$(".sound-mixer-eq") as HTMLElement;
    Object.defineProperty(con, "scrollWidth", { configurable: true, value: 628 });
    Object.defineProperty(con, "clientWidth", { configurable: true, value: 266 });
    Object.defineProperty(eq, "offsetLeft", { configurable: true, value: 254 });
    const scrollTo = (x: number): void => {
      Object.defineProperty(con, "scrollLeft", { configurable: true, value: x });
      con.dispatchEvent(new Event("scroll"));
    };
    scrollTo(0);
    expect(con.dataset.scroll).toBe("start");
    scrollTo(100);
    expect(con.dataset.scroll).toBe("mid");
    expect(con.hasAttribute("data-eq-stuck")).toBe(false);
    scrollTo(300);
    expect(con.hasAttribute("data-eq-stuck")).toBe(true);
    scrollTo(362);
    expect(con.dataset.scroll).toBe("end");
    // A re-render keeps the marks (they are not part of the template).
    await m.sync();
    expect(con.dataset.scroll).toBe("end");
  });
});

describe("Sound mixer: audio sync", () => {
  it("explains that audio sync needs TV or HDMI", async () => {
    const m = await mountMixer();
    expect(m.$(".sound-mixer-sync .stepper-value")?.textContent?.trim()).toBe("—");
    expect((m.$(".sound-mixer-sync-up") as HTMLButtonElement).disabled).toBe(true);
    expect(m.$(".sound-mixer-sync-hint")?.textContent).toBe("Audio sync works only with the TV or HDMI input.");
  });

  it("steps, sends one value and locks while the bar re-syncs", async () => {
    const bar = newBar();
    bar.source = "TV";
    bar.update(() => undefined);
    const m = await mountMixer(bar);
    expect(m.$(".sound-mixer-sync .stepper-value")?.textContent?.trim()).toBe("40 ms");
    SOUND_TIMING.audioSyncMs = 20;
    m.$(".sound-mixer-sync-up")!.click();
    await m.card.updateComplete;
    m.$(".sound-mixer-sync-up")!.click();
    await m.card.updateComplete;
    expect(m.$(".sound-mixer-sync .stepper-value")?.textContent?.trim()).toBe("60 ms");
    expect(m.$(".sound-mixer-sync .stepper")?.classList.contains("pending")).toBe(true);
    expect(bar.calls).toHaveLength(0);
    bar.delayMs = 30;
    await new Promise((resolve) => setTimeout(resolve, 30));
    await m.sync();
    expect((m.$(".sound-mixer-sync-up") as HTMLButtonElement).disabled).toBe(false);
    expect(m.$(".sound-mixer-sync-up")?.getAttribute("aria-disabled")).toBe("true");
    expect(m.$(".sound-mixer-sync-hint")?.textContent).toContain("re-syncing");
    await new Promise((resolve) => setTimeout(resolve, 150));
    await settle(m);
    expect(bar.calls.map((c) => [c.target?.entity_id, c.data])).toEqual([[ID.audioSync, { value: 60 }]]);
    expect(m.$(".sound-mixer-sync-up")?.getAttribute("aria-disabled")).toBe("false");
  });
});

describe("Sound mixer: missing entities and languages", () => {
  it("hides every block whose entity is missing", () => {
    const base = tabContext(newBar(), { layouts: { sound: "mixer" } });
    const ctx: TabContext = {
      ...base,
      entities: {
        ...base.entities,
        center: undefined,
        audio_sync: undefined,
        eq_preset: undefined,
        front_eq_status: undefined,
        bass_offset: undefined,
        eqBands: [base.entities.eqBands[0], undefined, undefined, undefined, undefined],
      },
    };
    const host = renderCtx(ctx);
    expect(host.querySelector("#sound-mixer-center")).toBeNull();
    expect(host.querySelector("#sound-mixer-bass")).not.toBeNull();
    expect(host.querySelector(".sound-mixer-sync")).toBeNull();
    expect(host.querySelector("#sound-mixer-preset")).toBeNull();
    expect(host.querySelector(".sound-mixer-eq-status")).toBeNull();
    expect(host.querySelector("#sound-mixer-offset")).toBeNull();
    expect(host.querySelectorAll(".sound-mixer-band")).toHaveLength(1);
  });

  it("shows only the levels, without a divider, when there is no EQ", () => {
    const base = tabContext(newBar(), { layouts: { sound: "mixer" } });
    const ctx: TabContext = {
      ...base,
      entities: { ...base.entities, eq_preset: undefined, front_eq_status: undefined, bass_offset: undefined, eqBands: [] },
    };
    const host = renderCtx(ctx);
    expect(host.querySelector(".sound-mixer-eq")).toBeNull();
    expect(host.querySelector(".sound-mixer-divider")).toBeNull();
    expect(host.querySelectorAll(".sound-mixer-level")).toHaveLength(4);
  });

  it("explains when there is nothing to show", () => {
    const base = tabContext(newBar(), { layouts: { sound: "mixer" } });
    const ctx: TabContext = {
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
    };
    const host = renderCtx(ctx);
    expect(host.querySelector(".sound-mixer-console")).toBeNull();
    expect(host.textContent).toContain("This soundbar does not report any sound settings.");
  });

  it("translates to Ukrainian and French", async () => {
    const uk = await mountMixer(newBar({ language: "uk" }));
    expect(uk.$$(".sound-mixer-level .sound-mixer-name").map((n) => n.textContent?.trim())).toEqual(["Баси", "Центр", "Atmos", "Задні"]);
    expect(uk.$(".sound-mixer-levels .section-title")?.textContent?.trim()).toBe("Рівні");
    expect(valueOf(uk, "offset")).toBe("+0,5");
    // "Середньо" does not fit a strip: a short form on top, the full label for screen readers.
    expect(valueOf(uk, "atmos")).toBe("Серед.");
    expect(fader(uk, "atmos").getAttribute("aria-valuetext")).toBe("Середньо");
    expect(uk.$$(".sound-mixer-band .sound-mixer-name").map((n) => n.textContent?.trim())).toEqual(["125", "500", "2к", "4к", "8к"]);
    cleanup();
    const fr = await mountMixer(newBar({ language: "fr" }));
    expect(fr.$(".sound-mixer-eq-status")?.textContent).toBe("Actif");
    expect(fr.$(".sound-mixer-console")?.getAttribute("aria-label")).toBe("Table de mixage");
  });
});
