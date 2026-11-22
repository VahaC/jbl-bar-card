import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { LONG_PRESS_MS, renderTimersTab } from "../src/tabs/timers";
import { TIMERS_LOCAL_KEY, initTimersLocal } from "../src/tabs/timers-model";
import type { TimersLocal } from "../src/tabs/timers-model";
import type { TabContext } from "../src/types";
import { NOW, cleanup, mountCard, newBar, settle, tabContext } from "./helpers";
import type { Mounted } from "./helpers";

const KITCHEN = { default_tab: "timers" as const, layouts: { timers: "kitchen" as const } };

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const open = (config: Parameters<typeof mountCard>[0] = {}, bar = newBar()): Promise<Mounted> => mountCard({ ...KITCHEN, ...config }, bar);

const typeInto = (input: HTMLInputElement, value: string): void => {
  input.value = value;
  input.dispatchEvent(new Event("input"));
};
const byText = (m: Mounted, selector: string, text: string): HTMLButtonElement =>
  m.$$(selector).find((b) => b.textContent?.replace(/\s+/g, " ").trim() === text) as HTMLButtonElement;
const quick = (m: Mounted, minutes: number): HTMLButtonElement =>
  m.$$(".k-quick-btn:not(.k-custom)").find((b) => b.querySelector(".k-disc")?.textContent?.trim() === String(minutes)) as HTMLButtonElement;
const noUnnamed = () => {
  const bar = newBar();
  bar.update((b) => (b.timers = b.timers.filter((t) => t.name !== "")));
  return bar;
};

/** Render the kitchen layout straight from a (patched) tab context. */
function renderWith(patch: (ctx: TabContext) => Partial<TabContext>): HTMLElement {
  const ctx = tabContext(newBar(), KITCHEN);
  const host = document.createElement("div");
  document.body.append(host);
  render(renderTimersTab({ ...ctx, ...patch(ctx) }), host);
  return host;
}

describe("Kitchen layout: hero", () => {
  it("puts the ringing timer in the hero with a big Stop, the others in a list", async () => {
    const m = await open();
    expect(m.$(".timers-kitchen")).not.toBeNull();
    expect(m.$(".timers")).toBeNull();
    const hero = m.$(".k-hero")!;
    expect(hero.classList.contains("ringing")).toBe(true);
    expect(hero.getAttribute("role")).toBe("alert");
    expect(hero.querySelector(".k-hero-name")?.textContent).toBe("TEA");
    expect(hero.textContent).toContain("Time's up!");
    expect(hero.querySelector(".k-stop")?.textContent?.trim()).toBe("Stop");
    expect(hero.querySelector(".k-stop")?.getAttribute("aria-label")).toBe("Stop TEA");
    expect(m.$$(".k-others .k-row .k-row-name").map((n) => n.textContent)).toEqual(["PIZZA", "Timer"]);
    expect(m.$(".k-others .k-row jbl-bar-countdown.k-row-left")?.textContent).toBe("7:12");
    expect(m.$(".k-timers .k-head .badge")?.textContent).toBe("3");
  });

  it("keeps extra ringing rows plain list items with the alert inside", () => {
    const host = renderWith((ctx) => {
      const id = ctx.entities.timers!;
      const st = ctx.hass.states[id];
      const list = (st.attributes.timers as Record<string, unknown>[]).map((x) => ({ ...x, ringing: true }));
      return { stateOf: (x) => (x === id ? { ...st, attributes: { ...st.attributes, timers: list } } : ctx.stateOf(x)) };
    });
    const rows = [...host.querySelectorAll(".k-others .k-row.ringing")];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tagName).toBe("LI");
      expect(row.hasAttribute("role")).toBe(false);
      expect(row.querySelector(".k-row-main")?.getAttribute("role")).toBe("alert");
      expect(row.querySelector(".k-row-main")?.textContent).toContain("Time's up!");
    }
  });

  it("shrinks the dial countdown when it shows hours", () => {
    const host = renderWith((ctx) => {
      const id = ctx.entities.timers!;
      const st = ctx.hass.states[id];
      const list = (st.attributes.timers as Record<string, unknown>[])
        .filter((x) => !x.ringing)
        .map((x, i) => (i === 0 ? { ...x, duration_s: 720 * 60, ends_at: new Date(NOW + 719 * 60_000 + 59_000).toISOString() } : x));
      return { stateOf: (x) => (x === id ? { ...st, attributes: { ...st.attributes, timers: list } } : ctx.stateOf(x)) };
    });
    const time = host.querySelector(".k-hero jbl-bar-countdown.k-time")!;
    expect(time.textContent).toBe("11:59:59");
    expect(time.classList.contains("hours")).toBe(true);
  });

  it("stops the ringing timer, then shows the next one as a ring countdown", async () => {
    const m = await open();
    m.$(".k-stop")!.click();
    await m.card.updateComplete;
    expect(m.$(".k-stop")?.classList.contains("pending")).toBe(true);
    expect(m.$(".k-stop .spinner")).not.toBeNull();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ domain: "jbl_bar_91", service: "timer_cancel", data: { id: "t1" } });

    const hero = m.$(".k-hero")!;
    expect(hero.classList.contains("ringing")).toBe(false);
    expect(hero.querySelector(".k-eyebrow")?.textContent).toBe("Next up");
    expect(hero.querySelector(".k-hero-name")?.textContent).toBe("PIZZA");
    expect(hero.querySelector("jbl-bar-countdown.k-time")?.textContent).toBe("7:12");
    const ring = hero.querySelector("jbl-bar-countdown.k-ring")!;
    expect(ring.getAttribute("role")).toBe("progressbar");
    expect(ring.getAttribute("aria-valuenow")).toBe("52");
    expect(ring.getAttribute("aria-label")).toBe("PIZZA");
    expect(hero.textContent).toContain("ends at");
    expect(m.$$(".k-others .k-row-name").map((n) => n.textContent)).toEqual(["Timer"]);
  });

  it("adds a minute and cancels the hero timer", async () => {
    const bar = newBar();
    bar.update((b) => (b.timers = b.timers.filter((t) => !t.ringing)));
    const m = await open({}, bar);
    expect(m.$(".k-hero-name")?.textContent).toBe("PIZZA");
    const extend = m.$(".k-hero .k-extend")!;
    expect(extend.textContent?.trim()).toBe("+1 min");
    extend.click();
    await m.card.updateComplete;
    expect(m.$(".k-hero .k-extend")?.classList.contains("pending")).toBe(true);
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "timer_extend", data: { id: "t2" } });
    expect(m.$(".k-hero jbl-bar-countdown.k-time")?.textContent).toBe("8:12");
    expect(m.$(".k-hero jbl-bar-countdown.k-time")?.classList.contains("hours")).toBe(false);

    const cancel = m.$(".k-hero .k-cancel")!;
    expect(cancel.textContent?.trim()).toBe("Cancel");
    cancel.click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "timer_cancel", data: { id: "t2" } });
    expect(m.$(".k-hero-name")?.textContent).toBe("Timer");
    expect(m.$(".k-others")).toBeNull();
  });

  it("extends and cancels a timer from the list", async () => {
    const m = await open();
    m.$$(".k-others .k-row-extend")[0].click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "timer_extend", data: { id: "t2" } });
    m.$$(".k-others .k-row-cancel")[1].click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "timer_cancel", data: { id: "t3" } });
  });

  it("stops all timers after confirmation", async () => {
    const m = await open();
    m.$(".k-stop-all")!.click();
    await m.card.updateComplete;
    expect(m.$(".dialog")?.textContent).toContain("Stop all timers?");
    (m.$(".dialog .btn.danger") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "timer_cancel", data: { all: true } });
    expect(m.$(".k-idle")?.textContent).toContain("No timer is running.");
    expect(m.$(".k-idle")?.textContent).toContain("Pick a time below");
  });

  it("draws a plain ring on remotes that do not report the duration", () => {
    const host = renderWith((ctx) => {
      const id = ctx.entities.timers!;
      const st = ctx.hass.states[id];
      const list = (st.attributes.timers as Record<string, unknown>[]).filter((x) => !x.ringing).map((x) => ({ ...x, duration_s: null }));
      return { stateOf: (x) => (x === id ? { ...st, attributes: { ...st.attributes, timers: list } } : ctx.stateOf(x)) };
    });
    expect(host.querySelector(".k-hero .k-ring")).toBeNull();
    expect(host.querySelector(".k-hero .k-ring-static")).not.toBeNull();
    expect(host.querySelector(".k-extend, .k-row-extend")).toBeNull();
    expect(host.querySelector(".k-row-bar")).toBeNull();
  });
});

describe("Kitchen layout: starting timers", () => {
  it("starts a quick timer from a round button", async () => {
    const m = await open({}, noUnnamed());
    expect(m.$$(".k-quick-btn").length).toBe(5);
    expect(quick(m, 5).getAttribute("aria-label")).toBe("Start a 5-minute timer");
    quick(m, 5).click();
    await m.card.updateComplete;
    expect(quick(m, 5)).toBeUndefined(); // the number gives way to a spinner
    const pending = m.$(".k-quick-btn.pending")!;
    expect(pending.getAttribute("aria-busy")).toBe("true");
    expect(pending.querySelector(".spinner")).not.toBeNull();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({
      domain: "jbl_bar_91",
      service: "timer_start",
      data: { duration: { minutes: 5 }, sound: "unless_tv" },
    });
    expect(m.$(".k-quick-btn.pending")).toBeNull();
  });

  it("shows the model's error under the quick buttons", async () => {
    const m = await open();
    quick(m, 10).click();
    await m.card.updateComplete;
    expect(m.bar.calls).toHaveLength(0);
    expect(m.$(".k-start .strip.error")?.textContent).toContain("A timer without a name is already running");
  });

  it("opens the custom form, checks the name and starts a named timer", async () => {
    const m = await open();
    const custom = m.$(".k-custom")!;
    expect(custom.getAttribute("aria-expanded")).toBe("false");
    expect(custom.hasAttribute("aria-controls")).toBe(false);
    expect(custom.getAttribute("aria-label")).toBe("Custom timer");
    expect((custom.querySelector("ha-icon") as HTMLElement & { icon: string }).icon).toBe("mdi:tune-variant");
    expect(m.$(".k-form")).toBeNull();
    custom.click();
    await m.card.updateComplete;
    expect(m.$(".k-custom")?.getAttribute("aria-expanded")).toBe("true");
    expect(m.$(".k-custom")?.getAttribute("aria-controls")).toBe("k-timer-form");
    expect((m.$(".k-custom ha-icon") as HTMLElement & { icon: string }).icon).toBe("mdi:close");
    expect(m.$("#k-timer-form")).not.toBeNull();
    const name = m.$("#timers-name") as HTMLInputElement;
    expect(m.$('label[for="timers-name"]')?.textContent).toBe("Name (optional)");

    typeInto(name, "Bread #2");
    await m.card.updateComplete;
    const submit = m.$(".k-form .k-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(m.$(".k-form .k-name-hint.warn-text")?.textContent).toContain("#");
    // The reason is already on screen as the name warning: not repeated.
    expect(m.$(".k-form .k-reason")).toBeNull();

    typeInto(name, "Bread");
    typeInto(m.$("#timers-minutes") as HTMLInputElement, "20");
    byText(m, ".k-form .seg button", "Always").click();
    m.$(".k-form .k-show-left")!.click();
    await m.card.updateComplete;
    expect(m.$(".k-form .k-name-hint")?.textContent).toContain("On the bar: BREAD");
    (m.$(".k-form .k-submit") as HTMLButtonElement).click();
    await m.card.updateComplete;
    expect(m.$(".k-form .k-submit")?.classList.contains("pending")).toBe(true);
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({
      service: "timer_start",
      data: { duration: { minutes: 20 }, name: "Bread", sound: "always", show_time_left: false },
    });
    expect(m.$(".k-form")).toBeNull();
    expect(m.$$(".k-others .k-row-name").map((n) => n.textContent)).toContain("BREAD");
  });
});

describe("Kitchen layout: recent timers", () => {
  const chips = (m: Mounted, kind = "timers"): string[] =>
    m.$$(`.k-recent-${kind} .k-chip-restart`).map((c) => c.textContent?.replace(/\s+/g, " ").trim() ?? "");

  it("restarts on tap and forgets with ×", async () => {
    const m = await open();
    expect(chips(m)).toEqual(["EGGS · 7 min", "PASTA · 10 min", "LAUNDRY · 1 h"]);
    m.$(".k-recent-timers .k-chip-restart")!.click();
    await m.card.updateComplete;
    expect(m.$(".k-recent-timers .k-chip")?.classList.contains("pending")).toBe(true);
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ domain: "button", service: "press", target: { entity_id: "button.jbl_recent_timer_1" } });

    m.$(".k-recent-timers .k-chip-forget")!.click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "forget_recent", target: { entity_id: "button.jbl_recent_timer_1" } });
    expect(chips(m)).toEqual(["LAUNDRY · 1 h"]);
  });

  it("forgets on long press and on right-click", async () => {
    const m = await open();
    const chip = m.$$(".k-recent-timers .k-chip-restart")[1];
    chip.dispatchEvent(new PointerEvent("pointerdown", { button: 0 }));
    await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 60));
    chip.dispatchEvent(new PointerEvent("pointerup"));
    chip.click();
    await settle(m);
    expect(m.bar.calls.map((c) => c.service)).toEqual(["forget_recent"]);
    expect(m.bar.calls[0].target).toEqual({ entity_id: "button.jbl_recent_timer_2" });

    vi.spyOn(Date, "now").mockReturnValue(NOW + 5000);
    m.$$(".k-recent-timers .k-chip-restart")[0].dispatchEvent(new Event("contextmenu", { cancelable: true }));
    await settle(m);
    expect(m.bar.calls.map((c) => c.service)).toEqual(["forget_recent", "forget_recent"]);
    expect(m.bar.calls[1].target).toEqual({ entity_id: "button.jbl_recent_timer_1" });
  });
});

describe("Kitchen layout: display section", () => {
  it("is collapsed by default, with a count badge", async () => {
    const m = await open();
    const details = m.$("details.k-display") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toContain("Display");
    expect(details.querySelector(".k-display-count")?.textContent).toBe("2");
    expect(details.querySelector("summary .sr-only")?.textContent).toBe("2 messages");
    // The browser keeps it open across renders.
    details.open = true;
    await m.sync();
    expect((m.$("details.k-display") as HTMLDetailsElement).open).toBe(true);
  });

  it("lists messages and clears one or all", async () => {
    const m = await open();
    const rows = m.$$(".k-display .k-message");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("FRIDGE OPEN");
    expect(rows[0].textContent).toContain("(fridge)");
    expect(rows[0].textContent).toContain("On display");
    expect(rows[1].textContent).toContain("3 passes left");
    (rows[0].querySelector(".k-msg-clear") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "display_cancel", data: { id: "fridge" } });
    expect(m.$(".k-display-count")?.textContent).toBe("1");

    m.$(".k-clear-all")!.click();
    await m.card.updateComplete;
    (m.$(".dialog .btn.danger") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ domain: "button", service: "press" });
    expect(m.$(".k-display-count")).toBeNull();
    expect(m.$(".k-messages")?.textContent).toContain("No message on the display.");
  });

  it("explains why Send is off, then sends a timed message", async () => {
    const m = await open();
    const send = () => m.$(".k-compose .k-send") as HTMLButtonElement;
    expect(send().disabled).toBe(true);
    expect(m.$(".k-compose .k-reason")?.textContent).toContain("Type a text first.");

    const input = m.$("#timers-text") as HTMLInputElement;
    typeInto(input, "Door open?");
    await m.card.updateComplete;
    expect(m.$(".k-compose .k-warning")?.textContent).toContain("?");
    expect(m.$(".k-compose .k-reason")).toBeNull(); // the warning already says why

    typeInto(input, "Pizza ready");
    byText(m, ".k-compose .seg button", "Timed").click();
    await m.card.updateComplete;
    expect(m.$(".k-lcd")?.textContent).toBe("PIZZA READY");
    expect(m.$(".k-counter")?.textContent).toBe("11/31");
    const select = m.$("#timers-duration") as HTMLSelectElement;
    select.value = "30";
    select.dispatchEvent(new Event("change"));
    await m.card.updateComplete;
    send().click();
    await m.card.updateComplete;
    expect(send().classList.contains("pending")).toBe(true);
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({
      service: "display_message",
      data: { message: "Pizza ready", duration: { minutes: 30 }, clear_on_key: true },
    });
    expect((m.$("#timers-text") as HTMLInputElement).value).toBe("");
  });

  it("sends a repeated message with when_on", async () => {
    const m = await open();
    typeInto(m.$("#timers-text") as HTMLInputElement, "Bed time");
    byText(m, ".k-compose .seg button", "Repeat").click();
    await m.card.updateComplete;
    expect(m.$(".k-repeat-value")?.textContent).toBe("3 times");
    m.$$(".k-compose .stepper button")[1].click();
    m.$(".k-clear-on-key")!.click();
    m.$(".k-when-on")!.click();
    await m.card.updateComplete;
    expect(m.$(".k-when-on-hint")?.textContent).toContain("In standby the message waits");
    (m.$(".k-compose .k-send") as HTMLButtonElement).click();
    await settle(m);
    expect(m.bar.calls.at(-1)?.data).toEqual({ message: "Bed time", repeat: 4, when_on: true });
  });

  it("restarts a recent message", async () => {
    const m = await open();
    m.$(".k-recent-messages .k-chip-restart")!.click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ service: "press", target: { entity_id: "button.jbl_recent_message_1" } });
  });

  it("switches the clock and when it shows", async () => {
    const m = await open();
    const sw = m.$(".k-clock-switch")!;
    expect(sw.getAttribute("aria-checked")).toBe("true");
    sw.click();
    await m.card.updateComplete;
    expect(m.$(".k-clock-switch")?.classList.contains("pending")).toBe(true);
    await settle(m);
    expect(m.bar.clockOn).toBe(false);
    byText(m, ".k-clock-when .seg button", "Always").click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ domain: "select", service: "select_option", data: { option: "always" } });
    expect(m.bar.clockWhen).toBe("always");
  });
});

describe("Kitchen layout: reasons and missing entities", () => {
  it("shows why actions are off while the bar is unreachable", () => {
    const host = renderWith(() => ({ barUnavailable: true }));
    const reason = "The soundbar is unreachable.";
    expect((host.querySelector(".k-stop") as HTMLButtonElement).disabled).toBe(true);
    expect(host.querySelector(".k-hero .k-reason")?.textContent).toContain(reason);
    expect(host.querySelector(".k-others .k-reason")?.textContent).toContain(reason);
    expect(host.querySelectorAll<HTMLButtonElement>(".k-quick-btn:not(.k-custom)")[0].disabled).toBe(true);
    expect(host.querySelector(".k-start > .k-reason")?.textContent).toContain(reason);
    expect(host.querySelector(".k-recent-timers .k-reason")?.textContent).toContain(reason);
    // Forget never talks to the bar: it stays enabled.
    expect(host.querySelector<HTMLButtonElement>(".k-chip-forget")?.disabled).toBe(false);
    expect(host.querySelector(".k-messages .k-reason")?.textContent).toContain(reason);
  });

  it("shows the unreachable reason once for the clock switch and its 'Shows' options", () => {
    const host = renderWith(() => ({ barUnavailable: true }));
    expect(host.querySelector<HTMLButtonElement>(".k-clock-switch")?.disabled).toBe(true);
    expect([...host.querySelectorAll<HTMLButtonElement>(".k-clock-when [role=radio]")].map((o) => o.disabled)).toEqual([true, true]);
    expect([...host.querySelectorAll(".k-clock .k-reason")].map((r) => r.textContent?.trim())).toEqual(["The soundbar is unreachable."]);
  });

  it("explains disabled 'Shows' options while the select alone is unavailable", () => {
    const host = renderWith((ctx) => ({ isAvailable: (id) => id !== ctx.entities.display_clock_when && ctx.isAvailable(id) }));
    expect(host.querySelector<HTMLButtonElement>(".k-clock-switch")?.disabled).toBe(false);
    expect(host.querySelector(".k-clock .k-reason")?.textContent?.trim()).toBe('The "Shows" setting is unavailable.');
  });

  it("explains the repeat stepper at its limits", () => {
    const withRepeat = (repeat: number): HTMLElement =>
      renderWith((ctx) => {
        Object.assign(ctx.local<TimersLocal>(TIMERS_LOCAL_KEY, initTimersLocal), { mode: "repeat", repeat });
        return {};
      });
    const low = withRepeat(1);
    expect([...low.querySelectorAll<HTMLButtonElement>(".k-compose .stepper button")].map((b) => b.disabled)).toEqual([true, false]);
    expect(low.querySelector(".k-mode-detail .k-reason")?.textContent?.trim()).toBe("The message shows at least once.");
    const high = withRepeat(99);
    expect(high.querySelector(".k-mode-detail .k-reason")?.textContent?.trim()).toBe("The message repeats at most 99 times.");
    expect(withRepeat(3).querySelector(".k-mode-detail .k-reason")).toBeNull();
  });

  it("shows why the clock switch is off while its state is unknown", () => {
    const host = renderWith((ctx) => ({
      stateOf: (id) => {
        const st = ctx.stateOf(id);
        return id === ctx.entities.display_clock && st ? { ...st, state: "unknown" } : st;
      },
    }));
    expect(host.querySelector<HTMLButtonElement>(".k-clock-switch")?.disabled).toBe(true);
    expect(host.querySelector(".k-clock .k-reason")?.textContent).toContain("The clock's state is unknown.");
  });

  it("shows only the unavailable text when the timers can't be read", async () => {
    const bar = newBar();
    bar.reachable = false;
    bar.update(() => undefined);
    const m = await open({}, bar);
    expect(m.$(".k-unavailable")?.textContent).toContain("Timers can't be read while the soundbar is unreachable.");
    expect(m.$(".k-quick")).toBeNull();
    expect(m.$(".k-hero")).toBeNull();
  });

  it("hides the blocks whose entities are missing", async () => {
    const bar = newBar();
    delete bar.entities["sensor.jbl_bar_9_1_messages"];
    const m = await open({}, bar);
    expect(m.$(".k-timers")).not.toBeNull();
    expect(m.$(".k-display")).not.toBeNull();
    expect(m.$(".k-messages")).toBeNull();
    expect(m.$(".k-display-count")).toBeNull();
    expect(m.$(".k-clock")).not.toBeNull();

    const host = renderWith((ctx) => ({
      entities: { ...ctx.entities, timers: undefined, messages: undefined, display_clock: undefined, display_clock_when: undefined },
    }));
    expect(host.querySelector(".timers-kitchen")).not.toBeNull();
    expect(host.querySelector(".k-timers")).toBeNull();
    expect(host.querySelector(".k-display")).toBeNull();
  });

  it("shows the clock without the 'when' choice on remotes that lack it", () => {
    const host = renderWith((ctx) => ({ entities: { ...ctx.entities, display_clock_when: undefined } }));
    expect(host.querySelector(".k-clock-switch")).not.toBeNull();
    expect(host.querySelector(".k-clock-when")).toBeNull();
  });

  it("translates the layout's own words", async () => {
    const uk = await open({}, newBar({ language: "uk" }));
    expect(uk.$("summary")?.textContent).toContain("Дисплей");
    expect(uk.$(".k-display-count + .sr-only")?.textContent).toBe("2 повідомлення");
    expect(uk.$(".k-cap")?.textContent).toBe("хв");
    cleanup();
    const fr = await open({}, newBar({ language: "fr" }));
    expect(fr.$("summary")?.textContent).toContain("Afficheur");
    expect(fr.$(".k-sub")?.textContent).toBe("Également en cours");
  });

  it("uses natural words for the next timer", async () => {
    const bar = newBar({ language: "uk" });
    bar.update((b) => (b.timers = b.timers.filter((t) => !t.ringing)));
    const uk = await open({}, bar);
    expect(uk.$(".k-eyebrow")?.textContent).toBe("Найближчий");
    cleanup();
    const frBar = newBar({ language: "fr" });
    frBar.update((b) => (b.timers = b.timers.filter((t) => !t.ringing)));
    const fr = await open({}, frBar);
    expect(fr.$(".k-eyebrow")?.textContent).toBe("À suivre");
  });
});
