import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LONG_PRESS_MS,
  MAX_TIMERS,
  RECENT_SLOT_GUARD_MS,
  TIMERS_KEYS,
  TIMERS_LOCAL_KEY,
  initTimersLocal,
  timersModel,
} from "../src/tabs/timers-model";
import type { TimersLocal } from "../src/tabs/timers-model";
import type { CallOptions, TabContext } from "../src/types";
import type { MockBar } from "../demo/mock-hass";
import { NOW, cleanup, newBar, tabContext } from "./helpers";

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

interface Harness {
  ctx: TabContext;
  bar: MockBar;
  local: TimersLocal;
  /** Every ctx.call: key, options; the service function runs against the mock bar. */
  calls: { key: string; opts?: CallOptions }[];
  errors: { message: string; key?: string }[];
  confirms: number;
}

/** A context whose call() runs the service on the mock bar and records the call. */
function harness(options: { bar?: MockBar; patch?: Partial<TabContext>; local?: Partial<TimersLocal>; confirm?: boolean } = {}): Harness {
  const bar = options.bar ?? newBar();
  const base = tabContext(bar, { default_tab: "timers" });
  const h: Harness = { ctx: base, bar, local: initTimersLocal(), calls: [], errors: [], confirms: 0 };
  h.local = base.local<TimersLocal>(TIMERS_LOCAL_KEY, initTimersLocal);
  Object.assign(h.local, options.local);
  h.ctx = {
    ...base,
    call: async (key, fn, opts) => {
      h.calls.push({ key, opts });
      try {
        await fn();
        return true;
      } catch (err) {
        opts?.onError?.(err);
        return false;
      }
    },
    showError: (message, key) => void h.errors.push({ message, key }),
    confirm: async () => {
      h.confirms++;
      return options.confirm ?? true;
    },
    requestUpdate: () => undefined,
    ...options.patch,
  };
  return h;
}

/** Let the mock bar apply a command (it reports the change a few ticks after the call). */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 5));
};

describe("timers model: sections", () => {
  it("leaves out the blocks whose entities are missing", () => {
    const { ctx } = harness();
    const model = timersModel({ ...ctx, entities: { ...ctx.entities, timers: undefined, display_clock: undefined } });
    expect(model.timers).toBeUndefined();
    expect(model.clock).toBeUndefined();
    expect(model.messages).toBeDefined();
  });

  it("describes running and ringing timers", () => {
    const { timers } = timersModel(harness().ctx);
    expect(timers?.available).toBe(true);
    const [tea, pizza, unnamed] = timers!.timers;
    expect(tea).toMatchObject({ name: "TEA", ringing: true, ringingText: "Time's up!", progressTotal: null, endsAtLabel: undefined });
    expect(tea.cancel).toMatchObject({ key: TIMERS_KEYS.cancel + "t1", label: "Stop", ariaLabel: "Stop TEA", icon: "mdi:stop", enabled: true });
    expect(tea.extend).toBeUndefined();

    expect(pizza).toMatchObject({ name: "PIZZA", progressTotal: 900, endsAt: NOW + 432000 });
    expect(pizza.endsAtLabel).toContain("ends at");
    expect(pizza.sound).toEqual({ value: "unless_tv", icon: "mdi:television-off", label: "Rings unless you're watching TV" });
    expect(pizza.countdownOnBar?.label).toBe("Time left shown on the bar");
    expect(pizza.cancel).toMatchObject({ ariaLabel: "Cancel PIZZA", icon: "mdi:close" });
    expect(pizza.extend).toMatchObject({ key: TIMERS_KEYS.extend + "t2", label: "+1 min", ariaLabel: "Add 1 minute to PIZZA" });

    expect(unnamed.name).toBe("Timer");
    expect(unnamed.sound.icon).toBe("mdi:volume-off");
    expect(unnamed.countdownOnBar).toBeUndefined();
  });

  it("offers +1 min and progress only when the remote reports the duration", () => {
    const { ctx } = harness();
    const id = ctx.entities.timers!;
    const st = ctx.hass.states[id];
    const list = (st.attributes.timers as Record<string, unknown>[]).map((x) => ({ ...x, duration_s: null }));
    const patched = { ...st, attributes: { ...st.attributes, timers: list } };
    const model = timersModel({ ...ctx, stateOf: (x) => (x === id ? patched : ctx.stateOf(x)) });
    expect(model.timers!.timers.every((x) => x.extend === undefined && x.progressTotal === null)).toBe(true);
  });

  it("disables bar actions with a reason while the bar is unreachable, but not forget", () => {
    const { ctx } = harness();
    const model = timersModel({ ...ctx, barUnavailable: true });
    const timers = model.timers!;
    expect(timers.stopAll).toMatchObject({ enabled: false, reason: "The soundbar is unreachable." });
    expect(timers.timers[1].cancel.enabled).toBe(false);
    expect(timers.start!.quick.every((q) => !q.enabled)).toBe(true);
    expect(timers.recent!.chips[0].restart.enabled).toBe(false);
    expect(timers.recent!.chips[0].forget.enabled).toBe(true);
    expect(model.messages!.compose!.send).toMatchObject({ enabled: false, reason: "The soundbar is unreachable." });
  });

  it("hides the list, start and recent items when the sensor is unavailable", () => {
    const bar = newBar();
    bar.reachable = false;
    bar.update(() => undefined);
    const { timers, messages } = timersModel(harness({ bar }).ctx);
    expect(timers).toMatchObject({ available: false, start: undefined, recent: undefined });
    expect(timers!.unavailableText).toContain("unreachable");
    expect(messages!.compose).toBeUndefined();
  });
});

describe("timers model: actions", () => {
  it("stops a timer by id and stop all asks first", async () => {
    const h = harness();
    const model = timersModel(h.ctx);
    model.timers!.timers[0].cancel.run();
    await flush();
    expect(h.calls[0].key).toBe("timers.cancel.t1");
    expect(h.bar.calls.at(-1)).toMatchObject({ service: "timer_cancel", data: { id: "t1" } });

    model.timers!.stopAll!.run();
    await flush();
    expect(h.confirms).toBe(1);
    expect(h.calls.at(-1)?.key).toBe(TIMERS_KEYS.stopAll);
    expect(h.bar.calls.at(-1)).toMatchObject({ service: "timer_cancel", data: { all: true } });
  });

  it("does not stop all when the user says no", async () => {
    const h = harness({ confirm: false });
    timersModel(h.ctx).timers!.stopAll!.run();
    await flush();
    expect(h.calls).toHaveLength(0);
  });

  it("extends with the old end time as the pending value and waits for a new one", async () => {
    const h = harness();
    timersModel(h.ctx).timers!.timers[1].extend!.run();
    await flush();
    const { opts } = h.calls[0];
    expect(opts?.value).toBe(NOW + 432000);
    expect(opts?.until?.(h.bar.hass())).toBe(true);
  });

  it("offers stop all only with more than one timer", () => {
    const bar = newBar();
    bar.update((b) => (b.timers = b.timers.slice(0, 1)));
    expect(timersModel(harness({ bar }).ctx).timers!.stopAll).toBeUndefined();
  });
});

describe("timers model: starting timers", () => {
  it("refuses an unnamed quick timer while one runs", () => {
    const h = harness();
    timersModel(h.ctx).timers!.start!.quick[1].run();
    expect(h.calls).toHaveLength(0);
    expect(h.errors).toEqual([{ message: expect.stringContaining("without a name"), key: TIMERS_KEYS.start }]);
  });

  it("starts a quick timer with the which-button pending value", async () => {
    const bar = newBar();
    bar.update((b) => (b.timers = b.timers.filter((t) => t.name !== "")));
    const h = harness({ bar });
    const start = timersModel(h.ctx).timers!.start!;
    expect(start.quick.map((q) => q.label)).toEqual(["1 min", "5 min", "10 min", "15 min"]);
    start.quick[1].run();
    await flush();
    expect(h.calls[0]).toMatchObject({ key: TIMERS_KEYS.start, opts: { value: "quick:5" } });
    expect(h.bar.calls.at(-1)).toMatchObject({ service: "timer_start", data: { duration: { minutes: 5 }, sound: "unless_tv" } });

    const pending = timersModel({ ...h.ctx, pendingValue: ((k: string) => (k === TIMERS_KEYS.start ? "quick:5" : undefined)) as never });
    expect(pending.timers!.start!.quick.map((q) => q.pending)).toEqual([false, true, false, false]);
  });

  it("ignores a second start while one is pending and stops at the timer limit", () => {
    const bar = newBar();
    bar.update((b) => {
      b.timers = Array.from({ length: MAX_TIMERS }, (_, i) => ({ ...b.timers[1], id: `x${i}`, name: `T${i}` }));
    });
    const busy = harness({ bar, patch: { isPending: (k) => k === TIMERS_KEYS.start } });
    timersModel(busy.ctx).timers!.start!.quick[0].run();
    expect(busy.calls).toHaveLength(0);
    expect(busy.errors).toHaveLength(0);

    const full = harness({ bar });
    timersModel(full.ctx).timers!.start!.quick[0].run();
    expect(full.errors[0].message).toContain(`at most ${MAX_TIMERS} timers`);
  });

  it("validates the custom form and resets it after a start", async () => {
    const h = harness({ local: { formOpen: true, name: "Bread #2" } });
    let form = timersModel(h.ctx).timers!.start!.form;
    expect(form.badChars).toEqual(["#"]);
    expect(form.nameHint).toEqual({ text: expect.stringContaining("#"), warn: true });
    expect(form.submit).toMatchObject({ enabled: false, reason: expect.stringContaining("#") });

    h.local.name = "pizza";
    form = timersModel(h.ctx).timers!.start!.form;
    expect(form.nameHint).toEqual({ text: "On the bar: PIZZA", warn: false });
    expect(await form.submitForm()).toBe(false);
    expect(h.errors.at(-1)?.message).toContain("PIZZA is already running");

    h.local.name = "";
    expect(timersModel(h.ctx).timers!.start!.form.nameHint.text).toContain("Letters, digits");

    h.local.name = "Bread";
    form = timersModel(h.ctx).timers!.start!.form;
    form.minutes.set("721");
    expect(await form.submitForm()).toBe(false);
    expect(h.errors.at(-1)?.message).toContain("from 1 to 720");

    form.minutes.set("20");
    form.sounds.find((s) => s.value === "always")!.select();
    form = timersModel(h.ctx).timers!.start!.form;
    expect(form.sounds.map((s) => s.selected)).toEqual([false, false, true]);
    expect(await form.submitForm()).toBe(true);
    expect(h.calls.at(-1)?.opts?.value).toBe("custom");
    expect(h.bar.calls.at(-1)).toMatchObject({
      service: "timer_start",
      data: { duration: { minutes: 20 }, name: "Bread", sound: "always", show_time_left: true },
    });
    expect(h.local).toMatchObject({ name: "", formOpen: false });
  });

  it("opens, closes and toggles form options through the model", () => {
    const h = harness();
    let form = timersModel(h.ctx).timers!.start!.form;
    expect(form.open).toBe(false);
    expect(form).toMatchObject({ toggleLabel: "Custom", toggleAriaLabel: "Custom timer", toggleIcon: "mdi:tune-variant" });
    form.toggle();
    form = timersModel(h.ctx).timers!.start!.form;
    expect(form.open).toBe(true);
    // The accessible name stays; aria-expanded tells the state.
    expect(form).toMatchObject({ toggleAriaLabel: "Custom timer", toggleIcon: "mdi:close" });
    form.showLeft.toggle();
    form.name.set("eggs");
    expect(h.local).toMatchObject({ showLeft: false, name: "eggs" });
    form.close();
    expect(h.local.formOpen).toBe(false);
  });
});

describe("timers model: recent items", () => {
  it("lists translated chips with error keys", () => {
    const recent = timersModel(harness().ctx).timers!.recent!;
    expect(recent.kind).toBe("timer");
    expect(recent.chips.map((c) => c.label)).toEqual(["EGGS · 7 min", "PASTA · 10 min", "LAUNDRY · 1 h"]);
    expect(recent.chips[0].restart.ariaLabel).toBe("Start EGGS · 7 min again");
    expect(recent.chips[0].forget.ariaLabel).toBe("Forget EGGS · 7 min");
    expect(recent.errorKeys).toContain(TIMERS_KEYS.recent + recent.chips[0].id);
    expect(recent.errorKeys).toContain(TIMERS_KEYS.forget + recent.chips[0].id);
  });

  it("guards a slot against a double click, then lets it go", () => {
    const h = harness();
    let chip = timersModel(h.ctx).timers!.recent!.chips[0];
    chip.restart.run();
    chip = timersModel(h.ctx).timers!.recent!.chips[0];
    chip.restart.run();
    expect(h.calls.map((c) => c.key)).toEqual([TIMERS_KEYS.recent + chip.id]);
    expect(h.calls[0].opts).toMatchObject({ timeoutMs: 5000 });

    chip.forget.run();
    chip.forget.run();
    expect(h.calls.filter((c) => c.key.startsWith(TIMERS_KEYS.forget))).toHaveLength(1);
    expect(h.calls.at(-1)?.opts?.offline).toBe(true);

    vi.spyOn(Date, "now").mockReturnValue(NOW + RECENT_SLOT_GUARD_MS + 1);
    timersModel(h.ctx).timers!.recent!.chips[0].forget.run();
    expect(h.calls.filter((c) => c.key.startsWith(TIMERS_KEYS.forget))).toHaveLength(2);
  });

  it("does nothing on a busy slot", () => {
    const h = harness({ patch: { isPending: (k) => k.startsWith(TIMERS_KEYS.forget) } });
    const chip = timersModel(h.ctx).timers!.recent!.chips[0];
    expect(chip.busy).toBe(true);
    chip.restart.run();
    expect(h.calls).toHaveLength(0);
  });

  it("forgets on a long press and swallows the click that ends it", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const h = harness();
    const chip = timersModel(h.ctx).messages!.recent!.chips[1];
    chip.press.onPointerDown({ button: 0 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    chip.press.onPointerEnd();
    chip.restart.run();
    expect(h.calls.map((c) => c.key)).toEqual([TIMERS_KEYS.forget + chip.id]);
    expect(h.local.suppressClick).toBeUndefined();
  });

  it("cancels a press released early, ignores other buttons and forgets from the context menu", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const h = harness();
    const chip = timersModel(h.ctx).timers!.recent!.chips[2];
    chip.press.onPointerDown({ button: 0 });
    vi.advanceTimersByTime(LONG_PRESS_MS - 100);
    chip.press.onPointerEnd();
    vi.advanceTimersByTime(500);
    chip.press.onPointerDown({ button: 2 });
    vi.advanceTimersByTime(LONG_PRESS_MS + 100);
    expect(h.calls).toHaveLength(0);

    const ev = new Event("contextmenu", { cancelable: true });
    chip.press.onContextMenu(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(h.calls.map((c) => c.key)).toEqual([TIMERS_KEYS.forget + chip.id]);
  });
});

describe("timers model: messages", () => {
  it("describes status and length of each message", () => {
    const bar = newBar();
    bar.update((b) => {
      b.messages.push(
        { ...b.messages[1], id: "a", text: "A", mode: "duration", endsAt: NOW + 300000 },
        { ...b.messages[1], id: "b", text: "B", mode: "duration", endsAt: null, durationS: 900, held: true, whenOn: true },
        { ...b.messages[1], id: "c", text: "C", whenOn: true },
      );
    });
    const { messages } = timersModel(harness({ bar }).ctx);
    const [fridge, dinner, a, b, c] = messages!.messages;
    expect(fridge).toMatchObject({ label: "FRIDGE OPEN", name: "fridge", length: { kind: "forever", text: "until cleared" } });
    expect(fridge.clear.ariaLabel).toBe("Clear FRIDGE OPEN");
    expect(dinner).toMatchObject({ name: "", status: { kind: "waiting" }, length: { kind: "passes", text: "3 passes left" } });
    expect(a.length).toMatchObject({ kind: "until", endsAt: NOW + 300000 });
    expect(a.length.text).toMatch(/^until /);
    expect(b).toMatchObject({ status: { kind: "held" }, icon: "mdi:power-sleep", whenOnText: undefined });
    expect(b.length).toEqual({ kind: "held_for", text: "for 15 min once the bar is on" });
    expect(c.whenOnText).toBe("when the bar is on");
  });

  it("clears one message by id and all after confirmation", async () => {
    const h = harness();
    const section = timersModel(h.ctx).messages!;
    section.messages[0].clear.run();
    await flush();
    expect(h.bar.calls.at(-1)).toMatchObject({ service: "display_cancel", data: { id: "fridge" } });
    section.clearAll!.run();
    await flush();
    expect(h.confirms).toBe(1);
    expect(h.bar.calls.at(-1)).toMatchObject({ domain: "button", service: "press" });
  });

  it("offers clear all only when there is a message", () => {
    const bar = newBar();
    bar.update((b) => (b.messages = []));
    expect(timersModel(harness({ bar }).ctx).messages!.clearAll).toBeUndefined();
  });
});

describe("timers model: compose", () => {
  it("previews, counts and explains why it cannot send", () => {
    const h = harness();
    let compose = timersModel(h.ctx).messages!.compose!;
    expect(compose).toMatchObject({ preview: "HELLO", previewEmpty: true, counter: { text: "0/31", warn: false } });
    expect(compose.send).toMatchObject({ enabled: false, reason: "Type a text first." });

    compose.text.set("Door: open?");
    compose = timersModel(h.ctx).messages!.compose!;
    expect(compose.badChars).toEqual([":", "?"]);
    expect(compose.invalid).toBe(true);
    expect(compose.warning).toContain(": ?");
    expect(compose.liveStatus).toBe(compose.warning);
    expect(compose.send.reason).toBe(compose.warning);

    compose.text.set("x".repeat(40));
    compose = timersModel(h.ctx).messages!.compose!;
    expect(compose).toMatchObject({ tooLong: true, counter: { warn: true }, liveStatus: "Longer than the 31 characters the display shows." });

    compose.text.set("  Pizza   ready ");
    compose = timersModel(h.ctx).messages!.compose!;
    expect(compose).toMatchObject({ folded: "PIZZA READY", preview: "PIZZA READY", previewEmpty: false, invalid: false, liveStatus: "" });
    expect(compose.send.enabled).toBe(true);
  });

  it("steps the repeat count within 1..99 and lists a custom duration", () => {
    const h = harness({ local: { repeat: 1, durationMin: 45 } });
    let compose = timersModel(h.ctx).messages!.compose!;
    expect(compose.repeat.less).toMatchObject({ enabled: false, reason: "The message shows at least once." });
    expect(compose.repeat.more).toMatchObject({ enabled: true, reason: undefined });
    compose.repeat.more.run();
    expect(h.local.repeat).toBe(2);
    compose = timersModel(h.ctx).messages!.compose!;
    expect(compose.repeat.less).toMatchObject({ enabled: true, reason: undefined });
    h.local.repeat = 99;
    compose = timersModel(h.ctx).messages!.compose!;
    expect(compose.repeat.more).toMatchObject({ enabled: false, reason: "The message repeats at most 99 times." });
    expect(compose.repeat.less.reason).toBeUndefined();
    expect(compose.repeat.label).toBe("99 times");
    expect(compose.duration.options.map((o) => o.value)).toEqual([1, 5, 15, 30, 45, 60, 120, 240]);
    expect(compose.duration.options.find((o) => o.selected)?.label).toBe("45 min");
    compose.duration.set(60);
    compose.modes[0].select();
    expect(h.local).toMatchObject({ durationMin: 60, mode: "repeat" });
  });

  it("sends once, clears the text and waits for the folded text", async () => {
    const h = harness({ local: { text: "Bed time", mode: "repeat", repeat: 4, clearOnKey: false, whenOn: true } });
    const compose = timersModel(h.ctx).messages!.compose!;
    expect(compose.whenOnHint).toContain("In standby");
    expect(await compose.sendForm()).toBe(true);
    expect(h.bar.calls.at(-1)?.data).toEqual({ message: "Bed time", repeat: 4, when_on: true });
    expect(h.local.text).toBe("");
    expect(h.calls[0].opts?.until?.(h.bar.hass())).toBe(true);

    const busy = harness({ local: { text: "Hi" }, patch: { isPending: (k) => k === TIMERS_KEYS.send } });
    expect(await timersModel(busy.ctx).messages!.compose!.sendForm()).toBe(false);
    expect(busy.calls).toHaveLength(0);
  });

  it("hides when_on for the session after the remote refused it", async () => {
    const h = harness({ local: { text: "Bed time", whenOn: true } });
    vi.spyOn(h.bar, "callService").mockRejectedValue({
      code: "service_validation_error",
      message: "refused",
      translation_domain: "jbl_bar_91",
      translation_key: "display_when_on_unsupported",
      translation_placeholders: {},
    });
    const compose = timersModel(h.ctx).messages!.compose!;
    await compose.sendForm();
    expect(h.calls[0].opts?.onError).toBeDefined();
    expect(h.local).toMatchObject({ whenOnUnsupported: true, whenOn: false, text: "Bed time" });
    const after = timersModel(h.ctx).messages!.compose!;
    expect(after.whenOn).toBeUndefined();
    expect(after.whenOnHint).toBeUndefined();

    // The masked option is never sent again, even if the local flag were set.
    h.local.whenOn = true;
    vi.mocked(h.bar.callService).mockResolvedValue(undefined as never);
    await timersModel(h.ctx).messages!.compose!.sendForm();
    expect(vi.mocked(h.bar.callService).mock.calls.at(-1)?.[2]).not.toHaveProperty("when_on");
  });
});

describe("timers model: clock", () => {
  it("shows the pending value and switches the clock", async () => {
    const h = harness();
    let clock = timersModel(h.ctx).clock!;
    expect(clock.toggle).toMatchObject({ on: true, enabled: true, label: "Clock" });
    clock.toggle.run();
    await flush();
    expect(h.calls[0]).toMatchObject({ key: TIMERS_KEYS.clock, opts: { value: false } });
    expect(h.bar.clockOn).toBe(false);

    clock = timersModel({ ...h.ctx, pendingValue: ((k: string) => (k === TIMERS_KEYS.clock ? true : undefined)) as never }).clock!;
    expect(clock.toggle.on).toBe(true);
  });

  it("ignores a toggle while pending and disables an unknown clock", () => {
    const busy = harness({ patch: { isPending: (k) => k === TIMERS_KEYS.clock } });
    timersModel(busy.ctx).clock!.toggle.run();
    expect(busy.calls).toHaveLength(0);

    const { ctx } = harness();
    const id = ctx.entities.display_clock!;
    const unknown = timersModel({ ...ctx, stateOf: (x) => (x === id ? { ...ctx.hass.states[id], state: "unknown" } : ctx.stateOf(x)) });
    expect(unknown.clock!.toggle).toMatchObject({ enabled: false, on: false, reason: "The clock's state is unknown." });
  });

  it("chooses when the clock shows, skipping the current choice", async () => {
    const h = harness();
    const when = timersModel(h.ctx).clock!.when!;
    expect(when.options.map((o) => [o.value, o.selected, o.checked])).toEqual([
      ["standby", true, true],
      ["always", false, false],
    ]);
    when.options[0].select();
    expect(h.calls).toHaveLength(0);
    when.options[1].select();
    await flush();
    expect(h.calls[0]).toMatchObject({ key: TIMERS_KEYS.clockWhen, opts: { value: "always" } });
    expect(h.bar.clockWhen).toBe("always");

    // While "always" is on its way: shown as chosen, but aria-checked follows the bar (still standby).
    const fresh = harness();
    const pending = timersModel({ ...fresh.ctx, pendingValue: ((k: string) => (k === TIMERS_KEYS.clockWhen ? "always" : undefined)) as never });
    expect(pending.clock!.when!.options.map((o) => [o.selected, o.pending, o.checked])).toEqual([
      [false, false, true],
      [true, true, false],
    ]);
  });

  it("gives the unreachable reason first on the switch and every 'when' option", () => {
    const h = harness({ patch: { barUnavailable: true } });
    const clock = timersModel(h.ctx).clock!;
    expect(clock.toggle).toMatchObject({ enabled: false, reason: "The soundbar is unreachable." });
    expect(clock.when!.options.map((o) => [o.enabled, o.reason])).toEqual([
      [false, "The soundbar is unreachable."],
      [false, "The soundbar is unreachable."],
    ]);
    // Disabled actions do nothing.
    clock.toggle.run();
    clock.when!.options[1].select();
    expect(h.calls).toHaveLength(0);

    // Unreachable and unknown: still the unreachable reason.
    const id = h.ctx.entities.display_clock!;
    const unknown = timersModel({ ...h.ctx, stateOf: (x) => (x === id ? { ...h.ctx.hass.states[id], state: "unknown" } : h.ctx.stateOf(x)) });
    expect(unknown.clock!.toggle.reason).toBe("The soundbar is unreachable.");
  });

  it("explains 'when' options while the select alone is unavailable", () => {
    const { ctx } = harness();
    const whenId = ctx.entities.display_clock_when!;
    const clock = timersModel({ ...ctx, isAvailable: (x) => x !== whenId && ctx.isAvailable(x) }).clock!;
    expect(clock.toggle).toMatchObject({ enabled: true, reason: undefined });
    expect(clock.when!.options.map((o) => [o.enabled, o.reason])).toEqual([
      [false, 'The "Shows" setting is unavailable.'],
      [false, 'The "Shows" setting is unavailable.'],
    ]);
    expect(timersModel(ctx).clock!.when!.options.every((o) => o.enabled && o.reason === undefined)).toBe(true);
  });

  it("has no 'when' choice on remotes without the select", () => {
    const { ctx } = harness();
    expect(timersModel({ ...ctx, entities: { ...ctx.entities, display_clock_when: undefined } }).clock!.when).toBeUndefined();
  });
});
