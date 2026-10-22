/**
 * Is an issued work order behind the job? Crews only see issued versions, so when the
 * customer signs colours or a booking changes after the current version was issued,
 * the office has to issue a new one (it never happens by itself).
 */
import type { WorkOrderSection } from "@/server/work-order-view";

export type OutOfDateReason = "colours" | "bookings";

/** The parts of a work order each kind of change can alter. */
const SECTIONS: Record<OutOfDateReason, readonly WorkOrderSection[]> = {
  colours: ["colours", "scope", "paint"],
  bookings: ["bookings"],
};

/**
 * Why the current version is out of date, from timestamps: colours signed or bookings
 * changed (removals included) after it was issued. When it's known what a new version
 * would change, a reason only counts if it shows up there, so another crew's booking
 * moving doesn't flag a work order that wouldn't change.
 */
export function outOfDateReasons(
  issuedAt: Date | null,
  latest: { coloursSignedAt: Date | null; bookingsChangedAt: Date | null },
  pendingChanges: readonly WorkOrderSection[] | null,
): OutOfDateReason[] {
  if (!issuedAt) return [];
  const changedAt: Record<OutOfDateReason, Date | null> = { colours: latest.coloursSignedAt, bookings: latest.bookingsChangedAt };
  return (Object.keys(SECTIONS) as OutOfDateReason[]).filter((r) => {
    const at = changedAt[r];
    if (!at || at <= issuedAt) return false;
    return !pendingChanges || SECTIONS[r].some((s) => pendingChanges.includes(s));
  });
}

/** "The customer signed colours after version 2 was issued." */
export function outOfDateText(reasons: readonly OutOfDateReason[], version: number): string {
  const what =
    reasons.includes("colours") && reasons.includes("bookings") ? "The customer signed colours and bookings changed"
    : reasons.includes("colours") ? "The customer signed colours"
    : "Bookings changed";
  return `${what} after version ${version} was issued.`;
}
