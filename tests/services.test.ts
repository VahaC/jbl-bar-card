import { describe, expect, it, vi } from "vitest";
import {
  JblServices,
  errorMessage,
  foldDisplayText,
  invalidDisplayChars,
  parseServiceError,
  toDuration,
} from "../src/services";
import { serviceErrorText } from "../src/errors";
import { makeTranslate } from "../src/i18n";
import type { Lang } from "../src/i18n";
import type { HomeAssistant } from "../src/types";

const MP = "media_player.jbl_bar_9_1";
const t = (lang: Lang) => makeTranslate(lang);

function setup(): { services: JblServices; call: ReturnType<typeof vi.fn> } {
  const call = vi.fn().mockResolvedValue({ context: { id: "x" } });
  const hass = { callService: call } as unknown as HomeAssistant;
  return { services: new JblServices(hass, MP), call };
}

describe("JblServices", () => {
  it("targets the media player for media_player and jbl_bar_91 services, without HA toasts", async () => {
    const { services, call } = setup();
    await services.volumeUp();
    await services.selectSource("HDMI");
    await services.mute(true);
    await services.setVolume(16);
    await services.mediaNext();
    expect(call.mock.calls).toEqual([
      ["media_player", "volume_up", {}, { entity_id: MP }, false, false],
      ["media_player", "select_source", { source: "HDMI" }, { entity_id: MP }, false, false],
      ["media_player", "volume_mute", { is_volume_muted: true }, { entity_id: MP }, false, false],
      ["media_player", "volume_set", { volume_level: 0.5 }, { entity_id: MP }, false, false],
      ["media_player", "media_next_track", {}, { entity_id: MP }, false, false],
    ]);
  });

  it("clamps the volume to 0..32", async () => {
    const { services, call } = setup();
    await services.setVolume(40);
    await services.setVolume(-2);
    expect(call.mock.calls.map((c) => c[2])).toEqual([{ volume_level: 1 }, { volume_level: 0 }]);
  });

  it("calls entity services on the given entity", async () => {
    const { services, call } = setup();
    await services.selectOption("select.bass", "4");
    await services.setNumber("number.sync", 120);
    await services.setSwitch("switch.night", false);
    await services.press("button.restart");
    expect(call.mock.calls.map((c) => [c[0], c[1], c[2], c[3]])).toEqual([
      ["select", "select_option", { option: "4" }, { entity_id: "select.bass" }],
      ["number", "set_value", { value: 120 }, { entity_id: "number.sync" }],
      ["switch", "turn_off", {}, { entity_id: "switch.night" }],
      ["button", "press", {}, { entity_id: "button.restart" }],
    ]);
  });

  it("builds timer_start and drops sound options when the sound is off", async () => {
    const { services, call } = setup();
    await services.timerStart({ duration: { minutes: 10 }, name: "  Pizza ", sound: "off", sound_volume: 12, ring_for: 30 });
    await services.timerStart({ duration: 300, sound: "always", sound_volume: 12, show_time_left: true });
    expect(call.mock.calls[0].slice(0, 3)).toEqual(["jbl_bar_91", "timer_start", { duration: { minutes: 10 }, name: "Pizza", sound: "off" }]);
    expect(call.mock.calls[1][2]).toEqual({ duration: 300, show_time_left: true, sound: "always", sound_volume: 12 });
  });

  it("builds timer_cancel, timer_extend and forget_recent", async () => {
    const { services, call } = setup();
    await services.timerCancel({ id: "t3" });
    await services.timerCancel({ all: true });
    await services.timerExtend({ id: "t3" });
    await services.timerExtend(undefined, { minutes: 5 });
    await services.forgetRecent("button.jbl_recent_timer_2");
    expect(call.mock.calls.map((c) => [c[1], c[2], c[3]])).toEqual([
      ["timer_cancel", { id: "t3" }, { entity_id: MP }],
      ["timer_cancel", { all: true }, { entity_id: MP }],
      ["timer_extend", { id: "t3" }, { entity_id: MP }],
      ["timer_extend", { duration: { minutes: 5 } }, { entity_id: MP }],
      ["forget_recent", {}, { entity_id: "button.jbl_recent_timer_2" }],
    ]);
  });

  it("builds display_message and refuses two lengths", async () => {
    const { services, call } = setup();
    await services.displayMessage({ message: "Fridge open", id: "fridge", forever: true, clear_on_key: true, when_on: false });
    await services.displayCancel("fridge");
    await services.displayCancel();
    expect(call.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["display_message", { message: "Fridge open", id: "fridge", forever: true, clear_on_key: true, when_on: false }],
      ["display_cancel", { id: "fridge" }],
      ["display_cancel", {}],
    ]);
    await expect(services.displayMessage({ message: "x", repeat: 2, forever: true })).rejects.toThrow(/only one/);
    expect(call).toHaveBeenCalledTimes(3);
  });
});

describe("helpers", () => {
  it("converts seconds to a duration object", () => {
    expect(toDuration(3725)).toEqual({ hours: 1, minutes: 2, seconds: 5 });
    expect(toDuration(-4)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
  });

  it("folds text exactly like the remote's displayText", () => {
    expect(foldDisplayText("Café prêt")).toBe("CAFE PRET");
    // The remote's table: ligatures, curly apostrophes and dashes; whitespace trimmed and collapsed.
    expect(foldDisplayText("  pâtes  à l’œuf ")).toBe("PATES A L'OEUF");
    expect(foldDisplayText("cœur – Æsir straße")).toBe("COEUR - AESIR STRASSE");
    expect(foldDisplayText("TEA 	  TIME")).toBe("TEA TIME");
    // Letters outside the table are not folded (NFKD would turn Š into S, the remote refuses Š).
    expect(foldDisplayText("Škoda")).toBe("ŠKODA");
    expect(invalidDisplayChars("Škoda")).toEqual(["Š"]);
    expect(invalidDisplayChars("cœur l’heure")).toEqual([]);
  });

  it("allows only the characters the remote accepts (letters, digits, space and - . ')", () => {
    expect(invalidDisplayChars("Привіт!")).toEqual(["П", "Р", "И", "В", "І", "Т", "!"]);
    // displayTextPattern ^[A-Z0-9 .'-]{1,31}$ has no ':', '!' or '?'.
    expect(invalidDisplayChars("Door open: 5 min?")).toEqual([":", "?"]);
    expect(invalidDisplayChars("STOP!")).toEqual(["!"]);
    expect(invalidDisplayChars("It's 5 o'clock - go.")).toEqual([]);
  });

  it("reads HA websocket errors", () => {
    expect(errorMessage({ code: "home_assistant_error", message: "The soundbar refused the control: x" })).toBe(
      "The soundbar refused the control: x",
    );
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage({ code: "invalid_format" })).toBe("invalid_format");
    expect(errorMessage("plain")).toBe("plain");
  });

  it("recognises a lost connection in both shapes home-assistant-js-websocket uses", () => {
    const nested = { type: "result", success: false, error: { code: 3, message: "Connection lost" } };
    expect(parseServiceError(nested).connectionLost).toBe(true);
    expect(parseServiceError(3).connectionLost).toBe(true);
    expect(errorMessage(nested)).not.toBe("[object Object]");
    expect(errorMessage(3)).not.toBe("3");
    expect(serviceErrorText(nested, t("en"))).toContain("connection to Home Assistant was lost");
    expect(serviceErrorText(3, t("uk"))).toContain("Зв'язок із Home Assistant обірвався");
    // A nested error that is not a lost connection still shows its message.
    expect(errorMessage({ error: { code: "x", message: "Nested" } })).toBe("Nested");
  });

  it("translates jbl_bar_91 errors by translation key, else asks HA, else shows the message", () => {
    const refused = {
      code: "home_assistant_error",
      message: "The soundbar refused the control: busy wire",
      translation_domain: "jbl_bar_91",
      translation_key: "refused",
      translation_placeholders: { error: "busy wire" },
    };
    expect(serviceErrorText(refused, t("uk"))).toBe("Саундбар відхилив команду: busy wire");
    expect(serviceErrorText(refused, t("fr"))).toBe("La barre de son a refusé la commande : busy wire");
    const other = { code: "x", message: "Raw English", translation_domain: "hue", translation_key: "boom" };
    const localize = vi.fn().mockReturnValue("Localisé");
    expect(serviceErrorText(other, t("fr"), { localize })).toBe("Localisé");
    expect(localize).toHaveBeenCalledWith("component.hue.exceptions.boom.message", {});
    expect(serviceErrorText(other, t("fr"), { localize: () => "" })).toBe("Raw English");
    expect(serviceErrorText({ code: "x", message: "Plain" }, t("uk"))).toBe("Plain");
  });
});
