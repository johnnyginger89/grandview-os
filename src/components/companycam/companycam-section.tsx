import { getCurrentUser } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { companyCamPanel } from "@/server/integrations/companycam";
import { CompanyCamCard } from "./companycam-card";

/** The CompanyCam card for an estimate or a job, for people who can see it. */
export async function CompanyCamSection({ entityType, entityId, className }: { entityType: "project" | "estimate"; entityId: string; className?: string }) {
  const viewer = await getCurrentUser();
  if (!viewer || !can(viewer.role, entityType === "estimate" ? "estimates.read" : "projects.read_all")) return null;
  const panel = await companyCamPanel(entityType, entityId);
  if (!panel) return null;
  return (
    <CompanyCamCard
      className={className}
      entity={{ entityType, entityId }}
      panel={panel}
      canEdit={can(viewer.role, entityType === "estimate" ? "estimates.write" : "projects.write")}
      canConnect={can(viewer.role, "settings.manage")}
    />
  );
}
