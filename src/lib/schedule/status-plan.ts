/**
 * Automatic project status from bookings. Only need_to_schedule ⇄ scheduled moves by
 * itself (plus on_hold → scheduled when the user confirms); nothing is time-based.
 */
import type { ProjectStatus } from "@/db/schema/projects";
import { SCHEDULE_ENTRY_KINDS, type ScheduleEntryKind } from "./constants";

/** Null = no change. */
export function planAutoStatus(status: ProjectStatus, workEntryCount: number, opts: { confirmOnHold: boolean }): ProjectStatus | null {
  if (workEntryCount > 0) {
    if (status === "need_to_schedule") return "scheduled";
    if (status === "on_hold" && opts.confirmOnHold) return "scheduled";
    return null;
  }
  return status === "scheduled" ? "need_to_schedule" : null;
}

const VISITS_ONLY: readonly ScheduleEntryKind[] = ["touch_up", "walk_through"];

/** Booking kinds a project in this status accepts. */
export function allowedKinds(status: ProjectStatus): readonly ScheduleEntryKind[] {
  if (status === "cancelled" || status === "closed") return [];
  if (status === "complete" || status === "invoiced") return VISITS_ONLY;
  return SCHEDULE_ENTRY_KINDS;
}

/** Why a booking of `kind` can't be added, or null. */
export function kindRefusal(status: ProjectStatus, kind: ScheduleEntryKind): string | null {
  if (allowedKinds(status).includes(kind)) return null;
  if (status === "cancelled") return "This job is cancelled.";
  if (status === "closed") return "This job is closed.";
  return "This job is complete. Add a touch-up or walk-through visit instead.";
}
