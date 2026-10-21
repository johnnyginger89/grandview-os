import "server-only";
import { can } from "@/lib/authz/permissions";
import { crewIdsForUser } from "@/server/crews";

/**
 * Who may open /my-jobs (feasibility review F28): field roles, plus anyone who
 * belongs to an active crew, so office staff who also paint see their bookings.
 * The page itself only ever shows the viewer's own crews' jobs.
 */
export async function canOpenMyJobs(user: { id: string; role: string }): Promise<boolean> {
  if (can(user.role, "projects.read_assigned")) return true;
  return (await crewIdsForUser(user.id)).length > 0;
}
