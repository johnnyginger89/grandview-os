import "server-only";

/** Stages that can only be reached once the estimate visit has happened. */
export const POST_VISIT_STAGE_KEYS = ["estimate_completed", "proposal_sent", "won"] as const;

/**
 * Pure: extra opportunity fields to write alongside a booking or stage change,
 * so the dashboard can count visits booked and visits completed per period.
 * "follow_up" is used both before and after visits, so it never sets a milestone.
 */
export function milestoneUpdates(
  opp: { estimateVisitAt: Date | null; visitBookedAt: Date | null; visitCompletedAt: Date | null },
  change: { newVisitAt?: Date | null; toStageKey?: string },
  now: Date,
): { visitBookedAt?: Date; visitCompletedAt?: Date } {
  const out: { visitBookedAt?: Date; visitCompletedAt?: Date } = {};
  // Reschedules keep the first booking time.
  if (change.newVisitAt && !opp.visitBookedAt) out.visitBookedAt = now;
  if (!opp.visitCompletedAt && change.toStageKey) {
    const visit = change.newVisitAt ?? opp.estimateVisitAt;
    const visitPassed = !!visit && visit.getTime() <= now.getTime();
    if (change.toStageKey === "estimate_completed") out.visitCompletedAt = visitPassed ? visit! : now;
    else if ((change.toStageKey === "proposal_sent" || change.toStageKey === "won") && visitPassed) out.visitCompletedAt = visit!;
  }
  return out;
}
