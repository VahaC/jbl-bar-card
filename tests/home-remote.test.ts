import { afterEach, describe, expect, it } from "vitest";
import { render } from "lit";
import { IMAGES } from "../src/assets";
import { homeModel } from "../src/tabs/home-model";
import { renderRemote } from "../src/tabs/home-layouts/remote";
import type { TabContext } from "../src/types";
import { cleanup, mountCard, newBar, settle, tabContext } from "./helpers";

afterEach(cleanup);

const CONFIG = { default_tab: "home" as const, layouts: { home: "remote" as const } };

/** Render the remote layout straight from a (possibly modified) TabContext. */
function renderInto(ctx: TabContext): HTMLElement {
  const host = document.createElement("div");
  render(renderRemote(ctx, homeModel(ctx)), host);
  return host;
}

describe("Home tab: remote layout", () => {
  it("renders the room strip, source keys, rocker, mute, mode tiles and transport", async () => {
    const m = await mountCard(CONFIG);
    expect(m.$(".home-remote")).not.toBeNull();
    // Not the classic layout.
    expect(m.$(".seg")).toBeNull();
    expect(m.$("input.slider")).toBeNull();

    expect(m.$(".home-remote .bar-pic")?.getAttribute("src")).toBe(IMAGES.barCenter);
    expect(m.$$(".home-remote .rear-pic")).toHaveLength(2);
    expect(m.$(".home-remote .pill.rear.left")?.textContent).toContain("14%");
    expect(m.$(".home-remote .pill.rear.left")?.classList.contains("low")).toBe(true);
    expect(m.$(".home-remote .pill.rear.left")?.getAttribute("aria-label")).toBe("Rear left 14%, Low battery");
    expect(m.$(".home-remote .pill.sub")?.textContent).toContain("Bass 3/5");
    expect(m.$(".home-remote .dock")?.textContent).toBe("Rears detached");

    const sources = m.$$(".home-remote .sources .source");
    expect(sources.map((b) => b.textContent?.trim())).toEqual(["TV", "HDMI", "Bluetooth"]);
    expect(sources.map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);

    expect(m.$(".home-remote .vol")?.textContent).toContain("14");
    expect(m.$(".home-remote .vol")?.getAttribute("aria-live")).toBe("polite");
    expect(m.$(".home-remote .rock.up")?.getAttribute("aria-label")).toBe("Volume up");
    expect(m.$(".home-remote .rock.down")?.getAttribute("aria-label")).toBe("Volume down");
    expect(m.$(".home-remote .mute")?.getAttribute("aria-pressed")).toBe("false");
    // The visible "/32" is not read inside the live region: "Volume 14".
    expect(m.$(".home-remote .vol-max")?.getAttribute("aria-hidden")).toBe("true");

    expect(m.$$(".home-remote .mode").map((b) => b.querySelector(".tile-name")?.textContent)).toEqual(["Smart mode", "Night"]);
    expect(m.$$(".home-remote .mode").map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "false"]);

    expect(m.$(".home-remote .np-title")?.textContent).toBe("Midnight Drive");
    expect(m.$$(".home-remote .transport button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Previous",
      "Pause",
      "Stop",
      "Next",
    ]);
    expect(m.$(".home-remote .transport .primary")?.getAttribute("aria-label")).toBe("Pause");
  });

  it("draws one bar picture without rear pictures while docked", async () => {
    const bar = newBar();
    bar.update((b) => (b.docked = true));
    const m = await mountCard(CONFIG, bar);
    expect(m.$(".home-remote .bar-pic")?.getAttribute("src")).toBe(IMAGES.barDocked);
    expect(m.$$(".home-remote .rear-pic")).toHaveLength(0);
    expect(m.$(".home-remote .pill.rear.right")?.textContent).toContain("76%");
    expect(m.$(".home-remote .dock")?.textContent).toBe("Rears docked");
  });

  it("selects a source with a pending state until the bar confirms", async () => {
    const m = await mountCard(CONFIG);
    const hdmi = () => m.$$(".home-remote .source")[1];
    hdmi().click();
    await m.card.updateComplete;
    expect(hdmi().classList.contains("pending")).toBe(true);
    expect(hdmi().getAttribute("aria-busy")).toBe("true");
    expect(hdmi().querySelector(".spinner")).not.toBeNull();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ domain: "media_player", service: "select_source", data: { source: "HDMI" } });
    expect(hdmi().getAttribute("aria-checked")).toBe("true");
    expect(hdmi().classList.contains("pending")).toBe(false);
  });

  it("steps the volume with the rocker, adding quick taps up", async () => {
    const m = await mountCard(CONFIG);
    const up = m.$(".home-remote .rock.up")!;
    up.click();
    up.click();
    await m.card.updateComplete;
    expect(m.$(".home-remote .vol")?.textContent).toContain("16");
    expect(m.$(".home-remote .vol")?.classList.contains("pending")).toBe(true);
    await settle(m, 6);
    expect(m.bar.calls.map((c) => c.service)).toEqual(["volume_up", "volume_up"]);
    expect(m.bar.volume).toBe(16);
    m.$(".home-remote .rock.down")!.click();
    await settle(m, 6);
    expect(m.bar.calls.at(-1)?.service).toBe("volume_down");
    expect(m.bar.volume).toBe(15);
    expect(m.$(".home-remote .vol")?.classList.contains("pending")).toBe(false);
  });

  it("disables volume up at the maximum", async () => {
    const bar = newBar();
    bar.update((b) => (b.volume = 32));
    const m = await mountCard(CONFIG, bar);
    expect((m.$(".home-remote .rock.up") as HTMLButtonElement).disabled).toBe(true);
    expect((m.$(".home-remote .rock.down") as HTMLButtonElement).disabled).toBe(false);
  });

  it("toggles mute and shows the muted state", async () => {
    const m = await mountCard(CONFIG);
    m.$(".home-remote .mute")!.click();
    await m.card.updateComplete;
    expect(m.$(".home-remote .mute")?.classList.contains("pending")).toBe(true);
    // The model shows the pending target, so the key is pressed before the bar confirms.
    expect(m.$(".home-remote .mute")?.getAttribute("aria-pressed")).toBe("true");
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ domain: "media_player", service: "volume_mute", data: { is_volume_muted: true } });
    expect(m.bar.muted).toBe(true);
    // "is-muted", not the shared .muted text class that would grey the whole rocker.
    expect(m.$(".home-remote .rocker")?.classList.contains("is-muted")).toBe(true);
    expect(m.$(".home-remote .rocker")?.classList.contains("muted")).toBe(false);
    expect(m.$(".home-remote .muted-tag")?.textContent).toBe("Muted");
    // A fixed name with aria-pressed; the model's action label stays the tooltip.
    expect(m.$(".home-remote .mute .key-label")?.textContent).toBe("Mute");
    expect(m.$(".home-remote .mute")?.getAttribute("aria-pressed")).toBe("true");
    expect(m.$(".home-remote .mute")?.getAttribute("title")).toBe("Unmute");
  });

  it("toggles Smart mode and Night from the tiles", async () => {
    const m = await mountCard(CONFIG);
    const tiles = () => m.$$(".home-remote .mode");
    tiles()[1].click();
    await m.card.updateComplete;
    expect(tiles()[1].getAttribute("aria-checked")).toBe("true");
    expect(tiles()[1].classList.contains("pending")).toBe(true);
    expect(tiles()[1].querySelector(".spinner")).not.toBeNull();
    await settle(m);
    expect(m.bar.night).toBe(true);
    expect(tiles()[1].querySelector(".tile-state")?.textContent).toBe("On");
    tiles()[0].click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ domain: "switch", service: "turn_on" });
    expect(m.bar.smart).toBe(true);
  });

  it("sends the transport keys", async () => {
    const m = await mountCard(CONFIG);
    m.$(".home-remote .transport .next")!.click();
    await settle(m);
    expect(m.bar.calls.at(-1)).toMatchObject({ domain: "media_player", service: "media_next_track" });
  });

  it("shows the standby reason and disables the source and volume keys", async () => {
    const bar = newBar();
    bar.power = "Standby";
    bar.update(() => undefined);
    const m = await mountCard(CONFIG, bar);
    expect(m.$(".home-remote .standby-hint")?.textContent).toContain("The soundbar is in standby.");
    // No "standby" class on the root: classic's unprefixed .standby rule would shift the layout.
    expect(m.$(".home-remote")?.classList.contains("standby")).toBe(false);
    expect(m.$$(".home-remote .source").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect((m.$(".home-remote .rock.up") as HTMLButtonElement).disabled).toBe(true);
    expect((m.$(".home-remote .rock.down") as HTMLButtonElement).disabled).toBe(true);
    expect((m.$(".home-remote .mute") as HTMLButtonElement).disabled).toBe(true);
    // The reason is said once, not under every key.
    expect(m.$$(".home-remote .reason")).toHaveLength(0);
    expect(m.$(".home-remote .playback")).toBeNull();
  });

  it("disables a mode tile whose switch is unavailable", async () => {
    const ctx = tabContext();
    const night = ctx.entities.night!;
    const states = { ...ctx.hass.states, [night]: { ...ctx.hass.states[night], state: "unavailable" } };
    const host = renderInto({ ...ctx, stateOf: (id) => (id === night || id === "night" ? states[night] : ctx.stateOf(id)) });
    const tile = host.querySelector<HTMLButtonElement>(".home-remote .mode.night")!;
    expect(tile.disabled).toBe(true);
    expect(host.querySelector(".home-remote .reason")?.textContent).toBe("Night is unavailable right now.");
  });

  it("turns the bar off from the power key, sharing the pending state with the header", async () => {
    const m = await mountCard(CONFIG, newBar({ delayMs: 20 }));
    const key = () => m.$(".home-remote .power-key") as HTMLButtonElement;
    const header = () => m.$(".header .power") as HTMLButtonElement;
    // The key row holds power then mute; the shared ".power" header rule does not match the key.
    expect(m.$$(".home-remote .keys-row .key").map((k) => k.querySelector(".key-label")?.textContent)).toEqual(["Power", "Mute"]);
    expect(key().classList.contains("power")).toBe(false);
    expect(key().getAttribute("aria-pressed")).toBe("true");
    expect(key().getAttribute("title")).toBe("Turn off");
    key().click();
    await m.card.updateComplete;
    // Both controls show the pending target and the pending style at once.
    expect(key().getAttribute("aria-pressed")).toBe("false");
    expect(key().classList.contains("pending")).toBe(true);
    expect(header().getAttribute("aria-pressed")).toBe("false");
    expect(header().classList.contains("pending")).toBe(true);
    // A tap on the header while the key's command is on its way is ignored.
    header().click();
    key().click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    await settle(m, 6);
    expect(m.bar.calls.filter((c) => c.domain === "media_player" && c.service.startsWith("turn_")).map((c) => c.service)).toEqual([
      "turn_off",
    ]);
    expect(m.bar.power).toBe("Standby");
    expect(key().getAttribute("aria-pressed")).toBe("false");
    expect(key().getAttribute("title")).toBe("Turn on");
    expect(key().disabled).toBe(false);
  });

  it("disables the power key with a reason while the bar is unreachable", async () => {
    const bar = newBar();
    bar.reachable = false;
    bar.update(() => undefined);
    const m = await mountCard(CONFIG, bar);
    expect((m.$(".home-remote .power-key") as HTMLButtonElement).disabled).toBe(true);
    expect(m.$$(".home-remote .reason").map((r) => r.textContent)).toContain("The soundbar is unreachable.");
  });

  it("shows the Standard mode button as a one-shot tile on remotes without the Smart switch", async () => {
    const bar = newBar();
    const ctx = tabContext(bar);
    const button = "button.jbl_bar_9_1_bluetooth_pairing";
    const host = renderInto({ ...ctx, entities: { ...ctx.entities, smart_mode: undefined, standard_mode: button } });
    const tile = host.querySelector<HTMLButtonElement>(".home-remote .mode.standard_mode")!;
    expect(tile.getAttribute("role")).toBeNull();
    expect(tile.querySelector(".tile-name")?.textContent).toBe("Standard mode");
    tile.click();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(bar.calls.at(-1)).toMatchObject({ domain: "button", service: "press" });
  });

  it("hides the blocks whose entities are missing", () => {
    const ctx = tabContext();
    const host = renderInto({
      ...ctx,
      entities: {
        ...ctx.entities,
        smart_mode: undefined,
        standard_mode: undefined,
        night: undefined,
        rear_battery_left: undefined,
        rear_battery_right: undefined,
        rear_docked: undefined,
        bass: undefined,
      },
    });
    expect(host.querySelector(".home-remote .mode")).toBeNull();
    expect(host.querySelector(".home-remote .tiles-col")).toBeNull();
    expect(host.querySelector(".home-remote .pill.rear")).toBeNull();
    expect(host.querySelector(".home-remote .rear-pic")).toBeNull();
    // No dead, unexplained sub button without a bass entity; the sub picture stays.
    expect(host.querySelector(".home-remote .pill.sub")).toBeNull();
    expect(host.querySelector(".home-remote .sub-pic")).not.toBeNull();
    expect(host.querySelector(".home-remote .dock")?.textContent).toBe("Soundbar");
    // Volume and source stay: the media_player exists.
    expect(host.querySelector(".home-remote .rocker")).not.toBeNull();

    const noPlayer = renderInto({ ...ctx, stateOf: (id) => (id === ctx.entities.media_player ? undefined : ctx.stateOf(id)) });
    expect(noPlayer.querySelector(".home-remote .sources")).toBeNull();
    expect(noPlayer.querySelector(".home-remote .rocker")).toBeNull();
    expect(noPlayer.querySelector(".home-remote .mute")).toBeNull();
    expect(noPlayer.querySelector(".home-remote .playback")).toBeNull();
    expect(noPlayer.querySelector(".home-remote .mode")).not.toBeNull();
  });

  it("hides the transport when the source supports no playback", async () => {
    const bar = newBar();
    const m = await mountCard(CONFIG, bar);
    bar.update((b) => {
      b.source = "TV";
      b.playerState = "IDLE";
    });
    await m.sync();
    expect(m.$(".home-remote .transport")).toBeNull();
  });

  it("speaks Ukrainian", async () => {
    const m = await mountCard(CONFIG, newBar({ language: "uk" }));
    expect(m.$(".home-remote .pill.rear.left .side-letter")?.textContent).toBe("Л");
    expect(m.$(".home-remote .mode .tile-state")?.textContent).toBe("Вимкнено");
    expect(m.$(".home-remote .mute .key-label")?.textContent).toBe("Без звуку");
    expect(m.$(".home-remote .mute")?.getAttribute("title")).toBe("Вимкнути звук");
    expect(m.$(".home-remote .power-key .key-label")?.textContent).toBe("Живлення");
    expect(m.$(".home-remote .power-key")?.getAttribute("title")).toBe("Вимкнути");
  });
});
