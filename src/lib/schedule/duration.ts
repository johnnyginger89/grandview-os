/** Hours ↔ working days for crews. Decimal throughout; the estimating engine owns the rounding rule. */
import { crewDurationDays } from "@/lib/estimating/engine";
import { d, Decimal, type DecimalInput } from "@/lib/money";
import { MAX_WORKING_DAYS } from "./constants";

export interface CrewCapacity {
  crewSize: number;
  /** numeric(4,2) as stored, e.g. "8" or "7.5". */
  hoursPerDay: string;
}

/** Below this many unscheduled hours a scheduled job leaves the "Partly scheduled" list. */
export const PARTLY_SCHEDULED_MIN_HOURS = 8;

export function crewDayHours(crew: CrewCapacity): Decimal {
  return d(crew.hoursPerDay).times(crew.crewSize);
}

/** Whole working days for `hours` with this crew: at least 1, at most 120. */
export function suggestedWorkingDays(hours: DecimalInput, crew: CrewCapacity): number {
  const days = crewDurationDays(Decimal.max(d(hours), 0), crew.crewSize, crew.hoursPerDay).ceil().toNumber();
  return Math.min(MAX_WORKING_DAYS, Math.max(1, days));
}

/** Hours a booking accounts for: its planned hours, else working days × the crew's (or default) capacity. */
export function entryHours(
  e: { plannedHours: string | null; workingDays: number },
  crew: CrewCapacity | null | undefined,
  fallback: CrewCapacity,
): Decimal {
  if (e.plannedHours !== null && e.plannedHours !== "") return d(e.plannedHours);
  return crewDayHours(crew ?? fallback).times(Math.max(0, e.workingDays));
}

/** Estimated minus scheduled, never negative. */
export function remainingHours(estimated: DecimalInput, scheduled: DecimalInput): Decimal {
  return Decimal.max(d(estimated).minus(d(scheduled)), 0);
}

/** Split hours by working-day share, to the cent; the remainder goes to the second part. */
export function splitHours(total: DecimalInput, firstDays: number, secondDays: number): [string, string] {
  const t = d(total);
  const all = firstDays + secondDays;
  const first = all > 0 ? t.times(firstDays).div(all).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : t.div(2).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return [first.toFixed(2), t.minus(first).toFixed(2)];
}
