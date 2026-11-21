import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "lit";
import { SOUND_TIMING, renderSoundTab, snapToStep } from "../src/tabs/sound";
import type { TabContext } from "../src/types";
import { cleanup, mountCard, newBar, settle, tabContext } from "./helpers";
import type { Mounted } from "./helpers";

const ID = {
  bass: "select.jbl_bar_9_1_bass_level",
  eqStatus: "sensor.jbl_bar_9_1_front_eq_status",
  bassOffset: "number.jbl_bar_9_1_bass_offset",
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

const mountSound = (bar = newBar()): Promise<Mounted> => mountCard({ default_tab: "sound" }, bar);
const seg = (m: Mounted, role: string): HTMLButtonElement[] =>
  m.$$(`.level-${role} .seg button`) as HTMLButtonElement[];
const active = (m: Mounted, role: string): string | undefined =>
  m.$(`.level-${role} .seg button.active`)?.textContent?.trim();

/** The preset option the card marks as selected (happy-dom does not track `selected` attributes into select.value). */
const presetShown = (m: Mounted): string | undefined =>
  (m.$(".eq-preset select option[selected]") as HTMLOptionElement | null)?.value;

function renderCtx(ctx: TabContext): HTMLElement {
  const host = document.createElement("div");
  render(renderSoundTab(ctx), host);
  return host;
}

describe("Sound tab: levels", () => {
  it("shows bass, center, atmos and rear with the current option", async () => {
    const m = await mountSound();
    expect(seg(m, "bass").map((b) => b.textContent?.trim())).toEqual(["1", "2", "3", "4", "5"]);
    expect(active(m, "bass")).toBe("3");
    expect(seg(m, "center").map((b) => b.textContent?.trim())).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(active(m, "center")).toBe("2");
    expect(m.$(".level-center .level-extra")?.textContent).toBe("+2.4 dB");
    expect(seg(m, "atmos").map((b) => b.textContent?.trim())).toEqual(["Low", "Mid", "High"]);
    expect(active(m, "atmos")).toBe("Mid");
    expect(seg(m, "rear").map((b) => b.textContent?.trim())).toEqual(["Low", "Mid", "High", "Mute"]);
    expect(active(m, "rear")).toBe("High");
    expect(seg(m, "rear").some((b) => b.disabled)).toBe(false);
  });

  it("sends only the last of quick clicks and marks the target pending", async () => {
    const m = await mountSound();
    seg(m, "bass")[3].click();
    seg(m, "bass")[4].click();
    await m.card.updateComplete;
    expect(seg(m, "bass")[4].classList.contains("pending")).toBe(true);
    expect(seg(m, "bass")[3].classList.contains("pending")).toBe(false);
    await settle(m);
    expect(m.bar.calls.map((c) => [c.service, c.data, c.target?.entity_id])).toEqual([
      ["select_option", { option: "5" }, ID.bass],
    ]);
    expect(active(m, "bass")).toBe("5");
    expect(seg(m, "bass")[4].classList.contains("pending")).toBe(false);
  });

  it("sends nothing when the user clicks back to the current level before the debounce ends", async () => {
    SOUND_TIMING.levelMs = 20;
    const m = await mountSound();
    seg(m, "atmos")[2].click();
    await m.card.updateComplete;
    seg(m, "atmos")[1].click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    await settle(m);
    expect(m.bar.calls).toHaveLength(0);
    expect(active(m, "atmos")).toBe("Mid");
  });

  it("sends a level chosen while another is on its way after it", async () => {
    const bar = newBar();
    bar.delayMs = 20;
    const m = await mountSound(bar);
    seg(m, "center")[3].click();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await m.sync();
    seg(m, "center")[5].click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await settle(m);
    expect(bar.calls.map((c) => c.data.option)).toEqual(["3", "5"]);
    expect(active(m, "center")).toBe("6");
    expect(m.$(".level-center .level-extra")?.textContent).toBe("+12 dB");
  });

  it("disables the rear level while the rears are docked, with the reason", async () => {
    const bar = newBar();
    bar.docked = true;
    bar.update(() => undefined);
    const m = await mountSound(bar);
    expect(seg(m, "rear").every((b) => b.disabled)).toBe(true);
    expect(m.$(".level-rear .hint")?.textContent).toContain("Take both rear speakers off the soundbar");
    bar.update((b) => (b.docked = false));
    await m.sync();
    expect(seg(m, "rear").some((b) => b.disabled)).toBe(false);
    expect(m.$(".level-rear .hint")).toBeNull();
  });

  it("disables the rear level while the dock state is unknown", () => {
    const ctx = tabContext();
    const docked = ctx.entities.rear_docked!;
    ctx.hass.states[docked] = { ...ctx.hass.states[docked], state: "unknown" };
    const host = renderCtx(ctx);
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>(".level-rear .seg button"));
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(host.querySelector(".level-rear .hint")?.textContent).toContain("does not say whether");
  });
});

describe("Sound tab: audio sync", () => {
  it("explains that audio sync needs TV or HDMI", async () => {
    const m = await mountSound();
    expect(m.$(".audio-sync .stepper-value")?.textContent?.trim()).toBe("—");
    expect((m.$(".sync-up") as HTMLButtonElement).disabled).toBe(true);
    expect(m.$(".audio-sync .hint")?.textContent).toBe("Audio sync works only with the TV or HDMI input.");
  });

  it("steps in 10 ms, sends one value and locks while the bar re-syncs", async () => {
    const bar = newBar();
    bar.source = "TV";
    bar.update(() => undefined);
    const m = await mountSound(bar);
    expect(m.$(".audio-sync .stepper-value")?.textContent?.trim()).toBe("40 ms");
    SOUND_TIMING.audioSyncMs = 20;
    m.$(".sync-up")!.click();
    await m.card.updateComplete;
    m.$(".sync-up")!.click();
    await m.card.updateComplete;
    expect(m.$(".audio-sync .stepper-value")?.textContent?.trim()).toBe("60 ms");
    expect(bar.calls).toHaveLength(0);
    bar.delayMs = 30;
    await new Promise((resolve) => setTimeout(resolve, 30));
    await m.sync();
    // Locked but still focusable: aria-disabled, and clicks are ignored.
    expect((m.$(".sync-up") as HTMLButtonElement).disabled).toBe(false);
    expect(m.$(".sync-up")?.getAttribute("aria-disabled")).toBe("true");
    m.$(".sync-up")!.click();
    expect(m.$(".audio-sync .hint")?.textContent).toContain("re-syncing");
    await new Promise((resolve) => setTimeout(resolve, 150));
    await settle(m);
    expect(bar.calls.map((c) => [c.service, c.data])).toEqual([["set_value", { value: 60 }]]);
    expect(bar.avSync).toBe(60);
    expect(m.$(".sync-up")?.getAttribute("aria-disabled")).toBe("false");
  });

  it("stops at the range ends", () => {
    expect(snapToStep(-10, 0, 250, 10)).toBe(0);
    expect(snapToStep(260, 0, 250, 10)).toBe(250);
    expect(snapToStep(-0.75, -3, 3, 0.5)).toBe(-0.5);
  });
});

describe("Sound tab: Front EQ", () => {
  it("shows the status badge, the preset and the five bands", async () => {
    const m = await mountSound();
    expect(m.$(".eq-status")?.textContent).toBe("Active");
    expect(m.$(".eq-status")?.classList.contains("ok")).toBe(true);
    expect(presetShown(m)).toBe("warm");
    const sliders = m.$$(".eq-slider") as HTMLInputElement[];
    expect(sliders.map((s) => s.value)).toEqual(["0", "0", "-1", "-2", "-3"]);
    expect(m.$$(".eq-freq").map((e) => e.textContent)).toEqual(["125 Hz", "500 Hz", "2 kHz", "4 kHz", "8 kHz"]);
    expect(sliders[0].getAttribute("aria-label")).toBe("Front EQ 125 Hz");
  });

  it("selects a preset", async () => {
    const m = await mountSound();
    const select = m.$(".eq-preset select") as HTMLSelectElement;
    select.value = "bright";
    select.dispatchEvent(new Event("change"));
    await settle(m);
    expect(m.bar.calls.map((c) => [c.service, c.data])).toEqual([["select_option", { option: "bright" }]]);
    expect(m.bar.gains).toEqual([-3, -2, -1, 0, 0]);
    expect(presetShown(m)).toBe("bright");
  });

  it("sends band edits one after another and shows Custom for a curve that is no preset", async () => {
    const bar = newBar();
    bar.delayMs = 10;
    const m = await mountSound(bar);
    const sliders = m.$$(".eq-slider") as HTMLInputElement[];
    sliders[0].value = "-4";
    sliders[0].dispatchEvent(new Event("input"));
    await m.card.updateComplete;
    expect(m.$$(".eq-value")[0].textContent).toBe("-4");
    sliders[0].dispatchEvent(new Event("change"));
    sliders[4].value = "-1.5";
    sliders[4].dispatchEvent(new Event("change"));
    await m.card.updateComplete;
    expect(m.$$(".eq-band")[4].classList.contains("pending")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await settle(m);
    expect(bar.calls.map((c) => [c.target?.entity_id, c.data.value])).toEqual([
      ["number.jbl_bar_9_1_front_eq_125_hz", -4],
      ["number.jbl_bar_9_1_front_eq_8_khz", -1.5],
    ]);
    expect(bar.gains).toEqual([-4, 0, -1, -2, -1.5]);
    expect(presetShown(m)).toBe("");
    expect(m.$(".eq-preset select option[selected]")?.textContent?.trim()).toBe("Custom");
  });

  it("shows Waiting with the reason in Smart mode", async () => {
    const bar = newBar();
    bar.smart = true;
    bar.update(() => undefined);
    const m = await mountSound(bar);
    expect(m.$(".eq-status")?.textContent).toBe("Waiting");
    expect(m.$(".eq-status")?.classList.contains("warn")).toBe(true);
    expect(m.$(".eq-reason")?.textContent).toBe("Front EQ requires Standard Mode and active audio");
  });

  it("offers a reset when the EQ needs one", async () => {
    const ctx = tabContext();
    const st = ctx.hass.states[ID.eqStatus];
    ctx.hass.states[ID.eqStatus] = {
      ...st,
      state: "reset_needed",
      attributes: { ...st.attributes, reason: "reset EQ after the audio route or sound settings change" },
    };
    const host = renderCtx(ctx);
    expect(host.querySelector(".eq-status")?.textContent).toBe("Reset needed");
    expect(host.querySelector(".eq-reason")?.textContent).toContain("reset EQ after");
    expect(host.querySelector(".eq-reset")?.textContent?.trim()).toBe("Reset EQ");
  });

  it("resets the EQ through the original preset and clears the status", async () => {
    const bar = newBar();
    bar.update((b) => (b.eqResetNeeded = true));
    const m = await mountSound(bar);
    expect(m.$(".eq-status.err")?.textContent).toBe("Reset needed");
    (m.$(".eq-reset") as HTMLButtonElement).click();
    await settle(m);
    expect(bar.calls.at(-1)).toMatchObject({
      domain: "select",
      service: "select_option",
      data: { option: "original" },
    });
    expect(m.$(".eq-reset")).toBeNull();
    expect(m.$(".eq-status")?.textContent).toBe("Off");
  });
});

describe("Sound tab: bass offset", () => {
  it("shows the offset with its status and steps by 0.5 dB", async () => {
    const m = await mountSound();
    expect(m.$(".bass-offset .stepper-value")?.textContent?.trim()).toBe("+0.5 dB");
    expect(m.$(".offset-status")?.textContent).toBe("Active");
    m.$(".offset-up")!.click();
    await settle(m);
    expect(m.bar.calls.map((c) => [c.target?.entity_id, c.data])).toEqual([[ID.bassOffset, { value: 1 }]]);
    expect(m.bar.bassOffset).toBe(1);
    expect(m.$(".bass-offset .stepper-value")?.textContent?.trim()).toBe("+1 dB");
  });

  it("shows the error the bar reports", () => {
    const ctx = tabContext();
    const st = ctx.hass.states[ID.bassOffset];
    ctx.hass.states[ID.bassOffset] = { ...st, attributes: { ...st.attributes, error: "Bass offset needs Standard Mode" } };
    const host = renderCtx(ctx);
    expect(host.querySelector(".offset-error")?.textContent).toBe("Bass offset needs Standard Mode");
  });
});

describe("Sound tab: missing entities and languages", () => {
  it("hides every block whose entity is missing", () => {
    const base = tabContext();
    const ctx: TabContext = {
      ...base,
      entities: {
        ...base.entities,
        center: undefined,
        audio_sync: undefined,
        eq_preset: undefined,
        front_eq_status: undefined,
        eqBands: [base.entities.eqBands[0], undefined, undefined, undefined, undefined],
      },
    };
    const host = renderCtx(ctx);
    expect(host.querySelector(".level-center")).toBeNull();
    expect(host.querySelector(".audio-sync")).toBeNull();
    expect(host.querySelector(".eq-preset")).toBeNull();
    expect(host.querySelector(".eq-status")).toBeNull();
    expect(host.querySelectorAll(".eq-slider")).toHaveLength(1);
    expect(host.querySelector(".level-bass")).not.toBeNull();
  });

  it("explains when there is nothing to show", () => {
    const base = tabContext();
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
    expect(renderCtx(ctx).textContent).toContain("This soundbar does not report any sound settings.");
  });

  it("translates to Ukrainian and French", async () => {
    const uk = await mountSound(newBar({ language: "uk" }));
    expect(uk.text()).toContain("Висота Atmos");
    expect(uk.text()).toContain("Фронтальний еквалайзер");
    expect(uk.$(".bass-offset .stepper-value")?.textContent?.trim()).toBe("+0,5 дБ");
    cleanup();
    const fr = await mountSound(newBar({ language: "fr" }));
    expect(fr.text()).toContain("Enceintes arrière");
    expect(fr.$(".eq-status")?.textContent).toBe("Actif");
  });
});
