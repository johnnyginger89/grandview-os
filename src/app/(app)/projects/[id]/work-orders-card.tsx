import { getCurrentUser } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { listCrews } from "@/server/crews";
import { listWorkOrders, newWorkOrderDefaults } from "@/server/work-orders";
import { WorkOrdersPanel } from "./work-orders-panel";

/**
 * "Work orders" card on the project page. Loads its own data. Reading needs
 * projects.read_all; editing needs `canEdit` and projects.write (checked again by
 * every action).
 */
export async function WorkOrdersCard({ projectId, canEdit, className }: { projectId: string; canEdit: boolean; className?: string }) {
  const viewer = await getCurrentUser();
  if (!viewer || !can(viewer.role, "projects.read_all")) return null;
  const editable = canEdit && can(viewer.role, "projects.write");
  const now = new Date();
  const [workOrders, defaults, crews] = await Promise.all([listWorkOrders(projectId, now), newWorkOrderDefaults(projectId), editable ? listCrews() : Promise.resolve([])]);
  if (!defaults) return null;
  return (
    <WorkOrdersPanel
      className={className}
      projectId={projectId}
      canEdit={editable}
      workOrders={workOrders}
      defaults={defaults}
      crews={crews.map((c) => ({ id: c.id, name: c.name }))}
      now={now.toISOString()}
    />
  );
}
