import "server-only";

export type ScheduleChangeKind = "create" | "update" | "delete" | "split";

export interface ScheduleChange {
  kind: ScheduleChangeKind;
  projectId: string;
  entryIds: string[];
  actorId: string | null;
}

/**
 * Called by src/server/schedule.ts after every committed change to schedule_entries.
 * A seam for later batches (Slack schedule events, Google Calendar sync); it does
 * nothing today. Whatever is added here must catch its own errors, never block or
 * fail the booking, and never message customers (CLAUDE.md rule 8).
 */
export async function afterScheduleChange(change: ScheduleChange): Promise<void> {
  void change;
}
