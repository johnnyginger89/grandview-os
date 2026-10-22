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

/** Kinds of work that are over once their booked days have passed: the check then shows as done. */
export const DONE_WHEN_BOOKING_PASSES: readonly ScheduleEntryKind[] = ["pressure_wash"];

/** For working out what to show: today in Vancouver and, by kind, the last day the project has booked. */
export interface ReadinessContext {
  today: IsoDate;
  bookedThrough: Partial<Record<ScheduleEntryKind, IsoDate>>;
}

/**
 * The state to show for a check. A booked pressure wash ("in progress") counts as done
 * once its last booked day has passed. That is worked out each time it's shown, so
 * nothing has to change it overnight; without a context, the saved answer is shown.
 */
export function shownState(check: ReadinessCheck, saved: ReadinessState, ctx?: ReadinessContext): ReadinessState {
  if (!ctx || saved !== "in_progress" || !check.linkedEntryKind || !DONE_WHEN_BOOKING_PASSES.includes(check.linkedEntryKind)) return saved;
  const last = ctx.bookedThrough[check.linkedEntryKind];
  return last && last < ctx.today ? "done" : saved;
}

/** Answers to checks that were removed from the settings are ignored (kept in the DB, hidden). */
export function readinessSummary(checks: readonly ReadinessCheck[], rows: readonly Row[], ctx?: ReadinessContext): ReadinessSummary {
  const state = new Map(rows.map((r) => [r.checkKey, r.state]));
  const missing = checks.filter((c) => !isReady(shownState(c, state.get(c.key) ?? "todo", ctx))).map((c) => c.label);
  const total = checks.length;
  const ready = total - missing.length;
  return { total, ready, pct: total ? Math.round((ready / total) * 100) : 100, missing };
}

export function readinessItems(
  checks: readonly ReadinessCheck[],
  rows: readonly (Row & { dueDate: IsoDate | null; note: string | null })[],
  ctx?: ReadinessContext,
): ReadinessItem[] {
  const byKey = new Map(rows.map((r) => [r.checkKey, r]));
  return checks.map((c) => {
    const row = byKey.get(c.key);
    const state = shownState(c, row?.state ?? "todo", ctx);
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

export interface LinkedBooking {
  kind: ScheduleEntryKind;
  startDate: IsoDate;
}

export interface LinkedReadinessChange {
  checkKey: string;
  state: "todo" | "in_progress";
  dueDate: IsoDate | null;
  before: { state: ReadinessState; dueDate: IsoDate | null };
}

/**
 * After a booking change: the checks linked to the kinds that changed follow the
 * project's current bookings. Booked → "in progress" with the day of the latest such
 * booking; none left → back to "todo". "Done" and "not needed" are the office's answers
 * and stay as they are.
 */
export function linkedReadinessChanges(
  checks: readonly ReadinessCheck[],
  rows: readonly (Row & { dueDate: IsoDate | null })[],
  bookings: readonly LinkedBooking[],
  changedKinds: readonly ScheduleEntryKind[],
): LinkedReadinessChange[] {
  const out: LinkedReadinessChange[] = [];
  for (const check of checks) {
    if (!check.linkedEntryKind || !changedKinds.includes(check.linkedEntryKind)) continue;
    const row = rows.find((r) => r.checkKey === check.key);
    const before = { state: row?.state ?? "todo", dueDate: row?.dueDate ?? null };
    if (isReady(before.state)) continue;
    const days = bookings.filter((b) => b.kind === check.linkedEntryKind).map((b) => b.startDate).sort();
    const next = days.length
      ? { state: "in_progress" as const, dueDate: days[days.length - 1] }
      : // An office "todo" keeps its own date; "booked" with nothing booked any more doesn't.
        { state: "todo" as const, dueDate: before.state === "todo" ? before.dueDate : null };
    if (next.state !== before.state || next.dueDate !== before.dueDate) out.push({ checkKey: check.key, ...next, before });
  }
  return out;
}
