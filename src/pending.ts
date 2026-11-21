import type { HomeAssistant } from "./types";

interface Entry {
  /** Calls still waiting for HA. */
  inflight: number;
  value?: unknown;
  /** After success: stay pending until this holds or the deadline passes. */
  until?: (hass: HomeAssistant) => boolean;
  deadline?: number;
}

export const DEFAULT_UNTIL_TIMEOUT = 20000;

/**
 * Tracks which controls are waiting for the bar. A key is pending while one of its calls is
 * in flight and, after the last call succeeded, until its `until` predicate holds on a later
 * hass (the integration confirms most controls before the service call returns, but the new
 * state can arrive a moment later).
 */
export class PendingRegistry {
  private readonly entries = new Map<string, Entry>();

  start(key: string, value: unknown): void {
    const entry = this.entries.get(key) ?? { inflight: 0 };
    entry.inflight += 1;
    entry.value = value;
    entry.until = undefined;
    entry.deadline = undefined;
    this.entries.set(key, entry);
  }

  /**
   * A call finished. Returns the deadline (ms epoch) when the key keeps waiting for `until`,
   * so the caller can schedule a re-check.
   */
  finish(
    key: string,
    ok: boolean,
    hass: HomeAssistant | undefined,
    until: ((hass: HomeAssistant) => boolean) | undefined,
    timeoutMs: number = DEFAULT_UNTIL_TIMEOUT,
    now: number = Date.now(),
  ): number | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.inflight = Math.max(0, entry.inflight - 1);
    if (entry.inflight > 0) return undefined;
    if (ok && until && hass && !safe(until, hass)) {
      entry.until = until;
      entry.deadline = now + timeoutMs;
      return entry.deadline;
    }
    this.entries.delete(key);
    return undefined;
  }

  /** Drop keys whose `until` now holds or whose deadline passed. Returns true when something changed. */
  refresh(hass: HomeAssistant | undefined, now: number = Date.now()): boolean {
    let changed = false;
    for (const [key, entry] of this.entries) {
      if (entry.inflight > 0 || !entry.until) continue;
      if ((hass && safe(entry.until, hass)) || (entry.deadline !== undefined && now >= entry.deadline)) {
        this.entries.delete(key);
        changed = true;
      }
    }
    return changed;
  }

  isPending(key: string): boolean {
    return this.entries.has(key);
  }

  value<T>(key: string): T | undefined {
    return this.entries.get(key)?.value as T | undefined;
  }

  /** The earliest deadline of a key waiting for its `until`, if any. */
  nextDeadline(): number | undefined {
    let next: number | undefined;
    for (const entry of this.entries.values()) {
      if (entry.inflight > 0 || entry.deadline === undefined) continue;
      if (next === undefined || entry.deadline < next) next = entry.deadline;
    }
    return next;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

function safe(fn: (hass: HomeAssistant) => boolean, hass: HomeAssistant): boolean {
  try {
    return fn(hass);
  } catch {
    return true;
  }
}
