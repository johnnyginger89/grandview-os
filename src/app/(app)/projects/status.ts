import type { Tone } from "@/components/ui";
import type { ProjectStatus } from "@/db/schema/projects";

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  need_to_schedule: "Need to schedule",
  scheduled: "Scheduled",
  in_progress: "In progress",
  walk_through: "Walk-through",
  complete: "Complete",
  invoiced: "Invoiced",
  closed: "Job costed / closed",
  on_hold: "On hold",
  cancelled: "Cancelled",
};
export const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = {
  need_to_schedule: "warning",
  scheduled: "info",
  in_progress: "brand",
  walk_through: "info",
  complete: "success",
  invoiced: "success",
  closed: "neutral",
  on_hold: "neutral",
  cancelled: "danger",
};
