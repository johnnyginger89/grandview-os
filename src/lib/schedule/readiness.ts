/** "Ready to schedule?" checks: warn, never block. Missing answers count as "todo". */
import type { IsoDate } from "@/lib/calendar-date";
import type { ReadinessState, ScheduleEntryKind } from "./constants";
import type { ReadinessCheck } from "./settings-schema";

export interface ReadinessSummary {
  total: number;
  ready: number;
  /** 0–100. */
  pct: number;
  /** Labels of the checks that aren't done or not needed. */
  missing: string[];
}

export interface ReadinessItem {
  key: string;
  label: string;
  states: ReadinessCheck["states"];
  linkedEntryKind: ScheduleEntryKind | null;
  state: ReadinessState;
  /** The label for the current state, e.g. "Ordered". */
  stateLabel: string;
  dueDate: IsoDate | null;
  note: string | null;
}

type Row = { checkKey: string; state: ReadinessState };
const isReady = (s: ReadinessState) => s === "done" || s === "not_needed";

/** Answers to checks that were removed from the settings are ignored (kept in the DB, hidden). */
export function readinessSummary(checks: readonly ReadinessCheck[], rows: readonly Row[]): ReadinessSummary {
  const state = new Map(rows.map((r) => [r.checkKey, r.state]));
  const missing = checks.filter((c) => !isReady(state.get(c.key) ?? "todo")).map((c) => c.label);
  const total = checks.length;
  const ready = total - missing.length;
  return { total, ready, pct: total ? Math.round((ready / total) * 100) : 100, missing };
}

export function readinessItems(
  checks: readonly ReadinessCheck[],
  rows: readonly (Row & { dueDate: IsoDate | null; note: string | null })[],
): ReadinessItem[] {
  const byKey = new Map(rows.map((r) => [r.checkKey, r]));
  return checks.map((c) => {
    const row = byKey.get(c.key);
    const state = row?.state ?? "todo";
    return {
      key: c.key,
      label: c.label,
      states: { ...c.states },
      linkedEntryKind: c.linkedEntryKind,
      state,
      stateLabel: c.states[state],
      dueDate: row?.dueDate ?? null,
      note: row?.note ?? null,
    };
  });
}

/** Booking a linked kind (e.g. a pressure wash) moves its check from "todo" to "in_progress" with that date. */
export function linkedReadinessUpdate(
  checks: readonly ReadinessCheck[],
  rows: readonly Row[],
  entryKind: ScheduleEntryKind,
  startDate: IsoDate,
): { checkKey: string; state: "in_progress"; dueDate: IsoDate } | null {
  const check = checks.find((c) => c.linkedEntryKind === entryKind);
  if (!check) return null;
  const current = rows.find((r) => r.checkKey === check.key)?.state ?? "todo";
  return current === "todo" ? { checkKey: check.key, state: "in_progress", dueDate: startDate } : null;
}
