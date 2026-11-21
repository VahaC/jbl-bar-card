import type { HassEntity } from "./types";

/**
 * Small helpers for reading entity states and attributes, shared by the tabs.
 * They never throw and treat missing, unknown and unavailable alike.
 */

/** A rear speaker battery below this level (%) counts as low: Home marks it, System explains how to fix it. */
export const LOW_BATTERY = 20;

/** True for a state that carries no value: missing, "", "unknown" or "unavailable". */
export function isBlankState(state: string | undefined): boolean {
  return state === undefined || state === "" || state === "unknown" || state === "unavailable";
}

/** A finite number attribute, else `fallback` (e.g. a number entity's min / max / step). */
export function numAttr(st: HassEntity | undefined, name: string, fallback: number): number {
  const value = st?.attributes[name];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** A non-empty string attribute, else undefined. */
export function textAttr(st: HassEntity | undefined, name: string): string | undefined {
  const value = st?.attributes[name];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** A select entity's `options` attribute, or `fallback` when it is missing or empty. */
export function selectOptions(st: HassEntity | undefined, fallback: readonly string[]): string[] {
  const options = st?.attributes.options;
  if (Array.isArray(options)) {
    const list = options.filter((o): o is string => typeof o === "string");
    if (list.length) return list;
  }
  return [...fallback];
}
