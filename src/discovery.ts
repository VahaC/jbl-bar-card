import { ROLE_DOMAINS } from "./types";
import type { BarEntities, EntityRegistryDisplayEntry, HomeAssistant, Role } from "./types";

export const DOMAIN = "jbl_bar_91";
/** JBL One bars (Bar 1000 / 1300 / 1300MK2 ...) through the jbl_bar integration (SH1FT-W/jbl-bar). */
export const JBL_ONE_DOMAIN = "jbl_bar";
/** Integrations whose media players the card can drive. */
export const PLATFORMS: readonly string[] = [DOMAIN, JBL_ONE_DOMAIN];

/** Volume scale and step of JBL One bars: 0..100 %, the remote moves 3 % per press. */
export const JBL_ONE_VOLUME_MAX = 100;
const JBL_ONE_VOLUME_STEP = 3;

/** jbl_bar translation_key -> card role, where the two integrations name the same setting differently. */
const JBL_ONE_ALIASES: Record<string, Role> = {
  night_mode: "night",
  calibration: "calibrate",
  rear_volume: "rear",
};

/** jbl_bar's "Next Atmos level" button steps through these atmos_level sensor states. */
const JBL_ONE_ATMOS = { options: ["1", "2", "3"], labels: { "1": "low", "2": "mid", "3": "high" } };

/** "EQ 125 Hz" -> "125 Hz", "EQ 1000 Hz" -> "1 kHz". */
export function bandLabelFromName(friendlyName: string | undefined, entityId: string): string {
  const hz = friendlyName?.match(/(\d+)\s*Hz\s*$/i)?.[1] ?? entityId.match(/_(\d+)hz(?:_\d+)?$/)?.[1];
  if (!hz) return friendlyName ?? entityId;
  const value = Number(hz);
  return value >= 1000 ? `${value / 1000} kHz` : `${value} Hz`;
}

/** Frequency of a band label, for sorting ("2 kHz" -> 2000). Unknown labels sort last. */
const bandHz = (label: string): number => {
  const m = label.match(/^([\d.]+)\s*(k?)Hz$/);
  return m ? Number(m[1]) * (m[2] ? 1000 : 1) : Number.MAX_SAFE_INTEGER;
};

/** Platform of a bar's media_player from the registry. */
export function platformOf(hass: HomeAssistant, mediaPlayer: string): string | undefined {
  return hass.entities?.[mediaPlayer]?.platform;
}

/** Front EQ band index -> frequency label (EQ_BANDS = 125, 500, 2000, 4000, 8000 in the integration). */
export const EQ_BAND_LABELS = ["125 Hz", "500 Hz", "2 kHz", "4 kHz", "8 kHz"] as const;

/** Fixed entity ids of the unregistered line and recent buttons (not in hass.entities). */
export const LINES = 8;
export const RECENT = 4;
const fixedIds = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `button.${prefix}_${i + 1}`);
export const TIMER_LINE_IDS = fixedIds("jbl_timer_line", LINES);
export const MESSAGE_LINE_IDS = fixedIds("jbl_message_line", LINES);
export const RECENT_TIMER_IDS = fixedIds("jbl_recent_timer", RECENT);
export const RECENT_MESSAGE_IDS = fixedIds("jbl_recent_message", RECENT);

/** Registered entities with a forced, language-independent entity_id (fallback when the registry lookup fails). */
const FIXED_REGISTERED: Partial<Record<Role, string>> = {
  display_clock: "switch.jbl_display_clock",
  display_clock_when: "select.jbl_display_clock_when",
};

const domainOf = (entityId: string): string => entityId.slice(0, entityId.indexOf("."));

const registry = (hass: HomeAssistant): EntityRegistryDisplayEntry[] => Object.values(hass.entities ?? {});

/** Every jbl_bar_91 and jbl_bar media_player, in registry order. */
export function findBars(hass: HomeAssistant): string[] {
  return registry(hass)
    .filter((e) => e.platform !== undefined && PLATFORMS.includes(e.platform) && domainOf(e.entity_id) === "media_player")
    .map((e) => e.entity_id);
}

/** The bar to show: the configured entity if it is a known entity, else the first bar found. */
export function resolveBar(hass: HomeAssistant, configured?: string): string | undefined {
  if (configured) return hass.states[configured] || hass.entities?.[configured] ? configured : undefined;
  return findBars(hass)[0];
}

/** Index of an EQ band from its friendly_name or entity_id (the band text is not translated in en and fr). */
export function bandIndexFromText(friendlyName: string | undefined, entityId: string): number | undefined {
  const byValue = (value: string | undefined): number | undefined => {
    switch (value) {
      case "125":
        return 0;
      case "500":
        return 1;
      case "2":
        return 2;
      case "4":
        return 3;
      case "8":
        return 4;
      default:
        return undefined;
    }
  };
  const name = friendlyName?.match(/(?:^|\s)(125|500) Hz$|(?:^|\s)([248]) kHz$/);
  if (name) return byValue(name[1] ?? name[2]);
  const id = entityId.match(/_(125|500)_hz(?:_\d+)?$|_([248])_khz(?:_\d+)?$/);
  if (id) return byValue(id[1] ?? id[2]);
  return undefined;
}

/** Index of an EQ band from its registry unique_id ("<entry>_eq_band_3" -> 3). */
export function bandIndexFromUniqueId(uniqueId: string | undefined): number | undefined {
  const m = uniqueId?.match(/_eq_band_([0-4])$/);
  return m ? Number(m[1]) : undefined;
}

export interface DiscoverOptions {
  /** entity_id -> band index learned from the entity registry (unique_id). Wins over text parsing. */
  bandHints?: Record<string, number>;
  /** Include the line/recent buttons even when several bars exist (config `recent: true`). */
  includeUnregistered?: boolean;
}

/**
 * Find every entity of the bar whose media_player is `mediaPlayer`.
 * Siblings are matched by device_id + platform + translation_key, never by entity_id text.
 */
export function discover(hass: HomeAssistant, mediaPlayer: string, options: DiscoverOptions = {}): BarEntities {
  const all = registry(hass);
  const bars = findBars(hass);
  const deviceId = hass.entities?.[mediaPlayer]?.device_id;
  const result: BarEntities = {
    media_player: mediaPlayer,
    device_id: deviceId,
    eqBands: [undefined, undefined, undefined, undefined, undefined],
    eqBandsGuessed: [],
    timerLines: [],
    messageLines: [],
    recentTimers: [],
    recentMessages: [],
    multipleBars: bars.length > 1,
  };

  if (platformOf(hass, mediaPlayer) === JBL_ONE_DOMAIN) return discoverJblOne(hass, all, result);

  const siblings = deviceId ? all.filter((e) => e.platform === DOMAIN && e.device_id === deviceId) : [];
  const bands: string[] = [];
  for (const entry of siblings) {
    const key = entry.translation_key;
    const domain = domainOf(entry.entity_id);
    if (key === "eq_band" && domain === "number") {
      bands.push(entry.entity_id);
      continue;
    }
    if (!key || !(key in ROLE_DOMAINS)) continue;
    const role = key as Role;
    if (ROLE_DOMAINS[role] !== domain || result[role]) continue;
    result[role] = entry.entity_id;
  }

  // EQ bands: registry hint > friendly_name/entity_id text > registry order (creation order = index order).
  const hints = options.bandHints ?? {};
  const unplaced: string[] = [];
  for (const id of bands) {
    const index = hints[id] ?? bandIndexFromText(hass.states[id]?.attributes.friendly_name, id);
    if (index !== undefined && result.eqBands[index] === undefined) result.eqBands[index] = id;
    else unplaced.push(id);
  }
  for (const id of unplaced) {
    const free = result.eqBands.findIndex((v) => v === undefined);
    if (free < 0) break;
    result.eqBands[free] = id;
    result.eqBandsGuessed.push(id);
  }

  // Line and recent buttons carry no device id and only ever belong to the first bar HA
  // loaded (a second bar collides on the fixed ids), so only use them with one bar.
  const single = bars.length <= 1;
  if (single) {
    for (const [role, id] of Object.entries(FIXED_REGISTERED) as [Role, string][]) {
      if (!result[role] && hass.states[id]) result[role] = id;
    }
  }
  if (single || options.includeUnregistered) {
    const present = (ids: string[]): string[] => ids.filter((id) => hass.states[id] !== undefined);
    result.timerLines = present(TIMER_LINE_IDS);
    result.messageLines = present(MESSAGE_LINE_IDS);
    result.recentTimers = present(RECENT_TIMER_IDS);
    result.recentMessages = present(RECENT_MESSAGE_IDS);
  }
  return result;
}

/** Which rear speaker a jbl_bar rear device is: from its identifier ("..._rear_left"), else its name. */
function rearSide(hass: HomeAssistant, deviceId: string): "left" | "right" | undefined {
  const device = hass.devices?.[deviceId];
  const text = [...(device?.identifiers ?? []).map((i) => i[1]), device?.name ?? "", device?.name_by_user ?? ""]
    .join(" ")
    .toLowerCase();
  if (/rear_left|\bleft\b/.test(text)) return "left";
  if (/rear_right|\bright\b/.test(text)) return "right";
  return undefined;
}

/**
 * JBL One bars (jbl_bar integration). Same translation_keys where the settings match, a few
 * aliases, the rear speakers as their own devices (via the bar), the Atmos level as a
 * "next level" button plus a sensor, seven EQ bands and a 0..100 % volume.
 */
function discoverJblOne(hass: HomeAssistant, all: EntityRegistryDisplayEntry[], result: BarEntities): BarEntities {
  const deviceId = result.device_id;
  result.platform = JBL_ONE_DOMAIN;
  result.volumeMax = JBL_ONE_VOLUME_MAX;
  result.volumeStep = JBL_ONE_VOLUME_STEP;
  if (!deviceId) return result;

  const mine = all.filter((e) => e.platform === JBL_ONE_DOMAIN && e.device_id === deviceId);
  const bands: { id: string; label: string }[] = [];
  let atmosButton: string | undefined;
  let atmosLevel: string | undefined;
  for (const entry of mine) {
    const key = entry.translation_key;
    const domain = domainOf(entry.entity_id);
    if (!key) continue;
    if (key === "eq_band" && domain === "number") {
      bands.push({ id: entry.entity_id, label: bandLabelFromName(hass.states[entry.entity_id]?.attributes.friendly_name, entry.entity_id) });
      continue;
    }
    if (key === "atmos" && domain === "button") atmosButton = entry.entity_id;
    if (key === "atmos_level" && domain === "sensor") atmosLevel = entry.entity_id;
    // "bass" is a select on the Bar 9.1 but the Bass boost key of the remote on JBL One bars.
    const role = (key === "bass" && domain === "button" ? "bass_boost" : (JBL_ONE_ALIASES[key] ?? key)) as Role;
    if (!(role in ROLE_DOMAINS) || ROLE_DOMAINS[role] !== domain || result[role]) continue;
    result[role] = entry.entity_id;
  }

  // The rear speakers are separate devices connected through the bar.
  const rearDevices = Object.values(hass.devices ?? {}).filter((d) => d.via_device_id === deviceId);
  for (const device of rearDevices) {
    const side = rearSide(hass, device.id);
    for (const entry of all.filter((e) => e.platform === JBL_ONE_DOMAIN && e.device_id === device.id)) {
      if (entry.translation_key === "rear_battery" && side) result[`rear_battery_${side}`] ??= entry.entity_id;
      if (entry.translation_key === "rear_online" && side) result[`rear_online_${side}`] ??= entry.entity_id;
      if (entry.translation_key === "rear_charging" && side) result[`rear_charging_${side}`] ??= entry.entity_id;
      // Both rears dock together; the left one stands for both (the right one when there is no left).
      if (entry.translation_key === "rear_docked" && (side === "left" || !result.rear_docked)) result.rear_docked = entry.entity_id;
    }
  }

  if (atmosButton && atmosLevel) {
    result.atmos = atmosLevel;
    result.cycles = { [atmosLevel]: { button: atmosButton, ...JBL_ONE_ATMOS } };
  }

  bands.sort((a, b) => bandHz(a.label) - bandHz(b.label));
  result.eqBands = bands.map((b) => b.id);
  result.eqBandLabels = bands.map((b) => b.label);
  return result;
}

/** Every entity id the card reads, for shouldUpdate filtering. */
export function watchedIds(entities: BarEntities): string[] {
  const ids = new Set<string>();
  for (const [key, value] of Object.entries(entities)) {
    if (key in ROLE_DOMAINS && typeof value === "string") ids.add(value);
  }
  for (const cycle of Object.values(entities.cycles ?? {})) ids.add(cycle.button);
  for (const id of entities.eqBands) if (id) ids.add(id);
  for (const list of [entities.timerLines, entities.messageLines, entities.recentTimers, entities.recentMessages]) {
    for (const id of list) ids.add(id);
  }
  return [...ids];
}

/**
 * Ask the entity registry for the unique_id of band entities whose index could not be read
 * from their name or entity_id (renamed entities). Returns entity_id -> index for the ones found.
 * Uses config/entity_registry/get_entries, falling back to one config/entity_registry/get per entity.
 */
export async function lookupBandIndexes(hass: HomeAssistant, entityIds: string[]): Promise<Record<string, number>> {
  const found: Record<string, number> = {};
  if (!entityIds.length) return found;
  try {
    const entries = await hass.callWS<Record<string, { unique_id?: string } | null>>({
      type: "config/entity_registry/get_entries",
      entity_ids: entityIds,
    });
    for (const id of entityIds) {
      const index = bandIndexFromUniqueId(entries?.[id]?.unique_id);
      if (index !== undefined) found[id] = index;
    }
    return found;
  } catch {
    // Older cores: fall back to single lookups.
  }
  for (const id of entityIds) {
    try {
      const entry = await hass.callWS<{ unique_id?: string }>({ type: "config/entity_registry/get", entity_id: id });
      const index = bandIndexFromUniqueId(entry?.unique_id);
      if (index !== undefined) found[id] = index;
    } catch {
      // Not allowed or not found: keep the registry-order guess.
    }
  }
  return found;
}
