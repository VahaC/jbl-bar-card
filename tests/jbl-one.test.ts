import { describe, expect, it, vi } from "vitest";
import { bandLabelFromName, discover, findBars, watchedIds } from "../src/discovery";
import { JblServices } from "../src/services";
import { volumeStep } from "../src/tabs/home-model";
import type { DeviceRegistryEntry, EntityRegistryDisplayEntry, HassEntity, HomeAssistant } from "../src/types";

/** A JBL Bar 1300MK2 as the jbl_bar integration (SH1FT-W/jbl-bar) registers it. */
const BAR = "bar_device";
const LEFT = "rear_left_device";
const RIGHT = "rear_right_device";
const MP = "media_player.jbl_bar_1300mk2";

function entity(entity_id: string, translation_key: string, device_id = BAR): EntityRegistryDisplayEntry {
  return { entity_id, translation_key, device_id, platform: "jbl_bar", labels: [] };
}

function state(entity_id: string, value: string, attributes: Record<string, unknown> = {}): HassEntity {
  return {
    entity_id,
    state: value,
    attributes,
    last_changed: "",
    last_updated: "",
    context: { id: "", parent_id: null, user_id: null },
  } as HassEntity;
}

function device(id: string, name: string, identifier: string, via?: string): DeviceRegistryEntry {
  return { id, name, name_by_user: null, via_device_id: via ?? null, identifiers: [["jbl_bar", identifier]] };
}

function jblOne(atmos = "3"): HomeAssistant {
  const list: EntityRegistryDisplayEntry[] = [
    entity(MP, "bar"),
    entity("select.jbl_bar_1300mk2_eq_preset", "eq_preset"),
    entity("select.jbl_bar_1300mk2_rear_volume", "rear_volume"),
    entity("sensor.jbl_bar_1300mk2_rear_volume", "rear_volume"),
    entity("switch.jbl_bar_1300mk2_nightmode", "night_mode"),
    entity("switch.jbl_bar_1300mk2_smart_mode", "smart_mode"),
    entity("number.jbl_bar_1300mk2_audio_sync", "audio_sync"),
    entity("button.jbl_bar_1300mk2_calibration", "calibration"),
    entity("button.jbl_bar_1300mk2_atmos", "atmos"),
    entity("button.jbl_bar_1300mk2_bass", "bass"),
    entity("button.jbl_bar_1300mk2_moment", "moment"),
    entity("switch.jbl_bar_1300mk2_pure_voice", "pure_voice"),
    entity("switch.jbl_bar_1300mk2_feedback_tone", "feedback_tone"),
    entity("binary_sensor.jbl_bar_1300mk2_atmos_active", "atmos_active"),
    entity("select.jbl_bar_1300mk2_broadcast", "broadcast"),
    entity("select.jbl_bar_1300mk2_sleep_timer", "sleep_timer"),
    entity("switch.jbl_bar_1300mk2_deep_sleep", "deep_sleep"),
    entity("sensor.jbl_bar_1300mk2_play_medium", "play_medium"),
    entity("sensor.jbl_bar_1300mk2_power_on_time", "power_on_time"),
    entity("binary_sensor.jbl_bar_1300mk2_left_online", "rear_online", LEFT),
    entity("binary_sensor.jbl_bar_1300mk2_left_charging", "rear_charging", LEFT),
    entity("sensor.jbl_bar_1300mk2_atmos_level", "atmos_level"),
    entity("sensor.jbl_bar_1300mk2_audio_format", "audio_format"),
    entity("number.jbl_bar_1300mk2_1000hz", "eq_band"),
    entity("number.jbl_bar_1300mk2_125hz", "eq_band"),
    entity("number.jbl_bar_1300mk2_8000hz", "eq_band"),
    entity("number.jbl_bar_1300mk2_250hz", "eq_band"),
    entity("sensor.jbl_bar_1300mk2_left_battery", "rear_battery", LEFT),
    entity("binary_sensor.jbl_bar_1300mk2_left_docked", "rear_docked", LEFT),
    entity("sensor.jbl_bar_1300mk2_right_battery", "rear_battery", RIGHT),
    entity("binary_sensor.jbl_bar_1300mk2_right_docked", "rear_docked", RIGHT),
  ];
  const states: Record<string, HassEntity> = {
    [MP]: state(MP, "playing", { volume_level: 0.12, source: "TV", source_list: ["TV", "HDMI", "Bluetooth"] }),
    "select.jbl_bar_1300mk2_rear_volume": state("select.jbl_bar_1300mk2_rear_volume", "medium", {
      options: ["muted", "low", "medium", "high"],
    }),
    "sensor.jbl_bar_1300mk2_atmos_level": state("sensor.jbl_bar_1300mk2_atmos_level", atmos),
    "number.jbl_bar_1300mk2_125hz": state("number.jbl_bar_1300mk2_125hz", "0", { friendly_name: "JBL BAR 1300MK2 EQ 125 Hz" }),
    "number.jbl_bar_1300mk2_250hz": state("number.jbl_bar_1300mk2_250hz", "0", { friendly_name: "JBL BAR 1300MK2 EQ 250 Hz" }),
    "number.jbl_bar_1300mk2_1000hz": state("number.jbl_bar_1300mk2_1000hz", "0", { friendly_name: "JBL BAR 1300MK2 EQ 1000 Hz" }),
    "number.jbl_bar_1300mk2_8000hz": state("number.jbl_bar_1300mk2_8000hz", "0", { friendly_name: "JBL BAR 1300MK2 EQ 8000 Hz" }),
  };
  return {
    entities: Object.fromEntries(list.map((e) => [e.entity_id, e])),
    devices: {
      [BAR]: device(BAR, "JBL BAR 1300MK2", "14:14:16:89:d2:f9"),
      [LEFT]: device(LEFT, "JBL BAR 1300MK2 Rear Speaker Left", "14:14:16:89:d2:f9_rear_left", BAR),
      [RIGHT]: device(RIGHT, "JBL BAR 1300MK2 Rear Speaker Right", "14:14:16:89:d2:f9_rear_right", BAR),
    },
    states,
  } as unknown as HomeAssistant;
}

describe("JBL One bars (jbl_bar integration)", () => {
  it("finds the bar's media player", () => {
    expect(findBars(jblOne())).toEqual([MP]);
  });

  it("maps the bar's entities to the card roles", () => {
    const e = discover(jblOne(), MP);
    expect(e.platform).toBe("jbl_bar");
    expect(e.volumeMax).toBe(100);
    expect(e.volumeStep).toBe(3);
    expect(e.night).toBe("switch.jbl_bar_1300mk2_nightmode");
    expect(e.smart_mode).toBe("switch.jbl_bar_1300mk2_smart_mode");
    expect(e.rear).toBe("select.jbl_bar_1300mk2_rear_volume");
    expect(e.calibrate).toBe("button.jbl_bar_1300mk2_calibration");
    expect(e.audio_sync).toBe("number.jbl_bar_1300mk2_audio_sync");
    expect(e.audio_format).toBe("sensor.jbl_bar_1300mk2_audio_format");
    // The bass boost button is no bass level.
    expect(e.bass).toBeUndefined();
  });

  it("reads the rear speakers from their own devices", () => {
    const e = discover(jblOne(), MP);
    expect(e.rear_battery_left).toBe("sensor.jbl_bar_1300mk2_left_battery");
    expect(e.rear_battery_right).toBe("sensor.jbl_bar_1300mk2_right_battery");
    expect(e.rear_docked).toBe("binary_sensor.jbl_bar_1300mk2_left_docked");
  });

  it("uses the Atmos level sensor with its next-level button", () => {
    const e = discover(jblOne(), MP);
    expect(e.atmos).toBe("sensor.jbl_bar_1300mk2_atmos_level");
    expect(e.cycles?.[e.atmos!]?.button).toBe("button.jbl_bar_1300mk2_atmos");
    expect(watchedIds(e)).toContain("button.jbl_bar_1300mk2_atmos");
  });

  it("sorts the EQ bands by frequency and labels them", () => {
    const e = discover(jblOne(), MP);
    expect(e.eqBands).toEqual([
      "number.jbl_bar_1300mk2_125hz",
      "number.jbl_bar_1300mk2_250hz",
      "number.jbl_bar_1300mk2_1000hz",
      "number.jbl_bar_1300mk2_8000hz",
    ]);
    expect(e.eqBandLabels).toEqual(["125 Hz", "250 Hz", "1 kHz", "8 kHz"]);
    expect(bandLabelFromName(undefined, "number.x_4000hz")).toBe("4 kHz");
  });

  it("shows and sets the volume on a 0..100 scale", async () => {
    const hass = jblOne();
    expect(volumeStep(hass, MP, 100)).toBe(12);
    const callService = vi.fn().mockResolvedValue(undefined);
    const services = new JblServices({ ...hass, callService } as unknown as HomeAssistant, MP, 100);
    await services.setVolume(30);
    expect(callService).toHaveBeenCalledWith("media_player", "volume_set", { volume_level: 0.3 }, { entity_id: MP }, false, false);
  });

  it("steps the Atmos level with the next-level button until it reaches the target", async () => {
    let hass = jblOne("3");
    const sensor = "sensor.jbl_bar_1300mk2_atmos_level";
    const callService = vi.fn().mockImplementation(async () => {
      // Each press moves 3 -> 1 -> 2 -> 3.
      const now = hass.states[sensor].state;
      const next = { "1": "2", "2": "3", "3": "1" }[now] as string;
      hass = { ...hass, states: { ...hass.states, [sensor]: state(sensor, next) } } as HomeAssistant;
    });
    const e = discover(hass, MP);
    const services = new JblServices({ ...hass, callService } as unknown as HomeAssistant, MP, 100, e.cycles, () => hass);
    await services.selectOption(sensor, "2");
    expect(callService).toHaveBeenCalledTimes(2);
    expect(callService).toHaveBeenCalledWith("button", "press", {}, { entity_id: "button.jbl_bar_1300mk2_atmos" }, false, false);
    expect(hass.states[sensor].state).toBe("2");
  });

  it("maps the extra sound keys and keeps the Bass boost button out of the bass level role", () => {
    const e = discover(jblOne(), MP);
    expect(e.bass).toBeUndefined();
    expect(e.bass_boost).toBe("button.jbl_bar_1300mk2_bass");
    expect(e.moment).toBe("button.jbl_bar_1300mk2_moment");
    expect(e.pure_voice).toBe("switch.jbl_bar_1300mk2_pure_voice");
    expect(e.feedback_tone).toBe("switch.jbl_bar_1300mk2_feedback_tone");
    expect(e.atmos_active).toBe("binary_sensor.jbl_bar_1300mk2_atmos_active");
    expect(e.broadcast).toBe("select.jbl_bar_1300mk2_broadcast");
    expect(e.sleep_timer).toBe("select.jbl_bar_1300mk2_sleep_timer");
    expect(e.deep_sleep).toBe("switch.jbl_bar_1300mk2_deep_sleep");
    expect(e.play_medium).toBe("sensor.jbl_bar_1300mk2_play_medium");
    expect(e.power_on_time).toBe("sensor.jbl_bar_1300mk2_power_on_time");
    expect(e.rear_online_left).toBe("binary_sensor.jbl_bar_1300mk2_left_online");
    expect(e.rear_charging_left).toBe("binary_sensor.jbl_bar_1300mk2_left_charging");
    expect(watchedIds(e)).toEqual(expect.arrayContaining(["button.jbl_bar_1300mk2_bass", "switch.jbl_bar_1300mk2_pure_voice"]));
  });
});
