import { getCurrentUser } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { todayIso } from "@/lib/calendar-date";
import { listCrews } from "@/server/crews";
import { getProjectSchedule } from "@/server/schedule";
import { getHoursPerCrewDay, getScheduleSettings } from "@/server/schedule-settings";
import { listWorkOrders, newWorkOrderDefaults } from "@/server/work-orders";
import { bookingFormProps } from "./booking-form-props";
import { WorkOrdersPanel } from "./work-orders-panel";

/** The "Assign someone" form: booking a person or crew on the job is what gives them its work order. */
async function assignSetup(projectId: string) {
  const [dto, crews, settings, hoursPerCrewDay] = await Promise.all([getProjectSchedule(projectId), listCrews({ includeInactive: true }), getScheduleSettings(), getHoursPerCrewDay()]);
  return dto ? bookingFormProps(dto, crews, settings, hoursPerCrewDay, todayIso()) : null;
}

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
  const [workOrders, defaults, crews, assign] = await Promise.all([
    listWorkOrders(projectId, now),
    newWorkOrderDefaults(projectId),
    editable ? listCrews() : Promise.resolve([]),
    editable && can(viewer.role, "schedule.write") ? assignSetup(projectId) : Promise.resolve(null),
  ]);
  if (!defaults) return null;
  return (
    <WorkOrdersPanel
      className={className}
      projectId={projectId}
      canEdit={editable}
      workOrders={workOrders}
      defaults={defaults}
      crews={crews.map((c) => ({ id: c.id, name: c.name }))}
      assign={assign}
      now={now.toISOString()}
    />
  );
}
