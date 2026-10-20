import type { Tone } from "@/components/ui";

export const PROJECT_STATUS_LABEL: Record<string, string> = {
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
export const PROJECT_STATUS_TONE: Record<string, Tone> = {
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
