import type { TemplateResult } from "lit";
import { numericState } from "../format";
import type { HassEntity, TabContext } from "../types";
import { isBlankState as isBlank } from "../state";
import { systemModel } from "./system-model";
import { renderSystemHealth, systemHealthStyles } from "./system-layouts/health";
import { renderSystemList, systemListStyles } from "./system-layouts/list";
import { renderSystemMap, systemMapStyles } from "./system-layouts/map";

/** Pending keys used by this tab. */
export const SYSTEM_KEYS = {
  btPair: "system.bluetooth_pairing",
  btSource: "system.bluetooth_source",
  calibrate: "system.calibrate",
  subPair: "system.sub_pair",
  restart: "system.restart",
} as const;

/* ---------------- Pure helpers (exported for tests) ---------------- */

/** Seconds from a duration sensor, honouring the unit the user may have picked in HA. */
export function uptimeSeconds(st: HassEntity | undefined): number | undefined {
  const value = numericState(st?.state);
  if (value === undefined) return undefined;
  const unit = String(st?.attributes.unit_of_measurement ?? "s");
  const factor: Record<string, number> = { s: 1, ms: 0.001, min: 60, h: 3600, d: 86400 };
  return value * (factor[unit] ?? 1);
}

/** Wi-Fi quality bucket for a dBm reading. */
export function wifiQuality(dbm: number): "excellent" | "good" | "fair" | "weak" {
  if (dbm >= -55) return "excellent";
  if (dbm >= -67) return "good";
  if (dbm >= -75) return "fair";
  return "weak";
}

export type CalibrationKind = "idle" | "running" | "done1" | "done2" | "failed" | "cancelled" | "unknown" | "other";

/**
 * The calibration sensor's phase. The remote reports what the bar's display shows:
 * Idle, "Step N starting", "Starting in N", Measuring, "Step N done", "Failed, retry", Cancelled.
 */
export function calibrationPhase(state: string | undefined): { kind: CalibrationKind; key?: string; vars?: Record<string, string | number> } {
  if (isBlank(state)) return { kind: "unknown" };
  const s = state!;
  if (s === "Idle") return { kind: "idle", key: "cal.idle" };
  const starting = s.match(/^Step ([12]) starting$/i);
  if (starting) return { kind: "running", key: "cal.step_starting", vars: { step: starting[1] } };
  const countdown = s.match(/^Starting in (\d+)/i);
  if (countdown) return { kind: "running", key: "cal.starting_in", vars: { seconds: countdown[1] } };
  if (s === "Measuring" || /starting/i.test(s)) return { kind: "running", key: "cal.measuring" };
  if (s === "Step 1 done") return { kind: "done1", key: "cal.step1_done" };
  if (s === "Step 2 done") return { kind: "done2", key: "cal.done" };
  if (/^failed/i.test(s)) return { kind: "failed", key: "cal.failed" };
  if (s === "Cancelled") return { kind: "cancelled", key: "cal.cancelled" };
  return { kind: "other" };
}

/* ---------------- Render ---------------- */

/**
 * The System tab in the layout the card config picks (layouts.system): "list" (compact
 * settings-style list, the default), "map" (the speakers as a picture with their actions) or
 * "health" (a health summary with device cards). All three render the same model.
 */
export function renderSystemTab(ctx: TabContext): TemplateResult {
  const model = systemModel(ctx);
  switch (ctx.config.layouts.system) {
    case "map":
      return renderSystemMap(ctx, model);
    case "health":
      return renderSystemHealth(ctx, model);
    default:
      return renderSystemList(ctx, model);
  }
}

/** Styles of every System layout (each layout prefixes its own selectors). */
export const systemStyles = [systemListStyles, systemMapStyles, systemHealthStyles];

