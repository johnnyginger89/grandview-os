/**
 * The opportunity columns a stage change writes. Single and bulk moves both use
 * this, so they can't drift apart.
 */
export interface StageTransitionTarget {
  id: string;
  key: string;
  kind: "open" | "won" | "lost";
}

export function stageTransitionPatch(
  opp: { lostReason: string | null; lastContactedAt: Date | null },
  to: StageTransitionTarget,
  now: Date,
  lostReason?: string | null,
) {
  return {
    stageId: to.id,
    stageChangedAt: now,
    wonAt: to.kind === "won" ? now : null,
    closedAt: to.kind === "open" ? null : now,
    lostReason: to.kind === "lost" ? (lostReason ?? opp.lostReason) : null,
    lastContactedAt: to.key === "contacted" ? now : opp.lastContactedAt,
    updatedAt: now,
  };
}
