import type { EntryDetails } from "@/components/schedule/entry-drawer";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { todayIso } from "@/lib/calendar-date";
import { windowQuerySchema } from "@/lib/schedule/schemas";
import type { EntryDTO } from "@/lib/schedule/types";
import { resolveWindow } from "@/lib/schedule/window";
import { getEntryWarnings, getProjectSchedule, getScheduleWindow, listFinishCandidates, listUnscheduled } from "@/server/schedule";
import { getHoursPerCrewDay, getScheduleSettings } from "@/server/schedule-settings";
import { ScheduleBoard, type SchedulePerms } from "./schedule-board";

export const metadata = { title: "Schedule" };

/** The open booking's project details (other bookings, readiness, customer stage) and live warnings. */
async function loadFocus(entry: EntryDTO, showHours: boolean): Promise<EntryDetails | null> {
  const [project, warnings] = await Promise.all([getProjectSchedule(entry.projectId), getEntryWarnings(entry.id)]);
  if (!project) return null;
  return { entryId: entry.id, project: { ...project, hours: showHours ? project.hours : null }, warnings };
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePermission("schedule.read");
  const query = windowQuerySchema.parse(await searchParams);
  const today = todayIso();
  const settings = await getScheduleSettings();
  const win = resolveWindow(query, settings, today);

  const canEdit = can(user.role, "schedule.write");
  const perms: SchedulePerms = {
    canEdit,
    canNotify: canEdit && can(user.role, "messages.send"),
    canOpenProject: can(user.role, "projects.read_all"),
    canManage: can(user.role, "schedule.manage"),
    canComplete: can(user.role, "projects.write"),
    canMarkInProgress: canEdit && can(user.role, "projects.write"),
  };

  // Every crew is loaded; the crew filter is applied in the browser so the
  // double-booking checks always see the whole picture.
  const [sched, unscheduled, hoursPerCrewDay, finish] = await Promise.all([
    getScheduleWindow({ from: win.from, to: win.to }),
    listUnscheduled(),
    getHoursPerCrewDay(),
    perms.canComplete ? listFinishCandidates() : Promise.resolve([]),
  ]);
  const focusEntry = win.focus ? sched.entries.find((e) => e.id === win.focus) : undefined;
  const focus = focusEntry ? await loadFocus(focusEntry, canEdit) : null;

  return (
    <ScheduleBoard
      win={win}
      today={today}
      settings={settings}
      crews={sched.crews}
      entries={sched.entries}
      readiness={sched.readiness}
      unscheduled={unscheduled}
      finish={finish}
      hoursPerCrewDay={hoursPerCrewDay}
      focus={focus}
      perms={perms}
    />
  );
}
