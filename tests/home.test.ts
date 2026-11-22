import { afterEach, describe, expect, it } from "vitest";
import { render } from "lit";
import { IMAGES } from "../src/assets";
import { batteryIcon, renderHomeTab } from "../src/tabs/home";
import { cleanup, mountCard, newBar, settle, tabContext } from "./helpers";

afterEach(cleanup);

describe("card shell", () => {
  it("renders the header with name, subtitle and power", async () => {
    const m = await mountCard();
    expect(m.$(".name")?.textContent).toBe("JBL Bar 9.1");
    expect(m.$(".subtitle")?.textContent).toBe("Bluetooth · Standard · PCM 2.0");
    expect(m.$(".power")?.getAttribute("aria-pressed")).toBe("true");
    // A fixed name with aria-pressed (no "Turn off, pressed"); the action is the tooltip.
    expect(m.$(".power")?.getAttribute("aria-label")).toBe("Power");
    expect(m.$(".power")?.getAttribute("title")).toBe("Turn off");
    expect(m.$$(".tab").map((t) => t.textContent?.trim())).toEqual(["Home", "Sound", "Timers", "System"]);
  });

  it("uses the name override and hides tabs in compact mode", async () => {
    const m = await mountCard({ compact: true, name: "Living room" });
    expect(m.$(".name")?.textContent).toBe("Living room");
    expect(m.$(".tabs")).toBeNull();
    expect(m.$(".room")).not.toBeNull();
  });

  it("switches tabs and honours the tab list", async () => {
    const m = await mountCard({ tabs: ["home", "system"], default_tab: "system" });
    expect(m.$$(".tab")).toHaveLength(2);
    expect(m.$('.tab[aria-selected="true"]')?.textContent?.trim()).toBe("System");
    m.$$(".tab")[0].click();
    await m.card.updateComplete;
    expect(m.$(".room")).not.toBeNull();
  });

  it("translates to Ukrainian and French", async () => {
    const uk = await mountCard({}, newBar({ language: "uk" }));
    expect(uk.$$(".tab").map((t) => t.textContent?.trim())).toEqual(["Головна", "Звук", "Таймери", "Система"]);
    expect(uk.text()).toContain("Задні колонки зняті");
    cleanup();
    const fr = await mountCard({}, newBar({ language: "fr" }));
    expect(fr.text()).toContain("Enceintes arrière détachées");
  });

  it("explains a wrong entity with the bars it can see", async () => {
    const m = await mountCard({ entity: "media_player.living_room" });
    expect(m.text()).toContain("media_player.living_room does not exist");
    expect(m.text()).toContain("media_player.jbl_bar_9_1");
  });

  it("shows what the bar is doing, and where the command came from", async () => {
    const bar = newBar();
    const m = await mountCard({}, bar);
    bar.update((b) => (b.local = { action: "bass_next", source: "remote" }));
    await m.sync();
    expect(m.$(".strip.busy")?.textContent).toContain("Setting the bass level… (from the web page)");
    bar.update((b) => (b.local = { action: "something_new", source: "home_assistant" }));
    await m.sync();
    expect(m.$(".strip.busy")?.textContent).toContain("Running something_new…");
  });

  it("refuses commands while the bar is unreachable instead of failing silently", async () => {
    const bar = newBar();
    bar.reachable = false;
    bar.update(() => undefined);
    const m = await mountCard({}, bar);
    expect(m.$(".strip.offline")).not.toBeNull();
    expect((m.$(".power") as HTMLButtonElement).disabled).toBe(true);
    const ctx = tabContext(bar);
    const ok = await ctx.call("home.mute", () => ctx.services.mute(true));
    expect(ok).toBe(false);
    expect(bar.calls).toHaveLength(0);
  });
});

describe("Home tab", () => {
  it("draws the speakers with batteries, bass level and dock state", async () => {
    const m = await mountCard();
    const left = m.$(".spk.left")!;
    expect(left.textContent).toContain("14%");
    expect(left.classList.contains("low")).toBe(true);
    expect(m.$(".spk.right")?.classList.contains("low")).toBe(false);
    expect(m.$(".spk.sub")?.textContent).toContain("Bass 3/5");
    expect(m.$(".dock-label")?.textContent).toBe("Rears detached");
  });

  it("draws the speakers apart when detached and one bar when docked", async () => {
    const detached = await mountCard();
    expect(detached.$$(".pic-cell.left, .pic-cell.right")).toHaveLength(2);
    expect(detached.$(".bar-pic")?.getAttribute("src")).toBe(IMAGES.barCenter);
    expect(detached.$(".sub-pic")?.getAttribute("src")).toBe(IMAGES.subwoofer);

    const bar = newBar();
    bar.update((b) => (b.docked = true));
    const docked = await mountCard({}, bar);
    expect(docked.$$(".pic-cell.left, .pic-cell.right")).toHaveLength(0);
    expect(docked.$(".bar-pic")?.getAttribute("src")).toBe(IMAGES.barDocked);
    expect(docked.$(".spk.left")?.textContent).toContain("14%");
    expect(docked.$(".dock-label")?.textContent).toBe("Rears docked");
  });

  it("selects the source with a pending state until the bar confirms", async () => {
    const m = await mountCard();
    const seg = () => m.$$(".seg button");
    expect(seg().map((b) => b.textContent?.trim())).toEqual(["TV", "HDMI", "Bluetooth"]);
    expect(seg()[2].classList.contains("active")).toBe(true);
    seg()[1].click();
    await m.card.updateComplete;
    expect(seg()[1].classList.contains("pending")).toBe(true);
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ domain: "media_player", service: "select_source", data: { source: "HDMI" } });
    expect(seg()[1].classList.contains("active")).toBe(true);
    expect(seg()[1].classList.contains("pending")).toBe(false);
    expect(m.$(".subtitle")?.textContent).toBe("HDMI · Standard · DOLBY ATMOS");
  });

  it("steps the volume and shows the target while pending", async () => {
    const m = await mountCard();
    expect(m.$(".vol-number")?.textContent).toContain("14");
    const plus = m.$$(".volume .icon-btn")[1];
    plus.click();
    await m.card.updateComplete;
    expect(m.$(".vol-number")?.textContent).toContain("15");
    expect(m.$(".vol-number")?.classList.contains("pending")).toBe(true);
    await settle(m);
    expect(m.bar.calls.map((c) => c.service)).toEqual(["volume_up"]);
    expect(m.bar.volume).toBe(15);
    expect(m.$(".vol-number")?.classList.contains("pending")).toBe(false);
  });

  it("sends the slider value once on change", async () => {
    const m = await mountCard();
    const slider = m.$("input.slider") as HTMLInputElement;
    slider.value = "20";
    slider.dispatchEvent(new Event("input"));
    await m.card.updateComplete;
    expect(m.$(".vol-number")?.textContent).toContain("20");
    expect(m.bar.calls).toHaveLength(0);
    slider.dispatchEvent(new Event("change"));
    await settle(m);
    expect(m.bar.calls.map((c) => [c.service, c.data])).toEqual([["volume_set", { volume_level: 20 / 32 }]]);
    expect(m.bar.volume).toBe(20);
  });

  it("toggles mute, smart mode and night", async () => {
    const m = await mountCard();
    expect(m.$(".icon-btn.mute")?.getAttribute("aria-label")).toBe("Mute");
    m.$(".icon-btn.mute")!.click();
    await settle(m);
    expect(m.bar.muted).toBe(true);
    expect(m.$(".icon-btn.mute")?.getAttribute("aria-pressed")).toBe("true");
    expect(m.$(".icon-btn.mute")?.getAttribute("aria-label")).toBe("Mute");
    expect(m.$(".icon-btn.mute")?.getAttribute("title")).toBe("Unmute");
    const chips = m.$$(".chip");
    expect(chips.map((c) => c.textContent?.trim())).toEqual(["Smart mode", "Night"]);
    chips[1].click();
    await settle(m);
    expect(m.bar.night).toBe(true);
    expect(m.$$(".chip")[1].getAttribute("aria-checked")).toBe("true");
  });

  it("shows playback controls only when the source supports them", async () => {
    const bar = newBar();
    const m = await mountCard({}, bar);
    expect(m.$$(".transport .icon-btn").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Previous",
      "Pause",
      "Stop",
      "Next",
    ]);
    expect(m.$(".np-title")?.textContent).toBe("Midnight Drive");
    bar.update((b) => {
      b.source = "TV";
      b.playerState = "IDLE";
    });
    await m.sync();
    expect(m.$(".transport")).toBeNull();
  });

  it("shows a service error inline", async () => {
    const bar = newBar();
    const m = await mountCard({}, bar);
    m.$$(".transport .icon-btn")[0].click();
    bar.update((b) => (b.source = "TV"));
    await settle(m);
    expect(m.$(".strip.error")?.textContent).toContain("this source does not report support for that playback control");
    m.$(".strip.error .icon-btn")!.click();
    await m.card.updateComplete;
    expect(m.$(".strip.error")).toBeNull();
  });

  it("explains standby and disables source and volume", async () => {
    const bar = newBar();
    bar.power = "Standby";
    bar.update(() => undefined);
    const m = await mountCard({}, bar);
    expect(m.$(".subtitle")?.textContent).toBe("Standby");
    expect(m.text()).toContain("The soundbar is in standby.");
    expect(m.$$(".seg button").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect((m.$("input.slider") as HTMLInputElement).disabled).toBe(true);
  });

  it("explains a disabled mode chip", () => {
    const ctx = tabContext();
    const night = ctx.entities.night!;
    const host = document.createElement("div");
    render(
      renderHomeTab({
        ...ctx,
        stateOf: (id) => {
          const st = ctx.stateOf(id);
          return st && st.entity_id === night ? { ...st, state: "unavailable" } : st;
        },
      }),
      host,
    );
    const chip = Array.from(host.querySelectorAll<HTMLButtonElement>(".chip")).find((c) => c.textContent?.includes("Night"))!;
    expect(chip.disabled).toBe(true);
    expect(host.querySelector(".mode-reason")?.textContent).toBe("Night is unavailable right now.");
  });

  it("renders as a plain function from a TabContext", () => {
    const host = document.createElement("div");
    render(renderHomeTab(tabContext()), host);
    expect(host.querySelector(".room")).not.toBeNull();
  });

  it("picks battery icons", () => {
    expect(batteryIcon(14, false)).toBe("mdi:battery-10");
    expect(batteryIcon(100, false)).toBe("mdi:battery");
    expect(batteryIcon(5, true)).toBe("mdi:battery-charging-outline");
    expect(batteryIcon(undefined, false)).toBe("mdi:battery-unknown");
  });
});
