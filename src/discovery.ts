import { ROLE_DOMAINS } from "./types";
import type { BarEntities, EntityRegistryDisplayEntry, HomeAssistant, Role } from "./types";

export const DOMAIN = "jbl_bar_91";

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

/** Every jbl_bar_91 media_player, in registry order. */
export function findBars(hass: HomeAssistant): string[] {
  return registry(hass)
    .filter((e) => e.platform === DOMAIN && domainOf(e.entity_id) === "media_player")
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

/** Every entity id the card reads, for shouldUpdate filtering. */
export function watchedIds(entities: BarEntities): string[] {
  const ids = new Set<string>();
  for (const [key, value] of Object.entries(entities)) {
    if (key in ROLE_DOMAINS && typeof value === "string") ids.add(value);
  }
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
