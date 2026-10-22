import type { ProposalRow } from "./proposal-types";

/** Proposals sent before their time was tied to the estimate's version were recorded a moment apart from it. */
const SAME_SEND_MS = 1_000;

/**
 * When the estimate has changed since its open proposal went out, when that proposal was sent
 * (the customer keeps seeing that version until it's sent again); otherwise null. `version` is
 * the estimate's saved version; `dirty` means changes on screen aren't saved yet.
 */
export function changedSinceSent(status: string, rows: ProposalRow[], state: { version: string; dirty: boolean }): string | null {
  if (status === "accepted") return null;
  const open = rows.find((p) => p.status === "sent" || p.status === "viewed");
  if (!open) return null;
  const changed = state.dirty || Date.parse(state.version) - Date.parse(open.sentAt) > SAME_SEND_MS;
  return changed ? open.sentAt : null;
}
