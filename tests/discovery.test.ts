import { describe, expect, it } from "vitest";
import {
  bandIndexFromText,
  bandIndexFromUniqueId,
  discover,
  findBars,
  lookupBandIndexes,
  resolveBar,
  watchedIds,
} from "../src/discovery";
import type { EntityRegistryDisplayEntry, HomeAssistant } from "../src/types";
import { DEVICE_ID, MEDIA_PLAYER } from "../demo/mock-hass";
import { newBar } from "./helpers";

function withSecondBar(hass: HomeAssistant): HomeAssistant {
  const entities: Record<string, EntityRegistryDisplayEntry> = { ...hass.entities };
  entities["media_player.jbl_bar_9_1_2"] = {
    entity_id: "media_player.jbl_bar_9_1_2",
    device_id: "second",
    platform: "jbl_bar_91",
    labels: [],
  };
  entities["select.jbl_bar_9_1_bass_level_2"] = {
    entity_id: "select.jbl_bar_9_1_bass_level_2",
    device_id: "second",
    platform: "jbl_bar_91",
    translation_key: "bass",
    labels: [],
  };
  return { ...hass, entities };
}

describe("findBars / resolveBar", () => {
  it("finds the jbl_bar_91 media player and ignores other integrations", () => {
    const hass = newBar().hass();
    expect(findBars(hass)).toEqual([MEDIA_PLAYER]);
    expect(resolveBar(hass)).toBe(MEDIA_PLAYER);
    expect(resolveBar(hass, MEDIA_PLAYER)).toBe(MEDIA_PLAYER);
    expect(resolveBar(hass, "media_player.nope")).toBeUndefined();
  });
});

describe("discover", () => {
  it("maps every registered entity to its role by device + translation_key", () => {
    const hass = newBar().hass();
    const e = discover(hass, MEDIA_PLAYER);
    expect(e.device_id).toBe(DEVICE_ID);
    expect(e.bass).toBe("select.jbl_bar_9_1_bass_level");
    expect(e.rear).toBe("select.jbl_bar_9_1_rear_speakers");
    expect(e.eq_preset).toBe("select.jbl_bar_9_1_front_eq_preset");
    expect(e.audio_sync).toBe("number.jbl_bar_9_1_audio_sync");
    expect(e.smart_mode).toBe("switch.jbl_bar_9_1_smart_mode");
    expect(e.display_clock).toBe("switch.jbl_display_clock");
    expect(e.display_clock_when).toBe("select.jbl_display_clock_when");
    expect(e.memory).toBe("sensor.jbl_bar_9_1_memory_used");
    expect(e.command_running).toBe("binary_sensor.jbl_bar_9_1_command_running");
    expect(e.rear_docked).toBe("binary_sensor.jbl_bar_9_1_rear_speakers_docked");
    expect(e.timers).toBe("sensor.jbl_bar_9_1_timers");
    expect(e.display).toBe("notify.jbl_bar_9_1_display");
    expect(e.standard_mode).toBeUndefined();
    expect(e.multipleBars).toBe(false);
  });

  it("orders the EQ bands by frequency, not by registry order", () => {
    const hass = newBar().hass();
    const entries = Object.values(hass.entities);
    const reversed = Object.fromEntries([...entries].reverse().map((e) => [e.entity_id, e]));
    const e = discover({ ...hass, entities: reversed }, MEDIA_PLAYER);
    expect(e.eqBands).toEqual([
      "number.jbl_bar_9_1_front_eq_125_hz",
      "number.jbl_bar_9_1_front_eq_500_hz",
      "number.jbl_bar_9_1_front_eq_2_khz",
      "number.jbl_bar_9_1_front_eq_4_khz",
      "number.jbl_bar_9_1_front_eq_8_khz",
    ]);
    expect(e.eqBandsGuessed).toEqual([]);
  });

  it("works with French entity ids and renamed bands (hints and registry order)", () => {
    const hass = newBar().hass();
    const entities = { ...hass.entities };
    const states = { ...hass.states };
    const rename = (from: string, to: string, friendly: string): void => {
      entities[to] = { ...entities[from], entity_id: to };
      delete entities[from];
      states[to] = { ...states[from], entity_id: to, attributes: { ...states[from].attributes, friendly_name: friendly } };
      delete states[from];
    };
    rename("number.jbl_bar_9_1_front_eq_125_hz", "number.jbl_bar_9_1_eq_avant_125_hz", "JBL Bar 9.1 EQ avant 125 Hz");
    rename("number.jbl_bar_9_1_front_eq_4_khz", "number.salon_aigus", "Salon aigus");
    const fr = { ...hass, entities, states };
    const guessed = discover(fr, MEDIA_PLAYER);
    expect(guessed.eqBands[0]).toBe("number.jbl_bar_9_1_eq_avant_125_hz");
    expect(guessed.eqBands[3]).toBe("number.salon_aigus");
    expect(guessed.eqBandsGuessed).toEqual(["number.salon_aigus"]);
    const hinted = discover(fr, MEDIA_PLAYER, { bandHints: { "number.salon_aigus": 3 } });
    expect(hinted.eqBands[3]).toBe("number.salon_aigus");
    expect(hinted.eqBandsGuessed).toEqual([]);
  });

  it("tolerates missing optional entities (older remote)", () => {
    const hass = newBar().hass();
    const entities = Object.fromEntries(
      Object.entries(hass.entities).filter(
        ([, e]) => !["timers", "messages", "eq_band", "smart_mode", "center"].includes(e.translation_key ?? ""),
      ),
    );
    entities["button.jbl_bar_9_1_standard_mode"] = {
      entity_id: "button.jbl_bar_9_1_standard_mode",
      device_id: DEVICE_ID,
      platform: "jbl_bar_91",
      translation_key: "standard_mode",
      labels: [],
    };
    const e = discover({ ...hass, entities }, MEDIA_PLAYER);
    expect(e.timers).toBeUndefined();
    expect(e.smart_mode).toBeUndefined();
    expect(e.standard_mode).toBe("button.jbl_bar_9_1_standard_mode");
    expect(e.eqBands.every((b) => b === undefined)).toBe(true);
  });

  it("finds line and recent buttons in hass.states with one bar", () => {
    const e = discover(newBar().hass(), MEDIA_PLAYER);
    expect(e.timerLines).toHaveLength(8);
    expect(e.messageLines).toHaveLength(8);
    expect(e.recentTimers).toEqual([1, 2, 3, 4].map((n) => `button.jbl_recent_timer_${n}`));
    expect(e.recentMessages).toHaveLength(4);
  });

  it("does not tie unregistered buttons to a bar when several bars exist", () => {
    const hass = withSecondBar(newBar().hass());
    const first = discover(hass, MEDIA_PLAYER);
    expect(first.multipleBars).toBe(true);
    expect(first.recentTimers).toEqual([]);
    expect(first.bass).toBe("select.jbl_bar_9_1_bass_level");
    const second = discover(hass, "media_player.jbl_bar_9_1_2");
    expect(second.bass).toBe("select.jbl_bar_9_1_bass_level_2");
    expect(second.timers).toBeUndefined();
    const forced = discover(hass, MEDIA_PLAYER, { includeUnregistered: true });
    expect(forced.recentTimers).toHaveLength(4);
  });

  it("lists every watched entity id", () => {
    const e = discover(newBar().hass(), MEDIA_PLAYER);
    const ids = watchedIds(e);
    expect(ids).toContain(MEDIA_PLAYER);
    expect(ids).toContain("number.jbl_bar_9_1_front_eq_8_khz");
    expect(ids).toContain("button.jbl_recent_message_4");
    expect(ids).not.toContain("light.kitchen");
  });
});

describe("band index helpers", () => {
  it("parses friendly names and entity ids", () => {
    expect(bandIndexFromText("JBL Bar 9.1 Front EQ 125 Hz", "x")).toBe(0);
    expect(bandIndexFromText("JBL Bar 9.1 EQ avant 2 kHz", "x")).toBe(2);
    expect(bandIndexFromText(undefined, "number.jbl_bar_9_1_front_eq_8_khz_2")).toBe(4);
    expect(bandIndexFromText("Treble", "number.treble")).toBeUndefined();
    expect(bandIndexFromUniqueId("01ABC_eq_band_1")).toBe(1);
    expect(bandIndexFromUniqueId("01ABC_bass")).toBeUndefined();
  });

  it("asks the entity registry for unique ids", async () => {
    const hass = newBar().hass();
    const found = await lookupBandIndexes(hass, ["number.jbl_bar_9_1_front_eq_4_khz", "number.unknown"]);
    expect(found).toEqual({ "number.jbl_bar_9_1_front_eq_4_khz": 3 });
  });
});
