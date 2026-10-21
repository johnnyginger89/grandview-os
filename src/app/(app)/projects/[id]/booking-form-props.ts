import "server-only";
import { addDays, type IsoDate } from "@/lib/calendar-date";
import { remainingHours, suggestedWorkingDays } from "@/lib/schedule/duration";
import { KIND_LABEL } from "@/lib/schedule/format";
import type { ScheduleSettings } from "@/lib/schedule/settings-schema";
import { allowedKinds } from "@/lib/schedule/status-plan";
import { calendarsFor, nextWorkingDay } from "@/lib/schedule/working-days";
import type { listCrews } from "@/server/crews";
import type { getProjectSchedule } from "@/server/schedule";
import { defaultCapacity } from "@/server/schedule-settings";
import type { BookingFormSetup } from "./schedule-card-booking";

type ProjectSchedule = NonNullable<Awaited<ReturnType<typeof getProjectSchedule>>>;
type Crew = Awaited<ReturnType<typeof listCrews>>[number];

/**
 * What the "book someone on this job" form needs: the booking types the job's status
 * allows, active crews with the days they'd need for the hours still unscheduled, and a
 * first working day to start from. Shared by the Schedule and Work orders cards.
 */
export function bookingFormProps(dto: ProjectSchedule, crews: readonly Crew[], settings: ScheduleSettings, hoursPerCrewDay: string, today: IsoDate): BookingFormSetup {
  const left = remainingHours(dto.hours.estimated, dto.hours.scheduled);
  const base = dto.scheduling.notBefore && dto.scheduling.notBefore > addDays(today, 1) ? dto.scheduling.notBefore : addDays(today, 1);
  return {
    projectId: dto.projectId,
    onHold: dto.projectStatus === "on_hold",
    kinds: allowedKinds(dto.projectStatus).map((k) => ({ value: k, label: KIND_LABEL[k] })),
    crews: crews
      .filter((c) => c.active)
      .map((c) => ({ id: c.id, name: c.name, worksSaturdays: c.worksSaturdays, suggestedDays: suggestedWorkingDays(left, c) })),
    unassignedDays: suggestedWorkingDays(left, defaultCapacity(settings, hoursPerCrewDay)),
    calendar: { workDays: settings.workDays, holidayRegion: settings.holidayRegion, extraClosedDays: settings.extraClosedDays },
    defaultStart: nextWorkingDay(base, calendarsFor(settings, base, addDays(base, 90)).calFor(null)),
    hasBookings: dto.entries.length > 0,
  };
}
