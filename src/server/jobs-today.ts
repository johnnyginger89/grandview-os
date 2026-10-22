import "server-only";
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { projects, scheduleEntries } from "@/db/schema";
import { todayIso } from "@/lib/calendar-date";
import { Decimal, toDb } from "@/lib/money";

/*
 * "$ (N jobs today)" on the phone Home screen: jobs being worked on, with a painting
 * booking on today's Vancouver calendar day. Booking days are calendar days with an
 * inclusive end, so a job counts all day on its last day (projects.end_date is the
 * start of that day as an instant, which is why it can't be used here). The contract
 * price is only read with `money` (financials.read). Never cache this.
 */

const WORKING = ["scheduled", "in_progress", "walk_through"] as const;

export async function jobsToday(now: Date, opts: { money: boolean }): Promise<{ count: number; value: string | null }> {
  const today = todayIso(now);
  const on = and(
    isNull(scheduleEntries.deletedAt),
    eq(scheduleEntries.kind, "work"),
    lte(scheduleEntries.startDate, today),
    gte(scheduleEntries.endDate, today),
    inArray(projects.status, [...WORKING]),
  );
  // One row per job, however many crews are on it today.
  if (!opts.money) {
    const rows = await db.selectDistinct({ projectId: projects.id }).from(scheduleEntries).innerJoin(projects, eq(projects.id, scheduleEntries.projectId)).where(on);
    return { count: rows.length, value: null };
  }
  const rows = await db
    .selectDistinct({ projectId: projects.id, price: projects.contractPrice })
    .from(scheduleEntries)
    .innerJoin(projects, eq(projects.id, scheduleEntries.projectId))
    .where(on);
  return { count: rows.length, value: toDb(rows.reduce((sum, r) => sum.plus(r.price), new Decimal(0))) };
}
