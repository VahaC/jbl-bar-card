import { describe, expect, it } from "vitest";
import { CORE, LANGS, TAB_STRINGS, dictionary, langOf, normalizeLang, translate } from "../src/i18n";

describe("language selection", () => {
  it("maps HA languages to en / uk / fr", () => {
    expect(normalizeLang("uk")).toBe("uk");
    expect(normalizeLang("uk-UA")).toBe("uk");
    expect(normalizeLang("fr-CA")).toBe("fr");
    expect(normalizeLang("de")).toBe("en");
    expect(normalizeLang(undefined)).toBe("en");
    expect(langOf({ locale: { language: "fr" }, language: "en" })).toBe("fr");
  });
});

describe("translate", () => {
  it("interpolates placeholders", () => {
    expect(translate("en", "home.room.bass", { level: 3 })).toBe("Bass 3/5");
    expect(translate("uk", "home.room.bass", { level: 3 })).toBe("Баси 3/5");
    expect(translate("fr", "home.room.bass", { level: 3 })).toBe("Basses 3/5");
  });

  it("falls back to English, then to the key", () => {
    expect(translate("uk", "definitely.missing")).toBe("definitely.missing");
    // A key that only exists in English still renders.
    expect(dictionary("en")["tab.home"]).toBe("Home");
  });

  it("keeps unknown placeholders", () => {
    expect(translate("en", "action.unknown", {})).toBe("Running {action}");
  });

  it("prefixes tab strings with the tab name", () => {
    expect(translate("en", "home.volume")).toBe("Volume");
    expect(translate("uk", "home.volume")).toBe("Гучність");
    expect(translate("en", "sound.bass")).toBe("Bass");
    expect(translate("fr", "sound.bass")).toBe("Basses");
  });

  it("picks plural forms with count", () => {
    const dict = dictionary("uk");
    dict["test.minutes_one"] = "{count} хвилина";
    dict["test.minutes_few"] = "{count} хвилини";
    dict["test.minutes_many"] = "{count} хвилин";
    expect(translate("uk", "test.minutes", { count: 1 })).toBe("1 хвилина");
    expect(translate("uk", "test.minutes", { count: 3 })).toBe("3 хвилини");
    expect(translate("uk", "test.minutes", { count: 5 })).toBe("5 хвилин");
    expect(translate("uk", "test.minutes", { count: 21 })).toBe("21 хвилина");
  });
});

describe("completeness", () => {
  const placeholders = (text: string): string[] => (text.match(/\{\w+\}/g) ?? []).sort();

  it("has every core key in every language with the same placeholders", () => {
    for (const lang of LANGS) {
      expect(Object.keys(CORE[lang]).sort(), `core ${lang}`).toEqual(Object.keys(CORE.en).sort());
      for (const [key, text] of Object.entries(CORE.en)) {
        expect(placeholders(CORE[lang][key]), `${lang} ${key}`).toEqual(placeholders(text));
      }
    }
  });

  it("has every tab key in every language with the same placeholders", () => {
    for (const [tab, strings] of Object.entries(TAB_STRINGS)) {
      for (const lang of LANGS) {
        expect(Object.keys(strings[lang]).sort(), `${tab} ${lang}`).toEqual(Object.keys(strings.en).sort());
        for (const [key, text] of Object.entries(strings.en)) {
          expect(placeholders(strings[lang][key] ?? ""), `${tab} ${lang} ${key}`).toEqual(placeholders(text));
        }
      }
    }
  });
});
