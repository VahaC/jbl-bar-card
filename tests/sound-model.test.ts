import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTranslate } from "../src/i18n";
import { SOUND_KEYS, SOUND_TIMING, bandKey, soundModel } from "../src/tabs/sound-model";
import type { TabContext } from "../src/types";
import { cleanup, newBar, tabContext } from "./helpers";

const ID = {
  bass: "select.jbl_bar_9_1_bass_level",
  rearDocked: "binary_sensor.jbl_bar_9_1_rear_speakers_docked",
  eqStatus: "sensor.jbl_bar_9_1_front_eq_status",
  eqPreset: "select.jbl_bar_9_1_front_eq_preset",
  avSync: "number.jbl_bar_9_1_audio_sync",
  bassOffset: "number.jbl_bar_9_1_bass_offset",
  band125: "number.jbl_bar_9_1_front_eq_125_hz",
  band8k: "number.jbl_bar_9_1_front_eq_8_khz",
};

const saved = { ...SOUND_TIMING };
beforeEach(() => {
  Object.assign(SOUND_TIMING, { levelMs: 0, audioSyncMs: 0, eqMs: 0, bassOffsetMs: 0 });
});
afterEach(() => {
  Object.assign(SOUND_TIMING, saved);
  cleanup();
});

interface Fake {
  ctx: TabContext;
  /** Calls made through ctx.call, in order: [pending key, value]. */
  calls: [string, unknown][];
  pending: Map<string, unknown>;
  updates: () => number;
}

/** A real TabContext whose ctx.call only records (and can be held pending) instead of calling HA. */
function fake(base: TabContext = tabContext()): Fake {
  const pending = new Map<string, unknown>();
  const calls: [string, unknown][] = [];
  let updates = 0;
  const ctx: TabContext = {
    ...base,
    call: (key, _fn, opts) => {
      calls.push([key, opts?.value]);
      return Promise.resolve(true);
    },
    isPending: (key) => pending.has(key),
    pendingValue: <T>(key: string) => pending.get(key) as T | undefined,
    requestUpdate: () => {
      updates++;
    },
  };
  return { ctx, calls, pending, updates: () => updates };
}

const tick = (ms = 5): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function setState(ctx: TabContext, id: string, state: string, attributes: Record<string, unknown> = {}): void {
  const st = ctx.hass.states[id];
  ctx.hass.states[id] = { ...st, state, attributes: { ...st.attributes, ...attributes } };
}

describe("soundModel: levels", () => {
  it("lists the four levels in order with labels, the current option and the center gain", () => {
    const m = soundModel(tabContext());
    expect(m.levels.map((l) => l.role)).toEqual(["bass", "center", "atmos", "rear"]);
    const [bass, center, atmos, rear] = m.levels;
    expect(bass.key).toBe(SOUND_KEYS.bass);
    expect(bass.options.map((o) => o.label)).toEqual(["1", "2", "3", "4", "5"]);
    expect(bass.current).toBe("3");
    expect(bass.shownIndex).toBe(2);
    expect(bass.options.filter((o) => o.active).map((o) => o.value)).toEqual(["3"]);
    expect(center.options.map((o) => o.label)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(center.extra).toBe("+2.4 dB");
    expect(atmos.options.map((o) => o.label)).toEqual(["Low", "Mid", "High"]);
    expect(rear.options.at(-1)).toMatchObject({ value: "muted", label: "Mute" });
    expect(m.levels.every((l) => l.enabled && !l.pending && l.reason === undefined)).toBe(true);
    expect(m.empty).toBe(false);
  });

  it("blocks the rear level with a reason while the rears are docked or their dock state is unknown", () => {
    const ctx = tabContext();
    setState(ctx, ID.rearDocked, "on");
    let rear = soundModel(ctx).levels[3];
    expect(rear.enabled).toBe(false);
    expect(rear.reason).toContain("Take both rear speakers off");
    setState(ctx, ID.rearDocked, "unknown");
    rear = soundModel(ctx).levels[3];
    expect(rear.enabled).toBe(false);
    expect(rear.reason).toContain("does not say whether");
  });

  it("debounces a choice, marks it pending and sends only the latest", async () => {
    const f = fake();
    const bass = soundModel(f.ctx).levels[0];
    bass.choose("4");
    bass.choose("5");
    const again = soundModel(f.ctx).levels[0];
    expect(again.shown).toBe("5");
    expect(again.pending).toBe(true);
    expect(again.options.filter((o) => o.pending).map((o) => o.value)).toEqual(["5"]);
    expect(again.options.find((o) => o.active)?.value).toBe("3");
    await tick();
    expect(f.calls).toEqual([[SOUND_KEYS.bass, "5"]]);
  });

  it("ignores a choice of the option already shown", async () => {
    const f = fake();
    soundModel(f.ctx).levels[0].choose("3");
    await tick();
    expect(f.calls).toEqual([]);
    expect(f.updates()).toBe(0);
  });

  it("shows the pending value of a call on its way", () => {
    const f = fake();
    f.pending.set(SOUND_KEYS.center, "5");
    const center = soundModel(f.ctx).levels[1];
    expect(center.shown).toBe("5");
    expect(center.extra).toBe("+12 dB");
  });
});

describe("soundModel: audio sync", () => {
  it("is unknown with a hint on a source without audio sync", () => {
    const sync = soundModel(tabContext()).audioSync!;
    expect(sync.value).toBeUndefined();
    expect(sync.valueText).toBe("—");
    expect(sync.less.enabled).toBe(false);
    expect(sync.more.enabled).toBe(false);
    expect(sync.hint).toBe("Audio sync works only with the TV or HDMI input.");
    expect(sync.locked).toBe(false);
  });

  it("steps by the entity step, snaps set() to the grid and locks while sending", async () => {
    const bar = newBar();
    bar.source = "TV";
    bar.update(() => undefined);
    const f = fake(tabContext(bar));
    const sync = soundModel(f.ctx).audioSync!;
    expect(sync).toMatchObject({ value: 40, valueText: "40 ms", min: 0, max: 250, step: 10, pending: false });
    expect(sync.less.icon).toBe("mdi:minus");
    sync.more.run();
    expect(soundModel(f.ctx).audioSync!.value).toBe(50);
    soundModel(f.ctx).audioSync!.set(67);
    await tick();
    expect(f.calls).toEqual([[SOUND_KEYS.audioSync, 70]]);

    f.pending.set(SOUND_KEYS.audioSync, 70);
    const sending = soundModel(f.ctx).audioSync!;
    expect(sending.locked).toBe(true);
    expect(sending.pending).toBe(true);
    expect(sending.hint).toContain("re-syncing");
    // Still enabled (focusable), but input is ignored while the bar re-syncs.
    expect(sending.more.enabled).toBe(true);
    sending.more.run();
    await tick();
    expect(f.calls).toHaveLength(1);
  });

  it("disables a step at the range end", () => {
    const bar = newBar();
    bar.source = "TV";
    bar.update((b) => (b.avSync = 250));
    const sync = soundModel(tabContext(bar)).audioSync!;
    expect(sync.more.enabled).toBe(false);
    expect(sync.less.enabled).toBe(true);
  });
});

describe("soundModel: bass offset", () => {
  it("formats the value, carries the status and clamps set() to the range", async () => {
    const f = fake();
    const offset = soundModel(f.ctx).bassOffset!;
    expect(offset.valueText).toBe("+0.5 dB");
    expect(offset.status).toEqual({ value: "active", label: "Active", tone: "ok" });
    expect(offset.locked).toBeUndefined();
    offset.set(10);
    await tick();
    expect(f.calls).toEqual([[SOUND_KEYS.bassOffset, 3]]);
  });

  it("reports the bar's error", () => {
    const ctx = tabContext();
    setState(ctx, ID.bassOffset, "0.5", { error: "Bass offset needs Standard Mode" });
    expect(soundModel(ctx).bassOffset!.error).toBe("Bass offset needs Standard Mode");
  });
});

describe("soundModel: Front EQ", () => {
  it("gives the status badge, the preset and the bands", () => {
    const eq = soundModel(tabContext()).eq!;
    expect(eq.status).toEqual({ value: "active", label: "Active", tone: "ok" });
    expect(eq.preset).toMatchObject({ shown: "warm", placeholder: undefined, enabled: true, busy: false, reset: undefined });
    expect(eq.preset!.options.filter((o) => o.selected).map((o) => o.label)).toEqual(["Warm"]);
    expect(eq.bands.map((b) => b.label)).toEqual(["125 Hz", "500 Hz", "2 kHz", "4 kHz", "8 kHz"]);
    expect(eq.bands.map((b) => b.position)).toEqual([0, 0, -1, -2, -3]);
    expect(eq.bands[0]).toMatchObject({ key: bandKey(0), ariaLabel: "Front EQ 125 Hz", shortText: "0", valueText: "0 dB" });
  });

  it("offers a reset through the original preset when the EQ needs one", () => {
    const f = fake();
    setState(f.ctx, ID.eqStatus, "reset_needed", { reason: "reset EQ after the audio route changes" });
    const eq = soundModel(f.ctx).eq!;
    expect(eq.status?.tone).toBe("err");
    expect(eq.reason).toContain("reset EQ after");
    expect(eq.preset!.reset).toMatchObject({ label: "Reset EQ", enabled: true });
    eq.preset!.reset!.run();
    expect(f.calls).toEqual([[SOUND_KEYS.preset, "original"]]);
  });

  it("refuses a preset change that is the same, unknown, or made while busy", () => {
    const f = fake();
    const preset = soundModel(f.ctx).eq!.preset!;
    expect(preset.select("warm")).toBe(false);
    expect(preset.select("nope")).toBe(false);
    expect(preset.select("bright")).toBe(true);
    expect(f.calls).toEqual([[SOUND_KEYS.preset, "bright"]]);
    f.pending.set(SOUND_KEYS.preset, "bright");
    const busy = soundModel(f.ctx).eq!;
    expect(busy.preset).toMatchObject({ busy: true, pending: true, shown: "bright" });
    expect(busy.preset!.select("vocal_focus")).toBe(false);
    // Bands cannot move while a preset is applied.
    expect(busy.bands.every((b) => !b.enabled)).toBe(true);
  });

  it("shows Custom when no preset matches", () => {
    const ctx = tabContext();
    setState(ctx, ID.eqPreset, "unknown");
    const preset = soundModel(ctx).eq!.preset!;
    expect(preset.shown).toBeUndefined();
    expect(preset.placeholder).toBe("Custom");
  });

  it("previews a dragged band without sending, then sends the snapped values band by band", async () => {
    const f = fake();
    const bands = soundModel(f.ctx).eq!.bands;
    bands[0].preview(-4.2);
    expect(f.updates()).toBe(1);
    const dragging = soundModel(f.ctx).eq!.bands[0];
    expect(dragging).toMatchObject({ dragging: true, value: -4.2, shortText: "-4.2" });
    expect(f.calls).toEqual([]);
    dragging.commit(-4.2);
    soundModel(f.ctx).eq!.bands[4].commit(-1.4);
    const queued = soundModel(f.ctx).eq!;
    expect(queued.bands[0]).toMatchObject({ dragging: false, value: -4, pending: true });
    expect(queued.preset!.busy).toBe(true);
    await tick();
    expect(f.calls).toEqual([
      [bandKey(0), -4],
      [bandKey(4), -1.5],
    ]);
  });

  it("does not send a band dropped back on its current value", async () => {
    const f = fake();
    const band = soundModel(f.ctx).eq!.bands[2];
    band.preview(-3);
    soundModel(f.ctx).eq!.bands[2].commit(-1);
    await tick();
    expect(f.calls).toEqual([]);
    expect(soundModel(f.ctx).eq!.bands[2].dragging).toBe(false);
  });
});

describe("soundModel: reasons for disabled controls", () => {
  it("says why every control is disabled while the bar is unreachable", () => {
    const bar = newBar();
    bar.reachable = false;
    bar.update(() => undefined);
    const m = soundModel(tabContext(bar));
    const unreachable = "The soundbar is unreachable.";
    for (const level of m.levels) expect(level).toMatchObject({ enabled: false, reason: unreachable, reasonKind: "unreachable" });
    expect(m.bassOffset).toMatchObject({ enabled: false, reason: unreachable, reasonKind: "unreachable", shortText: "—" });
    expect(m.bassOffset!.less.reason).toBe(unreachable);
    expect(m.audioSync).toMatchObject({ enabled: false, reason: unreachable, reasonKind: "unreachable", hint: undefined });
    expect(m.eq!.preset).toMatchObject({ enabled: false, reason: unreachable, reasonKind: "unreachable" });
    expect(m.eq!.bands.every((b) => !b.enabled && b.reason === unreachable && b.reasonKind === "unreachable")).toBe(true);
    expect(m.eq).toMatchObject({ bandsReason: unreachable, bandsReasonKind: "unreachable", pending: false });
  });

  it("tells standby from a setting the bar does not report while it is on", () => {
    const ctx = tabContext();
    setState(ctx, ID.bass, "unavailable");
    expect(soundModel(ctx).levels[0]).toMatchObject({
      enabled: false,
      reason: "The soundbar does not report this setting right now.",
      reasonKind: "unavailable",
    });
    const off = soundModel({ ...ctx, barOn: false });
    expect(off.levels[0]).toMatchObject({ reason: "Turn the soundbar on to change this.", reasonKind: "standby" });
    expect(off.audioSync).toMatchObject({ enabled: false, reason: "Turn the soundbar on to adjust audio sync.", reasonKind: "standby" });
    // Enabled controls carry no reason; the docked rears keep their own one.
    expect(off.levels[1].reason).toBeUndefined();
    setState(ctx, ID.rearDocked, "on");
    expect(soundModel(ctx).levels[3].reasonKind).toBe("blocked");
  });

  it("names one band that is unavailable without a shared EQ reason", () => {
    const ctx = tabContext();
    setState(ctx, ID.band8k, "unavailable");
    const eq = soundModel(ctx).eq!;
    expect(eq.bands[4]).toMatchObject({ enabled: false, reasonKind: "unavailable" });
    expect(eq.bands[0].reason).toBeUndefined();
    expect(eq.bandsReason).toBeUndefined();
  });

  it("locks the bands with a reason while a preset applies, and says why the preset is busy", () => {
    const f = fake();
    f.pending.set(SOUND_KEYS.preset, "bright");
    const eq = soundModel(f.ctx).eq!;
    const applying = "The preset is being applied. The EQ unlocks once it is set.";
    expect(eq.bands.every((b) => b.reason === applying && b.reasonKind === "busy")).toBe(true);
    expect(eq).toMatchObject({ bandsReason: applying, bandsReasonKind: "busy", pending: true });
    expect(eq.preset).toMatchObject({ busy: true, busyReason: applying, reason: undefined });

    f.pending.clear();
    f.pending.set(bandKey(1), -2);
    const sending = soundModel(f.ctx).eq!;
    expect(sending.pending).toBe(true);
    expect(sending.preset!.busyReason).toBe("The EQ bands are still being sent. Pick a preset once they are set.");
    expect(sending.bandsReason).toBeUndefined();
  });
});

describe("soundModel: drag previews", () => {
  it("previews a level, follows it in the center gain, and sends only on commit", async () => {
    const f = fake();
    soundModel(f.ctx).levels[1].preview("5");
    const dragged = soundModel(f.ctx).levels[1];
    expect(dragged).toMatchObject({ dragging: true, shown: "5", shownIndex: 5, extra: "+12 dB", pending: false });
    await tick();
    expect(f.calls).toEqual([]);
    dragged.commit("4");
    const committed = soundModel(f.ctx).levels[1];
    expect(committed).toMatchObject({ dragging: false, shown: "4", pending: true });
    await tick();
    expect(f.calls).toEqual([[SOUND_KEYS.center, "4"]]);
  });

  it("drops a level preview on cancel or when dragged back, and sends nothing", async () => {
    const f = fake();
    soundModel(f.ctx).levels[0].preview("5");
    soundModel(f.ctx).levels[0].cancel();
    expect(soundModel(f.ctx).levels[0]).toMatchObject({ dragging: false, shown: "3" });
    soundModel(f.ctx).levels[0].preview("4");
    soundModel(f.ctx).levels[0].preview("3");
    expect(soundModel(f.ctx).levels[0].dragging).toBe(false);
    soundModel(f.ctx).levels[0].commit("3");
    await tick();
    expect(f.calls).toEqual([]);
  });

  it("ignores a level preview while the level is blocked", () => {
    const f = fake();
    setState(f.ctx, ID.rearDocked, "on");
    soundModel(f.ctx).levels[3].preview("low");
    expect(soundModel(f.ctx).levels[3].dragging).toBe(false);
    expect(f.updates()).toBe(0);
  });

  it("previews the bass offset snapped, with a number-only text, then sends on commit", async () => {
    const f = fake();
    const offset = soundModel(f.ctx).bassOffset!;
    expect(offset).toMatchObject({ enabled: true, shortText: "+0.5", reason: undefined });
    offset.preview(-1.2);
    const dragged = soundModel(f.ctx).bassOffset!;
    expect(dragged).toMatchObject({ dragging: true, value: -1, shortText: "-1", valueText: "-1 dB", pending: false });
    dragged.commit(-1.2);
    await tick();
    expect(f.calls).toEqual([[SOUND_KEYS.bassOffset, -1]]);
    expect(soundModel(f.ctx).bassOffset!.dragging).toBe(false);
  });

  it("cancels a stepper preview without sending, and ignores a preview while audio sync is locked", async () => {
    const f = fake();
    soundModel(f.ctx).bassOffset!.preview(2);
    soundModel(f.ctx).bassOffset!.cancel();
    expect(soundModel(f.ctx).bassOffset).toMatchObject({ dragging: false, value: 0.5 });

    const bar = newBar();
    bar.source = "TV";
    bar.update(() => undefined);
    const g = fake(tabContext(bar));
    expect(soundModel(g.ctx).audioSync).toMatchObject({ enabled: true, shortText: "40", reason: undefined });
    g.pending.set(SOUND_KEYS.audioSync, 70);
    soundModel(g.ctx).audioSync!.preview(100);
    expect(soundModel(g.ctx).audioSync!.dragging).toBe(false);
    await tick();
    expect([...f.calls, ...g.calls]).toEqual([]);
  });

  it("cancels a band drag without sending", async () => {
    const f = fake();
    soundModel(f.ctx).eq!.bands[0].preview(-3);
    expect(soundModel(f.ctx).eq!.bands[0].dragging).toBe(true);
    soundModel(f.ctx).eq!.bands[0].cancel();
    expect(soundModel(f.ctx).eq!.bands[0]).toMatchObject({ dragging: false, value: 0, pending: false });
    await tick();
    expect(f.calls).toEqual([]);
  });

  it("drops a band preview once a preset starts applying", () => {
    const f = fake();
    soundModel(f.ctx).eq!.bands[2].preview(-4);
    f.pending.set(SOUND_KEYS.preset, "bright");
    expect(soundModel(f.ctx).eq!.bands[2].dragging).toBe(false);
    f.pending.clear();
    expect(soundModel(f.ctx).eq!.bands[2]).toMatchObject({ dragging: false, value: -1 });
  });
});

describe("soundModel: short option labels", () => {
  it("shortens only the labels too long for a narrow strip", () => {
    const en = soundModel(tabContext()).levels;
    expect(en[2].options.map((o) => o.shortLabel)).toEqual(["Low", "Mid", "High"]);
    expect(en[1].options.map((o) => o.shortLabel)).toEqual(["1", "2", "3", "4", "5", "6"]);
    const uk = soundModel({ ...tabContext(), t: makeTranslate("uk") }).levels;
    expect(uk[2].options.find((o) => o.value === "mid")).toMatchObject({ label: "Середньо", shortLabel: "Серед." });
    expect(uk[3].options.find((o) => o.value === "mid")?.shortLabel).toBe("Серед.");
    expect(uk[3].options.find((o) => o.value === "high")?.shortLabel).toBe("Гучно");
    const fr = soundModel({ ...tabContext(), t: makeTranslate("fr") }).levels;
    expect(fr[2].options.find((o) => o.value === "mid")?.shortLabel).toBe("Moy.");
  });
});

describe("soundModel: missing entities", () => {
  it("leaves out what does not exist and keeps the bass offset outside a missing EQ", () => {
    const base = tabContext();
    const m = soundModel({
      ...base,
      entities: {
        ...base.entities,
        center: undefined,
        audio_sync: undefined,
        eq_preset: undefined,
        front_eq_status: undefined,
        eqBands: [],
      },
    });
    expect(m.levels.map((l) => l.role)).toEqual(["bass", "atmos", "rear"]);
    expect(m.audioSync).toBeUndefined();
    expect(m.eq).toBeUndefined();
    expect(m.bassOffset?.entity).toBe(ID.bassOffset);
    expect(m.empty).toBe(false);
  });

  it("is empty when the bar reports no sound setting", () => {
    const base = tabContext();
    const m = soundModel({
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
    expect(m.empty).toBe(true);
    expect(m.emptyText).toBe("This soundbar does not report any sound settings.");
  });
});
