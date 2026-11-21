import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import {
  COUNTDOWN_TAG,
  JblBarCountdown,
  LONG_PRESS_MS,
  RECENT_SLOT_GUARD_MS,
  composeMessage,
  invalidTimerNameChars,
  lengthLabel,
  messageItems,
  recentLabel,
  renderTimersTab,
  timerItems,
} from "../src/tabs/timers";
import { translate } from "../src/i18n";
import type { HassEntity } from "../src/types";
import { NOW, cleanup, mountCard, newBar, settle, tabContext } from "./helpers";
import type { Mounted } from "./helpers";

const RECENT = { timer: "button.jbl_recent_timer_1", message: "button.jbl_recent_message_2" };

beforeEach(() => {
  // The mock's clock is fixed at NOW; countdowns read Date.now().
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const open = (config: Parameters<typeof mountCard>[0] = {}, bar = newBar()): Promise<Mounted> =>
  mountCard({ default_tab: "timers", ...config }, bar);

const timerRows = (m: Mounted): HTMLElement[] => m.$$(".timers-list .timer");
const typeInto = (input: HTMLInputElement, value: string): void => {
  input.value = value;
  input.dispatchEvent(new Event("input"));
};
const button = (m: Mounted, scope: string, label: string): HTMLButtonElement =>
  m.$$(`${scope} button`).find((b) => b.textContent?.trim() === label) as HTMLButtonElement;

describe("sensor parsing", () => {
  it("reads timers and messages, tolerating junk", () => {
    const st = (attributes: Record<string, unknown>): HassEntity => ({
      entity_id: "sensor.x",
      state: "1",
      attributes,
      last_changed: "",
      last_updated: "",
    });
    expect(timerItems(undefined)).toEqual([]);
    expect(
      timerItems(
        st({
          timers: [
            { id: "t3", name: "PIZZA", ringing: false, ends_at: "2026-11-21T20:15:30+00:00", countdown: true, sound: "always", duration_s: 900 },
            null,
            { name: "no id" },
          ],
        }),
      ),
    ).toEqual([
      { id: "t3", name: "PIZZA", ringing: false, endsAt: Date.UTC(2026, 10, 21, 20, 15, 30), countdown: true, sound: "always", durationS: 900 },
    ]);
    expect(messageItems(st({ messages: [{ text: "HI", mode: "weird", passes_left: 2 }] }))).toMatchObject([
      { id: "default", text: "HI", mode: "passes", passesLeft: 2, endsAt: null },
    ]);
  });

  it("checks timer name characters and formats lengths", () => {
    expect(invalidTimerNameChars("Café l'été-2")).toEqual([]);
    expect(invalidTimerNameChars("Pizza!")).toEqual(["!"]);
    // The remote folds Œ, Æ, ß, curly apostrophes and dashes itself: these names are valid.
    expect(invalidTimerNameChars("pâtes à l’œuf")).toEqual([]);
    expect(invalidTimerNameChars("Škoda")).toEqual(["Š"]);
    const ctx = { t: (key: string, vars?: Record<string, string | number>) => translate("en", key, vars) };
    expect(lengthLabel(ctx, 15)).toBe("15 min");
    expect(lengthLabel(ctx, 60)).toBe("1 h");
    expect(lengthLabel(ctx, 90)).toBe("1 h 30 min");
  });

  it("builds display_message options with one length only", () => {
    const base = { text: " Hi ", repeat: 3, durationMin: 15, clearOnKey: false, whenOn: false };
    expect(composeMessage({ ...base, mode: "repeat" })).toEqual({ message: "Hi", repeat: 3 });
    expect(composeMessage({ ...base, mode: "duration", clearOnKey: true })).toEqual({
      message: "Hi",
      duration: { minutes: 15 },
      clear_on_key: true,
    });
    expect(composeMessage({ ...base, mode: "forever", whenOn: true })).toEqual({ message: "Hi", forever: true, when_on: true });
  });
});

describe("countdown element", () => {
  it("counts down and fills the progress bar without a card render", () => {
    const text = document.createElement(COUNTDOWN_TAG) as JblBarCountdown;
    const bar = document.createElement(COUNTDOWN_TAG) as JblBarCountdown;
    bar.kind = "progress";
    bar.total = 900;
    text.endsAt = NOW + 432000;
    bar.endsAt = NOW + 432000;
    document.body.append(text, bar);
    expect(text.textContent).toBe("7:12");
    expect(bar.querySelector<HTMLElement>(".fill")?.style.width).toBe("52%");
    expect(bar.getAttribute("aria-valuenow")).toBe("52");

    vi.spyOn(Date, "now").mockReturnValue(NOW + 2500);
    text.refresh();
    expect(text.textContent).toBe("7:10");
    vi.spyOn(Date, "now").mockReturnValue(NOW + 500000);
    text.refresh();
    expect(text.textContent).toBe("0:00");
  });
});

describe("Timers tab: running timers", () => {
  it("lists ringing first, with countdowns, progress and meta", async () => {
    const m = await open();
    const rows = timerRows(m);
    expect(rows).toHaveLength(3);
    expect(rows[0].classList.contains("ringing")).toBe(true);
    expect(rows[0].textContent).toContain("TEA");
    expect(rows[0].textContent).toContain("Time's up!");
    expect(rows[0].querySelector(".stop")).not.toBeNull();
    expect(rows[0].querySelector(".extend")).toBeNull();

    expect(rows[1].querySelector(".t-name")?.textContent).toBe("PIZZA");
    expect(rows[1].querySelector("jbl-bar-countdown.t-left")?.textContent).toBe("7:12");
    expect(rows[1].querySelector<HTMLElement>(".t-progress .fill")?.style.width).toBe("52%");
    expect(rows[1].textContent).toContain("ends at");
    expect(rows[2].querySelector(".t-name")?.textContent).toBe("Timer");
    expect(rows[2].querySelector("jbl-bar-countdown.t-left")?.textContent).toBe("42:00");
    expect(m.$(".timers-list .section-title .badge")?.textContent).toBe("3");
  });

  it("does not ask the card for a render every second", async () => {
    const m = await open();
    expect((m.card as unknown as { _tickTimer?: unknown })._tickTimer).toBeUndefined();
  });

  it("stops a ringing timer by id", async () => {
    const m = await open();
    (timerRows(m)[0].querySelector(".stop") as HTMLButtonElement).click();
    await m.card.updateComplete;
    expect(timerRows(m)[0].querySelector(".stop")?.classList.contains("pending")).toBe(true);
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ domain: "jbl_bar_91", service: "timer_cancel", data: { id: "t1" } });
    expect(timerRows(m)).toHaveLength(2);
    expect(timerRows(m).some((r) => r.classList.contains("ringing"))).toBe(false);
  });

  it("adds a minute and cancels a running timer", async () => {
    const m = await open();
    (timerRows(m)[1].querySelector(".extend") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "timer_extend", data: { id: "t2" } });
    expect(timerRows(m)[1].querySelector("jbl-bar-countdown.t-left")?.textContent).toBe("8:12");
    expect(timerRows(m)[1].querySelector(".extend")?.classList.contains("pending")).toBe(false);

    (timerRows(m)[2].querySelector(".cancel") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "timer_cancel", data: { id: "t3" } });
    expect(timerRows(m)).toHaveLength(2);
  });

  it("stops all timers after confirmation", async () => {
    const m = await open();
    button(m, ".timers-list .section-title", "Stop all").click();
    await m.card.updateComplete;
    expect(m.$(".dialog")?.textContent).toContain("Stop all timers?");
    (m.$(".dialog .btn.danger") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "timer_cancel", data: { all: true } });
    expect(m.text()).toContain("No timer is running.");
  });

  it("hides +1 min on remotes that do not report the duration", async () => {
    const m = await open();
    const ctx = tabContext(m.bar, { default_tab: "timers" });
    const timersId = ctx.entities.timers!;
    const st = ctx.hass.states[timersId];
    const list = (st.attributes.timers as Record<string, unknown>[]).map((x) => ({ ...x, duration_s: null }));
    const host = document.createElement("div");
    document.body.append(host);
    render(
      renderTimersTab({ ...ctx, stateOf: (id) => (id === timersId ? { ...st, attributes: { ...st.attributes, timers: list } } : ctx.stateOf(id)) }),
      host,
    );
    expect(host.querySelectorAll(".timer").length).toBe(3);
    expect(host.querySelector(".extend")).toBeNull();
    expect(host.querySelector(".t-progress")).toBeNull();
  });
});

describe("Timers tab: starting timers", () => {
  it("explains why a quick (unnamed) timer cannot start while one runs", async () => {
    const m = await open();
    button(m, ".quick", "5 min").click();
    await m.card.updateComplete;
    expect(m.bar.calls).toHaveLength(0);
    expect(m.$(".strip.error")?.textContent).toContain("A timer without a name is already running");
  });

  it("starts a quick timer", async () => {
    const bar = newBar();
    bar.update((b) => (b.timers = b.timers.filter((t) => t.name !== "")));
    const m = await open({}, bar);
    button(m, ".quick", "5 min").click();
    await m.card.updateComplete;
    expect(button(m, ".quick", "5 min").classList.contains("pending")).toBe(true);
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({
      domain: "jbl_bar_91",
      service: "timer_start",
      data: { duration: { minutes: 5 }, sound: "unless_tv" },
      target: { entity_id: "media_player.jbl_bar_9_1" },
    });
    expect(timerRows(m).map((r) => r.querySelector(".t-name")?.textContent)).toContain("Timer");
    expect(button(m, ".quick", "5 min").classList.contains("pending")).toBe(false);
  });

  it("starts a custom timer and checks the name first", async () => {
    const m = await open();
    button(m, ".quick", "Custom").click();
    await m.card.updateComplete;
    const name = m.$("#timers-name") as HTMLInputElement;
    typeInto(name, "pizza");
    await m.card.updateComplete;
    expect(m.$(".timer-form")?.textContent).toContain("On the bar: PIZZA");
    (m.$(".timer-form button[type=submit]") as HTMLButtonElement).click();
    await m.card.updateComplete;
    expect(m.bar.calls).toHaveLength(0);
    expect(m.$(".strip.error")?.textContent).toContain("A timer named PIZZA is already running");

    typeInto(name, "Bread #2");
    await m.card.updateComplete;
    expect(m.$(".timer-form .warn-text")?.textContent).toContain("#");
    expect((m.$(".timer-form button[type=submit]") as HTMLButtonElement).disabled).toBe(true);

    typeInto(name, "Bread");
    const minutes = m.$("#timers-minutes") as HTMLInputElement;
    typeInto(minutes, "20");
    button(m, ".timer-form .seg", "Always").click();
    await m.card.updateComplete;
    (m.$(".timer-form button[type=submit]") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({
      service: "timer_start",
      data: { duration: { minutes: 20 }, name: "Bread", show_time_left: true, sound: "always" },
    });
    expect(m.$(".timer-form")).toBeNull();
    expect(timerRows(m).map((r) => r.querySelector(".t-name")?.textContent)).toContain("BREAD");
  });

  it("rejects minutes outside 1..720", async () => {
    const bar = newBar();
    bar.update((b) => (b.timers = []));
    const m = await open({}, bar);
    button(m, ".quick", "Custom").click();
    await m.card.updateComplete;
    typeInto(m.$("#timers-minutes") as HTMLInputElement, "0");
    (m.$(".timer-form button[type=submit]") as HTMLButtonElement).click();
    await m.card.updateComplete;
    expect(m.bar.calls).toHaveLength(0);
    expect(m.$(".strip.error")?.textContent).toContain("from 1 to 720");
  });
});

describe("Timers tab: recent items", () => {
  it("restarts a recent timer and forgets one with ×", async () => {
    const m = await open();
    const chips = () => m.$$(".recent-timers .chip.restart").map((c) => c.textContent?.trim());
    expect(chips()).toEqual(["EGGS · 7 min", "PASTA · 10 min", "LAUNDRY · 1 h"]);
    (m.$(".recent-timers .chip.restart") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ domain: "button", service: "press", target: { entity_id: RECENT.timer } });
    expect(timerRows(m).map((r) => r.querySelector(".t-name")?.textContent)).toContain("EGGS");

    (m.$(".recent-timers .forget") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({
      domain: "jbl_bar_91",
      service: "forget_recent",
      data: {},
      target: { entity_id: RECENT.timer },
    });
    expect(chips()).toEqual(["LAUNDRY · 1 h"]);
  });

  it("forgets on long press without restarting", async () => {
    const m = await open();
    const chip = m.$$(".recent-messages .chip.restart")[1];
    expect(chip.textContent?.trim()).toBe("CALL MOM · 3 times");
    chip.dispatchEvent(new PointerEvent("pointerdown", { button: 0 }));
    await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 60));
    chip.dispatchEvent(new PointerEvent("pointerup"));
    chip.click();
    await settle(m);
    expect(m.bar.calls.map((c) => c.service)).toEqual(["forget_recent"]);
    expect(m.bar.calls[0].target).toEqual({ entity_id: RECENT.message });
    expect(m.$$(".recent-messages .chip.restart").map((c) => c.textContent?.trim())).not.toContain("CALL MOM · 3 times");
  });

  it("forgets from the context menu", async () => {
    const m = await open();
    m.$$(".recent-timers .chip.restart")[2].dispatchEvent(new Event("contextmenu", { cancelable: true }));
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "forget_recent", target: { entity_id: "button.jbl_recent_timer_3" } });
  });

  it("hides recent items with several bars unless recent: true", async () => {
    const bar = newBar();
    bar.entities["media_player.jbl_bar_9_1_2"] = {
      entity_id: "media_player.jbl_bar_9_1_2",
      device_id: "second",
      platform: "jbl_bar_91",
      labels: [],
    };
    const m = await open({}, bar);
    expect(m.$(".recent")).toBeNull();
    cleanup();
    const shown = await open({ recent: true }, bar);
    expect(shown.$(".recent-timers")).not.toBeNull();
  });
});

describe("Timers tab: messages", () => {
  it("lists the messages and clears one by id", async () => {
    const m = await open();
    const rows = m.$$(".messages .message");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("FRIDGE OPEN");
    expect(rows[0].textContent).toContain("(fridge)");
    expect(rows[0].textContent).toContain("On display");
    expect(rows[0].textContent).toContain("until cleared");
    expect(rows[1].textContent).toContain("Waiting");
    expect(rows[1].textContent).toContain("3 passes left");
    (rows[0].querySelector(".clear") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "display_cancel", data: { id: "fridge" } });
    expect(m.$$(".messages .message")).toHaveLength(1);
  });

  it("shows a live countdown for a timed message", async () => {
    const bar = newBar();
    bar.update((b) => {
      b.messages[0] = { ...b.messages[0], mode: "duration", endsAt: NOW + 5 * 60000 };
    });
    const m = await open({}, bar);
    expect(m.$(".messages .message jbl-bar-countdown")?.textContent).toBe("5:00");
  });

  it("previews, counts and sends a message", async () => {
    const m = await open();
    const input = m.$("#timers-text") as HTMLInputElement;
    expect(input.maxLength).toBe(31);
    typeInto(input, "Café ouvert");
    await m.card.updateComplete;
    // Exactly the display text: no template whitespace (the preview uses white-space: pre).
    expect(m.$(".lcd")?.textContent).toBe("CAFE OUVERT");
    expect(m.$(".counter")?.textContent).toBe("11/31");
    // The counter is not part of the input's name and is not a live region.
    expect(m.$('label[for="timers-text"]')?.textContent).toBe("Text");
    expect(input.getAttribute("aria-describedby")).toBe("timers-text-counter");
    expect(m.$(".counter")?.hasAttribute("aria-live")).toBe(false);

    typeInto(input, "  Door   open ");
    await m.card.updateComplete;
    expect(m.$(".lcd")?.textContent).toBe("DOOR OPEN");
    expect(m.$(".counter")?.textContent).toBe("9/31");

    typeInto(input, "Door open: 5 min?");
    await m.card.updateComplete;
    expect(m.$(".compose .warn-text")?.textContent).toContain(": ?");
    expect((m.$(".compose .send") as HTMLButtonElement).disabled).toBe(true);

    typeInto(input, "Mail @ home");
    await m.card.updateComplete;
    expect(m.$(".compose .warn-text")?.textContent).toContain("@");
    expect((m.$(".compose .send") as HTMLButtonElement).disabled).toBe(true);

    typeInto(input, "Pizza ready");
    button(m, ".compose .seg", "Timed").click();
    await m.card.updateComplete;
    const select = m.$("#timers-duration") as HTMLSelectElement;
    select.value = "30";
    select.dispatchEvent(new Event("change"));
    await m.card.updateComplete;
    (m.$(".compose .send") as HTMLButtonElement).click();
    await m.card.updateComplete;
    expect(m.$(".compose .send")?.classList.contains("pending")).toBe(true);
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({
      service: "display_message",
      data: { message: "Pizza ready", duration: { minutes: 30 }, clear_on_key: true },
    });
    expect(m.bar.calls.at(-1)?.data).not.toHaveProperty("repeat");
    expect(m.bar.calls.at(-1)?.data).not.toHaveProperty("forever");
    expect((m.$("#timers-text") as HTMLInputElement).value).toBe("");
    expect(m.$$(".messages .message").map((r) => r.querySelector(".m-text")?.textContent)).toContain("PIZZA READY");
  });

  it("sends a repeated message with when_on", async () => {
    const m = await open();
    typeInto(m.$("#timers-text") as HTMLInputElement, "Bed time");
    button(m, ".compose .seg", "Repeat").click();
    await m.card.updateComplete;
    expect(m.$(".repeat-value")?.textContent).toBe("3 times");
    (m.$$(".compose .stepper button")[1] as HTMLButtonElement).click();
    await m.card.updateComplete;
    expect(m.$(".repeat-value")?.textContent).toBe("4 times");
    m.$$(".compose .chip")[0].click(); // clear by key off
    m.$$(".compose .chip")[1].click(); // when the bar is on
    await m.card.updateComplete;
    expect(m.$(".compose")?.textContent).toContain("In standby the message waits");
    (m.$(".compose .send") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)?.data).toEqual({ message: "Bed time", repeat: 4, when_on: true });
  });

  it("clears all messages after confirmation", async () => {
    const m = await open();
    (m.$(".messages .clear-all") as HTMLButtonElement).click();
    await m.card.updateComplete;
    expect(m.$(".dialog")?.textContent).toContain("Clear all messages?");
    (m.$(".dialog .btn.danger") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({
      domain: "button",
      service: "press",
      target: { entity_id: "button.jbl_bar_9_1_clear_all_messages" },
    });
    expect(m.text()).toContain("No message on the display.");
  });
});

describe("Timers tab: clock and missing entities", () => {
  it("switches the clock and when it shows", async () => {
    const m = await open();
    const sw = m.$(".clock-switch")!;
    expect(sw.getAttribute("aria-checked")).toBe("true");
    sw.click();
    await settle(m);
    expect(m.bar.clockOn).toBe(false);
    expect(m.$(".clock-switch")?.getAttribute("aria-checked")).toBe("false");
    button(m, ".clock-when", "Always").click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({
      domain: "select",
      service: "select_option",
      data: { option: "always" },
      target: { entity_id: "select.jbl_display_clock_when" },
    });
    expect(m.bar.clockWhen).toBe("always");
  });

  it("hides the blocks whose entities are missing", async () => {
    const bar = newBar();
    delete bar.entities["sensor.jbl_bar_9_1_messages"];
    const m = await open({}, bar);
    expect(m.$(".timers-list")).not.toBeNull();
    expect(m.$(".messages")).toBeNull();
    expect(m.$(".recent-messages")).toBeNull();
    expect(m.$(".clock")).not.toBeNull();

    // An older remote without timers or the clock extension.
    const ctx = tabContext(bar);
    const host = document.createElement("div");
    render(
      renderTimersTab({
        ...ctx,
        entities: { ...ctx.entities, timers: undefined, display_clock: undefined, display_clock_when: undefined, recentTimers: [] },
      }),
      host,
    );
    expect(host.querySelector(".timers-list")).toBeNull();
    expect(host.querySelector(".clock")).toBeNull();
  });

  it("shows the clock without the 'when' select on remotes that lack it", async () => {
    const ctx = tabContext();
    const host = document.createElement("div");
    render(renderTimersTab({ ...ctx, entities: { ...ctx.entities, display_clock_when: undefined } }), host);
    expect(host.querySelector(".clock-switch")).not.toBeNull();
    expect(host.querySelector(".clock-when")).toBeNull();
  });

  it("disables actions while the bar is unreachable", async () => {
    const bar = newBar();
    bar.reachable = false;
    bar.update(() => undefined);
    const m = await open({}, bar);
    expect(m.text()).toContain("Timers can't be read while the soundbar is unreachable.");
    expect(m.$(".quick")).toBeNull();
    expect(m.$(".recent")).toBeNull();
  });

  it("translates to Ukrainian and French", async () => {
    const uk = await open({}, newBar({ language: "uk" }));
    expect(uk.text()).toContain("Таймери");
    expect(uk.text()).toContain("Час вийшов!");
    expect(uk.text()).toContain("залишилося 3 покази");
    cleanup();
    const fr = await open({}, newBar({ language: "fr" }));
    expect(fr.text()).toContain("Messages sur l'afficheur");
    expect(fr.text()).toContain("encore 3 passages");
  });
});

describe("Timers tab: double taps and slots", () => {
  it("forgets one recent item per double click on ×, and the next one after a moment", async () => {
    const m = await open();
    const chips = () => m.$$(".recent-timers .chip.restart").map((c) => c.textContent?.trim());
    expect(chips()).toEqual(["EGGS · 7 min", "PASTA · 10 min", "LAUNDRY · 1 h"]);
    (m.$(".recent-timers .forget") as HTMLButtonElement).click();
    await settle(m);
    // The next item moved into the slot; the second click of the double click lands on it.
    (m.$(".recent-timers .forget") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.filter((c) => c.service === "forget_recent")).toHaveLength(1);
    expect(chips()).toEqual(["PASTA · 10 min", "LAUNDRY · 1 h"]);

    vi.spyOn(Date, "now").mockReturnValue(NOW + RECENT_SLOT_GUARD_MS + 1);
    (m.$(".recent-timers .forget") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.filter((c) => c.service === "forget_recent")).toHaveLength(2);
  });

  it("restarts a recent timer once per double tap", async () => {
    const m = await open();
    const chip = m.$(".recent-timers .chip.restart") as HTMLButtonElement;
    chip.click();
    chip.click();
    await settle(m);
    (m.$(".recent-timers .chip.restart") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.filter((c) => c.service === "press")).toHaveLength(1);
    expect(m.$(".strip.error")).toBeNull();
  });

  it("does not swallow the next tap after a long press that ended off the chip", async () => {
    const m = await open();
    const chip = m.$$(".recent-messages .chip.restart")[1];
    chip.dispatchEvent(new PointerEvent("pointerdown", { button: 0 }));
    await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 60));
    chip.dispatchEvent(new PointerEvent("pointerleave"));
    await settle(m);
    expect(m.bar.calls.map((c) => c.service)).toEqual(["forget_recent"]);
    // Later, a normal tap on the same slot (now another message) starts it.
    vi.spyOn(Date, "now").mockReturnValue(NOW + 5000);
    const next = m.$$(".recent-messages .chip.restart")[1];
    next.dispatchEvent(new PointerEvent("pointerdown", { button: 0 }));
    next.dispatchEvent(new PointerEvent("pointerup"));
    next.click();
    await settle(m);
    expect(m.bar.calls.map((c) => c.service)).toEqual(["forget_recent", "press"]);
  });

  it("starts one quick timer and sends one message per double tap", async () => {
    const bar = newBar();
    bar.update((b) => (b.timers = b.timers.filter((t) => t.name !== "")));
    const m = await open({}, bar);
    const quick = button(m, ".quick", "5 min");
    quick.click();
    await m.card.updateComplete;
    quick.click();
    typeInto(m.$("#timers-text") as HTMLInputElement, "Hi");
    await m.card.updateComplete;
    const send = m.$(".compose .send") as HTMLButtonElement;
    send.click();
    await m.card.updateComplete;
    send.click();
    await settle(m);
    expect(m.bar.calls.filter((c) => c.service === "timer_start")).toHaveLength(1);
    expect(m.bar.calls.filter((c) => c.service === "display_message")).toHaveLength(1);
  });

  it("shows form errors next to the form, not only at the top of the card", async () => {
    const m = await open();
    button(m, ".quick", "5 min").click();
    await m.card.updateComplete;
    expect(m.$(".start .strip.error")?.textContent).toContain("A timer without a name is already running");
    expect(m.$(".shell > .strip.error")).toBeNull();
  });
});

describe("Timers tab: when_on on remotes without it", () => {
  it("hides the option for the session after the remote refused it", async () => {
    const m = await open();
    const realCall = m.bar.callService.bind(m.bar);
    const spy = vi.spyOn(m.bar, "callService").mockImplementation((domain, service, data, target) => {
      if (service === "display_message" && data?.when_on) {
        return Promise.reject({
          code: "service_validation_error",
          message: "Validation error: This toolkit remote cannot wait for the bar to be on: update it.",
          translation_domain: "jbl_bar_91",
          translation_key: "display_when_on_unsupported",
          translation_placeholders: {},
        });
      }
      return realCall(domain, service, data, target);
    });
    typeInto(m.$("#timers-text") as HTMLInputElement, "Bed time");
    (m.$(".compose .when-on") as HTMLButtonElement).click();
    await m.card.updateComplete;
    (m.$(".compose .send") as HTMLButtonElement).click();
    await settle(m);
    expect(m.$(".compose .when-on")).toBeNull();
    expect(m.$(".compose .strip.error")?.textContent).toContain("option is hidden");
    (m.$(".compose .send") as HTMLButtonElement).click();
    await settle(m);
    expect(spy.mock.calls.at(-1)?.[2]).not.toHaveProperty("when_on");
    expect(m.$(".compose .strip.error")).toBeNull();
  });
});

describe("Timers tab: recent labels", () => {
  const ctx = (lang: "en" | "uk" | "fr") => ({ t: (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars) });

  it("translates the integration's en/fr words into the card language", () => {
    expect(recentLabel(ctx("uk"), "timer", "Timer · 10 min")).toBe("Таймер · 10 хв");
    expect(recentLabel(ctx("uk"), "timer", "PIZZA · 1 h")).toBe("PIZZA · 1 год");
    expect(recentLabel(ctx("uk"), "message", "CALL MOM · 3 times")).toBe("CALL MOM · 3 рази");
    expect(recentLabel(ctx("uk"), "message", "DOOR (door) · until cleared · when the bar is on")).toBe(
      "DOOR (door) · доки не приберуть · коли саундбар увімкнений",
    );
    expect(recentLabel(ctx("en"), "message", "BED TIME · 3 fois · à l'allumage")).toBe("BED TIME · 3 times · when the bar is on");
    expect(recentLabel(ctx("en"), "timer", "Minuteur · 90 min")).toBe("Timer · 1 h 30 min");
    // A user text that reads like a word stays as typed.
    expect(recentLabel(ctx("uk"), "message", "TIMER · 2 h")).toBe("TIMER · 2 год");
    expect(recentLabel(ctx("uk"), "timer", "Recent timer 2")).toBe("Recent timer 2");
  });

  it("shows translated chips in a Ukrainian UI", async () => {
    const m = await open({}, newBar({ language: "uk" }));
    expect(m.$$(".recent-timers .chip.restart").map((c) => c.textContent?.trim())).toContain("EGGS · 7 хв");
  });
});
