import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { LONG_PRESS_MS, renderTimersTab } from "../src/tabs/timers";
import { TIMERS_LOCAL_KEY, initTimersLocal } from "../src/tabs/timers-model";
import type { TimersLocal } from "../src/tabs/timers-model";
import { NOW, cleanup, mountCard, newBar, settle, tabContext } from "./helpers";
import type { Mounted } from "./helpers";

const CONFIG = { default_tab: "timers", layouts: { timers: "compact" } } as const;

beforeEach(() => {
  // The mock's clock is fixed at NOW; countdowns read Date.now().
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const open = (config: Parameters<typeof mountCard>[0] = {}, bar = newBar()): Promise<Mounted> => mountCard({ ...CONFIG, ...config }, bar);

const tabs = (m: Mounted): HTMLElement[] => m.$$(".timers-compact [role=tab]");
const selectTab = async (m: Mounted, name: "timers" | "messages" | "clock"): Promise<void> => {
  (m.$(`#timers-compact-tab-${name}`) as HTMLButtonElement).click();
  await m.card.updateComplete;
};
/** Rows of the current panel (not the ringing timers shown above the other sub-tabs). */
const rows = (m: Mounted): HTMLElement[] => m.$$(".timers-compact .tc-panel .tc-row");
const typeInto = (input: HTMLInputElement, value: string): void => {
  input.value = value;
  input.dispatchEvent(new Event("input"));
};
const button = (m: Mounted, scope: string, label: string): HTMLButtonElement =>
  m.$$(`${scope} button`).find((b) => b.textContent?.trim() === label) as HTMLButtonElement;

/** Render the compact layout straight from a TabContext (for states the mock cannot reach). */
function renderDirect(patch: (ctx: ReturnType<typeof tabContext>) => Partial<ReturnType<typeof tabContext>>): HTMLElement {
  const ctx = tabContext(newBar(), CONFIG);
  const host = document.createElement("div");
  document.body.append(host);
  render(renderTimersTab({ ...ctx, ...patch(ctx) }), host);
  return host;
}

describe("Timers compact: sub-tabs", () => {
  it("shows three sub-tabs with counts, Timers first, and no classic sections", async () => {
    const m = await open();
    expect(m.$(".timers-compact")).not.toBeNull();
    expect(m.$(".timers")).toBeNull();
    expect(m.$(".timers-compact [role=tablist]")?.getAttribute("aria-label")).toBe("Timers, messages and clock");
    expect(tabs(m).map((t) => t.querySelector(".tc-tab-label")?.textContent)).toEqual(["Timers", "Messages", "Clock"]);
    expect(tabs(m)[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs(m)[0].querySelector(".tc-count")?.textContent?.trim()).toBe("3");
    // TEA rings: the badge is in the alarm colour and says so to screen readers.
    expect(tabs(m)[0].querySelector(".tc-count")?.classList.contains("alarm")).toBe(true);
    expect(tabs(m)[0].textContent).toContain("a timer is ringing");
    expect(tabs(m)[1].querySelector(".tc-count")?.textContent?.trim()).toBe("2");
    expect(tabs(m)[2].querySelector(".tc-count")).toBeNull();
    expect(m.$(".timers-compact [role=tabpanel]")?.getAttribute("aria-labelledby")).toBe("timers-compact-tab-timers");
  });

  it("switches sub-tabs by click and arrow keys, and remembers the choice across renders", async () => {
    const m = await open();
    await selectTab(m, "messages");
    expect(tabs(m)[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs(m)[1].getAttribute("tabindex")).toBe("0");
    expect(tabs(m)[0].getAttribute("tabindex")).toBe("-1");
    expect(m.$(".tc-messages")).not.toBeNull();
    expect(m.$(".tc-timers")).toBeNull();
    expect((m.$("#timers-compact-tab-clock .tc-tab-icon") as HTMLElement & { icon: string }).icon).toBe("mdi:clock-outline");

    // A new state from HA re-renders the card: the sub-tab stays.
    m.bar.update(() => undefined);
    await m.sync();
    expect(m.$(".tc-messages")).not.toBeNull();

    m.$(".timers-compact [role=tablist]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await m.card.updateComplete;
    expect(tabs(m)[2].getAttribute("aria-selected")).toBe("true");
    expect(m.$(".tc-clock")).not.toBeNull();
    m.$(".timers-compact [role=tablist]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    await m.card.updateComplete;
    expect(m.$(".tc-timers")).not.toBeNull();
  });

  it("shows a ringing timer with Stop above the Messages panel, without switching", async () => {
    const m = await open();
    expect(m.$(".tc-alarms")).toBeNull();
    await selectTab(m, "messages");
    expect(tabs(m)[1].getAttribute("aria-selected")).toBe("true");
    const alarm = m.$(".tc-alarms .tc-timer.ringing") as HTMLElement;
    expect(alarm).not.toBeNull();
    expect(alarm.getAttribute("role")).toBe("alert");
    expect(alarm.textContent).toContain("TEA");
    // Only the ringing timer, not the running ones.
    expect(m.$$(".tc-alarms .tc-row")).toHaveLength(1);
    expect(m.$(".tc-messages")).not.toBeNull();
    (alarm.querySelector(".tc-stop") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "timer_cancel", data: { id: "t1" } });
    expect(m.$(".tc-alarms")).toBeNull();
    expect(tabs(m)[1].getAttribute("aria-selected")).toBe("true");
  });

  it("shows a timer that starts ringing while Clock is open", async () => {
    const bar = newBar();
    bar.update((b) => (b.timers = b.timers.filter((t) => t.name !== "TEA")));
    const m = await open({}, bar);
    await selectTab(m, "clock");
    expect(m.$(".tc-alarms")).toBeNull();
    m.bar.update((b) => (b.timers = b.timers.map((t) => (t.name === "PIZZA" ? { ...t, ringing: true, endsAt: null, ringingSince: NOW } : t))));
    await m.sync();
    expect(m.$(".tc-alarms .tc-timer.ringing .tc-stop")).not.toBeNull();
    expect(m.$(".tc-alarms")?.textContent).toContain("PIZZA");
    expect(m.$(".tc-clock")).not.toBeNull();
  });

  it("hides a sub-tab whose entity is missing, and the control when one is left", async () => {
    const bar = newBar();
    delete bar.entities["sensor.jbl_bar_9_1_messages"];
    const m = await open({}, bar);
    expect(tabs(m).map((t) => t.id)).toEqual(["timers-compact-tab-timers", "timers-compact-tab-clock"]);
    expect(m.$(".tc-recent-messages")).toBeNull();

    const host = renderDirect((ctx) => ({
      entities: { ...ctx.entities, timers: undefined, messages: undefined, recentTimers: [], recentMessages: [] },
    }));
    expect(host.querySelector("[role=tablist]")).toBeNull();
    expect(host.querySelector(".tc-clock")).not.toBeNull();
  });

  it("falls back to the first sub-tab when the remembered one disappears", async () => {
    const bar = newBar();
    const m = await open({}, bar);
    await selectTab(m, "messages");
    cleanup();
    delete bar.entities["sensor.jbl_bar_9_1_messages"];
    const again = await open({}, bar);
    expect(again.$(".tc-timers")).not.toBeNull();
  });
});

describe("Timers compact: timers", () => {
  it("renders dense rows: ringing first with Stop, then countdown, progress, +1 and ×", async () => {
    const m = await open();
    const list = rows(m);
    expect(list).toHaveLength(3);
    expect(list[0].classList.contains("ringing")).toBe(true);
    expect(list[0].getAttribute("role")).toBe("alert");
    expect(list[0].textContent).toContain("TEA");
    expect(list[0].textContent).toContain("Time's up!");
    expect(list[0].querySelector(".tc-stop")?.textContent?.trim()).toBe("Stop");
    expect(list[1].querySelector(".tc-name")?.textContent).toBe("PIZZA");
    expect(list[1].querySelector("jbl-bar-countdown.tc-left")?.textContent).toBe("7:12");
    expect(list[1].querySelector<HTMLElement>(".tc-progress .fill")?.style.width).toBe("52%");
    expect(list[1].querySelector(".tc-extend")?.textContent?.trim()).toBe("+1 min");
    expect(list[1].querySelector(".tc-cancel")?.getAttribute("aria-label")).toBe("Cancel PIZZA");
    expect(list[2].querySelector(".tc-name")?.textContent).toBe("Timer");
  });

  it("stops a ringing timer and shows it pending", async () => {
    const m = await open();
    (rows(m)[0].querySelector(".tc-stop") as HTMLButtonElement).click();
    await m.card.updateComplete;
    const stop = rows(m)[0].querySelector(".tc-stop")!;
    expect(stop.classList.contains("pending")).toBe(true);
    expect(stop.getAttribute("aria-busy")).toBe("true");
    expect(stop.querySelector(".spinner")).not.toBeNull();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ domain: "jbl_bar_91", service: "timer_cancel", data: { id: "t1" } });
    expect(rows(m).some((r) => r.classList.contains("ringing"))).toBe(false);
    expect(tabs(m)[0].querySelector(".tc-count")?.classList.contains("alarm")).toBe(false);
  });

  it("adds a minute and cancels a running timer", async () => {
    const m = await open();
    (rows(m)[1].querySelector(".tc-extend") as HTMLButtonElement).click();
    await m.card.updateComplete;
    // Pending: a spinner before the label, like the other buttons.
    const extend = rows(m)[1].querySelector(".tc-extend")!;
    expect(extend.getAttribute("aria-busy")).toBe("true");
    expect(extend.querySelector(".spinner")).not.toBeNull();
    await settle(m);
    expect(rows(m)[1].querySelector(".tc-extend .spinner")).toBeNull();
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "timer_extend", data: { id: "t2" } });
    expect(rows(m)[1].querySelector("jbl-bar-countdown.tc-left")?.textContent).toBe("8:12");
    (rows(m)[2].querySelector(".tc-cancel") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "timer_cancel", data: { id: "t3" } });
    expect(rows(m)).toHaveLength(2);
  });

  it("stops all timers after confirmation", async () => {
    const m = await open();
    expect(m.$(".tc-timers .tc-tools .tc-count-cap")?.textContent).toBe("Active: 3");
    button(m, ".tc-tools", "Stop all").click();
    await m.card.updateComplete;
    (m.$(".dialog .btn.danger") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "timer_cancel", data: { all: true } });
    expect(m.text()).toContain("No timer is running.");
  });

  it("starts a quick timer (pending on the pressed button)", async () => {
    const bar = newBar();
    bar.update((b) => (b.timers = b.timers.filter((t) => t.name !== "")));
    const m = await open({}, bar);
    expect(m.$$(".tc-quick .tc-q").map((b) => b.textContent?.trim())).toEqual(["1 min", "5 min", "10 min", "15 min", "Custom"]);
    button(m, ".tc-quick", "5 min").click();
    await m.card.updateComplete;
    expect(button(m, ".tc-quick", "5 min").classList.contains("pending")).toBe(true);
    expect(button(m, ".tc-quick", "5 min").querySelector(".spinner")).not.toBeNull();
    expect(button(m, ".tc-quick", "10 min").classList.contains("pending")).toBe(false);
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "timer_start", data: { duration: { minutes: 5 }, sound: "unless_tv" } });
  });

  it("shows quick-start errors next to the start row", async () => {
    const m = await open();
    button(m, ".tc-quick", "5 min").click();
    await m.card.updateComplete;
    expect(m.bar.calls).toHaveLength(0);
    expect(m.$(".tc-start .strip.error")?.textContent).toContain("A timer without a name is already running");
  });

  it("starts a custom timer from the inline form", async () => {
    const m = await open();
    const custom = button(m, ".tc-quick", "Custom");
    expect(custom.getAttribute("aria-expanded")).toBe("false");
    expect(custom.getAttribute("aria-label")).toBe("Custom timer");
    expect((custom.querySelector("ha-icon") as HTMLElement & { icon: string }).icon).toBe("mdi:tune-variant");
    custom.click();
    await m.card.updateComplete;
    expect(button(m, ".tc-quick", "Custom").getAttribute("aria-expanded")).toBe("true");
    expect((button(m, ".tc-quick", "Custom").querySelector("ha-icon") as HTMLElement & { icon: string }).icon).toBe("mdi:close");
    expect(m.$('label[for="timers-name"]')?.textContent).toBe("Name (optional)");

    typeInto(m.$("#timers-name") as HTMLInputElement, "Bread #2");
    await m.card.updateComplete;
    expect(m.$("#timers-compact-name-hint")?.classList.contains("warn-text")).toBe(true);
    expect((m.$(".tc-submit") as HTMLButtonElement).disabled).toBe(true);

    typeInto(m.$("#timers-name") as HTMLInputElement, "Bread");
    typeInto(m.$("#timers-minutes") as HTMLInputElement, "20");
    button(m, ".tc-form .seg", "Always").click();
    await m.card.updateComplete;
    (m.$(".tc-submit") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({
      service: "timer_start",
      data: { duration: { minutes: 20 }, name: "Bread", show_time_left: true, sound: "always" },
    });
    expect(m.$(".tc-form")).toBeNull();
    expect(rows(m).map((r) => r.querySelector(".tc-name")?.textContent)).toContain("BREAD");
  });

  it("restarts and forgets recent timers from small chips", async () => {
    const m = await open();
    const chips = () => m.$$(".tc-recent-timers .tc-chip-run").map((c) => c.textContent?.trim());
    expect(chips()).toEqual(["EGGS · 7 min", "PASTA · 10 min", "LAUNDRY · 1 h"]);
    (m.$(".tc-recent-timers .tc-chip-run") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ domain: "button", service: "press", target: { entity_id: "button.jbl_recent_timer_1" } });
    (m.$(".tc-recent-timers .tc-chip-x") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "forget_recent", target: { entity_id: "button.jbl_recent_timer_1" } });
  });

  it("explains disabled actions in visible text, once", () => {
    const host = renderDirect(() => ({ barUnavailable: true }));
    const reasons = [...host.querySelectorAll(".tc-timers .tc-reason")].map((r) => r.textContent?.trim());
    expect(reasons).toEqual(["The soundbar is unreachable."]);
    expect((host.querySelector(".tc-stop") as HTMLButtonElement).disabled).toBe(true);
    expect((host.querySelector(".tc-extend") as HTMLButtonElement).disabled).toBe(true);
    expect([...host.querySelectorAll<HTMLButtonElement>(".tc-quick .tc-q")].slice(0, 4).every((b) => b.disabled)).toBe(true);
    expect((host.querySelector(".tc-chip-run") as HTMLButtonElement).disabled).toBe(true);
    // Forget never talks to the bar.
    expect((host.querySelector(".tc-chip-x") as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows only the unavailable text while the timers sensor is unavailable", async () => {
    const bar = newBar();
    bar.reachable = false;
    bar.update(() => undefined);
    const m = await open({}, bar);
    expect(m.text()).toContain("Timers can't be read while the soundbar is unreachable.");
    expect(m.$(".tc-quick")).toBeNull();
    expect(m.$(".tc-recent")).toBeNull();
  });
});

describe("Timers compact: messages", () => {
  it("lists the messages densely and clears one", async () => {
    const m = await open();
    await selectTab(m, "messages");
    const list = rows(m);
    expect(list).toHaveLength(2);
    expect(list[0].textContent).toContain("FRIDGE OPEN");
    expect(list[0].textContent).toContain("(fridge)");
    expect(list[0].querySelector(".tc-status")?.textContent).toBe("On display");
    expect(list[0].textContent).toContain("until cleared");
    expect(list[1].textContent).toContain("3 passes left");
    (list[0].querySelector(".tc-clear") as HTMLButtonElement).click();
    await m.card.updateComplete;
    expect(rows(m)[0].querySelector(".tc-clear")?.classList.contains("pending")).toBe(true);
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "display_cancel", data: { id: "fridge" } });
    expect(rows(m)).toHaveLength(1);
    expect(tabs(m)[1].querySelector(".tc-count")?.textContent?.trim()).toBe("1");
  });

  it("clears all messages after confirmation", async () => {
    const m = await open();
    await selectTab(m, "messages");
    button(m, ".tc-tools", "Clear all").click();
    await m.card.updateComplete;
    (m.$(".dialog .btn.danger") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "press", target: { entity_id: "button.jbl_bar_9_1_clear_all_messages" } });
    expect(m.text()).toContain("No message on the display.");
  });

  it("says why Send is disabled, previews and counts, then sends", async () => {
    const m = await open();
    await selectTab(m, "messages");
    const send = () => m.$(".tc-send") as HTMLButtonElement;
    expect(send().disabled).toBe(true);
    expect(m.$(".tc-compose .tc-reason")?.textContent).toBe("Type a text first.");

    const input = m.$("#timers-text") as HTMLInputElement;
    expect(input.getAttribute("aria-describedby")).toBe("timers-text-counter");
    typeInto(input, "Door open?");
    await m.card.updateComplete;
    expect(m.$(".tc-compose .warn-text")?.textContent).toContain("?");
    // The warning says it: no second reason line.
    expect(m.$(".tc-compose .tc-reason")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBe("true");

    typeInto(input, "Café ouvert");
    await m.card.updateComplete;
    expect(m.$(".tc-lcd")?.textContent).toBe("CAFE OUVERT");
    expect(m.$(".tc-counter")?.textContent).toBe("11/31");
    button(m, ".tc-compose .seg", "Repeat").click();
    await m.card.updateComplete;
    expect(m.$(".tc-repeat")?.textContent).toBe("3 times");
    (m.$$(".tc-stepper button")[1] as HTMLButtonElement).click();
    await m.card.updateComplete;
    (m.$(".tc-clear-on-key") as HTMLButtonElement).click();
    await m.card.updateComplete;
    expect(send().disabled).toBe(false);
    send().click();
    await m.card.updateComplete;
    expect(send().classList.contains("pending")).toBe(true);
    await settle(m);
    expect(m.bar.calls.at(-1)?.data).toEqual({ message: "Café ouvert", repeat: 4 });
    expect((m.$("#timers-text") as HTMLInputElement).value).toBe("");
  });

  it("sends a timed message with when_on and shows its hint", async () => {
    const m = await open();
    await selectTab(m, "messages");
    typeInto(m.$("#timers-text") as HTMLInputElement, "Pizza ready");
    button(m, ".tc-compose .seg", "Timed").click();
    await m.card.updateComplete;
    const select = m.$("#timers-duration") as HTMLSelectElement;
    select.value = "30";
    select.dispatchEvent(new Event("change"));
    (m.$(".tc-when-on-switch") as HTMLButtonElement).click();
    await m.card.updateComplete;
    expect(m.$(".tc-compose")?.textContent).toContain("In standby the message waits");
    (m.$(".tc-send") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)?.data).toEqual({ message: "Pizza ready", duration: { minutes: 30 }, clear_on_key: true, when_on: true });
  });

  it("forgets a recent message on long press", async () => {
    const m = await open();
    await selectTab(m, "messages");
    const chip = m.$$(".tc-recent-messages .tc-chip-run")[1];
    expect(chip.textContent?.trim()).toBe("CALL MOM · 3 times");
    chip.dispatchEvent(new PointerEvent("pointerdown", { button: 0 }));
    await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 60));
    chip.dispatchEvent(new PointerEvent("pointerup"));
    chip.click();
    await settle(m);
    expect(m.bar.calls.map((c) => c.service)).toEqual(["forget_recent"]);
  });
});

describe("Timers compact: repeat stepper", () => {
  it("explains the stepper at its limits", () => {
    const withRepeat = (repeat: number): HTMLElement =>
      renderDirect((ctx) => {
        Object.assign(ctx.local<TimersLocal>(TIMERS_LOCAL_KEY, initTimersLocal), { mode: "repeat", repeat, text: "Hi" });
        return { entities: { ...ctx.entities, timers: undefined, display_clock: undefined } };
      });
    const reasons = (host: HTMLElement): (string | undefined)[] => [...host.querySelectorAll(".tc-compose .tc-reason")].map((r) => r.textContent?.trim());
    const low = withRepeat(1);
    expect([...low.querySelectorAll<HTMLButtonElement>(".tc-stepper button")].map((b) => b.disabled)).toEqual([true, false]);
    expect(reasons(low)).toEqual(["The message shows at least once."]);
    expect(reasons(withRepeat(99))).toEqual(["The message repeats at most 99 times."]);
    expect(reasons(withRepeat(3))).toEqual([]);
  });
});

describe("Timers compact: clock", () => {
  it("switches the clock and when it shows, with explanations", async () => {
    const m = await open();
    await selectTab(m, "clock");
    const sw = () => m.$(".tc-clock-switch") as HTMLButtonElement;
    expect(sw().getAttribute("role")).toBe("switch");
    expect(sw().getAttribute("aria-checked")).toBe("true");
    expect(m.$(".tc-clock")?.textContent).toContain("Shows the time on the front display");
    expect(m.$(".tc-clock")?.textContent).toContain("In standby: only while the bar is in standby.");
    sw().click();
    await m.card.updateComplete;
    expect(sw().classList.contains("pending")).toBe(true);
    await settle(m);
    expect(m.bar.clockOn).toBe(false);
    expect(sw().getAttribute("aria-checked")).toBe("false");
    button(m, ".tc-clock-when", "Always").click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({
      domain: "select",
      service: "select_option",
      data: { option: "always" },
      target: { entity_id: "select.jbl_display_clock_when" },
    });
  });

  it("shows one visible reason while the bar is unreachable, with every clock control disabled", async () => {
    const bar = newBar();
    bar.reachable = false;
    bar.update(() => undefined);
    const m = await open({}, bar);
    await selectTab(m, "clock");
    expect((m.$(".tc-clock-switch") as HTMLButtonElement).disabled).toBe(true);
    const options = m.$$(".tc-clock-when [role=radio]") as HTMLButtonElement[];
    expect(options.length).toBe(2);
    expect(options.every((o) => o.disabled)).toBe(true);
    // The switch and both options share the unreachable reason: it shows once.
    expect(m.$$(".tc-clock .tc-reason").map((r) => r.textContent?.trim())).toEqual(["The soundbar is unreachable."]);
  });

  it("explains disabled 'Shows' options while the select alone is unavailable", () => {
    const host = renderDirect((ctx) => ({
      entities: { ...ctx.entities, timers: undefined, messages: undefined },
      isAvailable: (id) => id !== ctx.entities.display_clock_when && ctx.isAvailable(id),
    }));
    expect((host.querySelector(".tc-clock-switch") as HTMLButtonElement).disabled).toBe(false);
    expect([...host.querySelectorAll<HTMLButtonElement>(".tc-clock-when [role=radio]")].every((o) => o.disabled)).toBe(true);
    expect([...host.querySelectorAll(".tc-clock .tc-reason")].map((r) => r.textContent?.trim())).toEqual(['The "Shows" setting is unavailable.']);
  });

  it("explains a disabled clock switch and hides 'Shows' on remotes without it", () => {
    const host = renderDirect((ctx) => ({
      entities: { ...ctx.entities, timers: undefined, messages: undefined, display_clock_when: undefined },
      stateOf: (id) => {
        const st = ctx.stateOf(id);
        return st && id === ctx.entities.display_clock ? { ...st, state: "unknown" } : st;
      },
    }));
    expect((host.querySelector(".tc-clock-switch") as HTMLButtonElement).disabled).toBe(true);
    expect(host.querySelector(".tc-clock .tc-reason")?.textContent?.trim()).toBe("The clock's state is unknown.");
    expect(host.querySelector(".tc-clock-when")).toBeNull();
  });
});

describe("Timers compact: languages", () => {
  it("translates the sub-tabs into Ukrainian and French", async () => {
    const uk = await open({}, newBar({ language: "uk" }));
    expect(tabs(uk).map((t) => t.querySelector(".tc-tab-label")?.textContent)).toEqual(["Таймери", "Повідомлення", "Годинник"]);
    cleanup();
    const fr = await open({}, newBar({ language: "fr" }));
    expect(tabs(fr).map((t) => t.querySelector(".tc-tab-label")?.textContent)).toEqual(["Minuteurs", "Messages", "Horloge"]);
  });
});
