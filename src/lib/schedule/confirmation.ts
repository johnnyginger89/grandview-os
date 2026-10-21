/**
 * The customer start-date workflow, mirroring monday's stages:
 * none → week_sent → week_confirmed → date_sent → date_confirmed.
 * Nothing here sends anything; every notice is a human click with a preview.
 */
import type { IsoDate } from "@/lib/calendar-date";
import type { NoticeKind, ScheduleEntryKind, StartConfirmation } from "./constants";
import { mondayOf } from "./dates";

export type { NoticeKind } from "./constants";
export type ConfirmationAction = "send_week" | "send_date" | "confirm_week" | "confirm_date" | "send_update";

interface SchedulingState {
  confirmation: StartConfirmation;
  communicatedStart: IsoDate | null;
}

export function afterNoticeSent(_current: StartConfirmation, kind: NoticeKind): StartConfirmation {
  return kind === "start_week" ? "week_sent" : "date_sent";
}

export function afterConfirmed(_current: StartConfirmation, kind: NoticeKind): StartConfirmation {
  return kind === "start_week" ? "week_confirmed" : "date_confirmed";
}

const isWeekStage = (c: StartConfirmation) => c === "week_sent" || c === "week_confirmed";

/**
 * The customer was told something that no longer matches the first work day. After
 * a week notice only a move to another week matters; after a date notice any move does.
 */
export function needsUpdate(s: SchedulingState, currentStart: IsoDate | null): boolean {
  if (s.confirmation === "none" || !s.communicatedStart || !currentStart) return false;
  if (isWeekStage(s.confirmation)) return mondayOf(s.communicatedStart) !== mondayOf(currentStart);
  return s.communicatedStart !== currentStart;
}

/** Buttons to show for the customer block. "send_update" sends the start-date notice with the "updated" template. */
export function availableActions(s: SchedulingState, currentStart: IsoDate | null): ConfirmationAction[] {
  const moved = needsUpdate(s, currentStart);
  switch (s.confirmation) {
    case "none":
      return ["send_week", "send_date"];
    case "week_sent":
      return moved ? ["send_week", "confirm_week", "send_date"] : ["confirm_week", "send_date"];
    case "week_confirmed":
      return moved ? ["send_week", "send_date"] : ["send_date"];
    case "date_sent":
      return moved ? ["send_update", "confirm_date"] : ["confirm_date", "send_date"];
    case "date_confirmed":
      return moved ? ["send_update"] : [];
  }
}

/** Work bookings look tentative (dashed, hatched) until the customer confirms the date. */
export function isTentative(kind: ScheduleEntryKind, confirmation: StartConfirmation): boolean {
  return kind === "work" && confirmation !== "date_confirmed";
}

export const CONFIRMATION_LABEL: Record<StartConfirmation, string> = {
  none: "Not sent",
  week_sent: "Start week sent",
  week_confirmed: "Week confirmed",
  date_sent: "Start date sent",
  date_confirmed: "Date confirmed",
};

export const ACTION_LABEL: Record<ConfirmationAction, string> = {
  send_week: "Send start week…",
  send_date: "Send start date…",
  confirm_week: "Mark week confirmed",
  confirm_date: "Mark date confirmed",
  send_update: "Send updated start date…",
};

/** The notice kind a send action uses. */
export function noticeKindFor(action: "send_week" | "send_date" | "send_update"): NoticeKind {
  return action === "send_week" ? "start_week" : "start_date";
}
