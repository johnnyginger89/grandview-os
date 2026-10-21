import { CalendarDays } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardHeader, LinkButton, Table, td, th } from "@/components/ui";
import { can } from "@/lib/authz/permissions";
import { addDays, parseIso, todayIso, toIso, type IsoDate } from "@/lib/calendar-date";
import { formatNum } from "@/lib/money";
import { crewColorClasses } from "@/lib/schedule/colors";
import { mondayOf } from "@/lib/schedule/dates";
import { remainingHours, suggestedWorkingDays } from "@/lib/schedule/duration";
import { dateRangeLabel, KIND_LABEL } from "@/lib/schedule/format";
import { allowedKinds } from "@/lib/schedule/status-plan";
import type { ProjectSchedulingDTO } from "@/lib/schedule/types";
import { calendarsFor, countWorkingDays, nextWorkingDay } from "@/lib/schedule/working-days";
import { cn, formatDate } from "@/lib/utils";
import { listCrews } from "@/server/crews";
import { getProjectSchedule } from "@/server/schedule";
import { defaultCapacity, getHoursPerCrewDay, getScheduleSettings } from "@/server/schedule-settings";
import { ScheduleBookingForm } from "./schedule-card-booking";
import { ScheduleCustomerBlock } from "./schedule-card-customer";
import { MarkInProgressButton, ReadinessChecklist, RemoveAllBookingsButton, SchedulingPrefsForm } from "./schedule-card-panels";

const VIA = { email: "email reply", phone: "phone", text: "text", in_person: "in person" } as const;

/** Sent / confirmed moments (instants, so formatDate is right here). */
function confirmationHistory(s: ProjectSchedulingDTO): string[] {
  // confirmed_via belongs to the latest confirmation.
  const via = s.confirmedVia ? ` (${VIA[s.confirmedVia]})` : "";
  const rows: [string | null, string][] = [
    [s.weekSentAt, "Start week email sent"],
    [s.weekConfirmedAt, `Customer confirmed the week${s.dateConfirmedAt ? "" : via}`],
    [s.dateSentAt, "Start date email sent"],
    [s.dateConfirmedAt, `Customer confirmed the date${via}`],
  ];
  return rows.filter(([at]) => at).map(([at, what]) => `${what} ${formatDate(at)}`);
}

/** April 1 of the coming spring. */
function nextSpring(today: IsoDate): IsoDate {
  const { y } = parseIso(today);
  const april = toIso({ y, m: 4, d: 1 });
  return today < april ? april : toIso({ y: y + 1, m: 4, d: 1 });
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 p-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-subtle">{title}</h3>
      {children}
    </section>
  );
}

/**
 * The project page's Schedule card (schedule.read). Bookings, the customer
 * start-date workflow, readiness and scheduling preferences. Editing needs
 * schedule.write; hours are shown only to schedule.write users. No money here.
 */
export async function ProjectScheduleCard({ projectId, user }: { projectId: string; user: { role: string } }) {
  const [dto, crews, settings, hoursPerCrewDay] = await Promise.all([
    getProjectSchedule(projectId),
    listCrews({ includeInactive: true }),
    getScheduleSettings(),
    getHoursPerCrewDay(),
  ]);
  if (!dto) return null;

  const canEdit = can(user.role, "schedule.write");
  const canNotify = canEdit && can(user.role, "messages.send");
  const today = todayIso();
  const { entries, scheduling, readinessSummary: ready } = dto;
  const crewById = new Map(crews.map((c) => [c.id, c]));

  const from = entries.reduce((m, e) => (e.startDate < m ? e.startDate : m), today);
  const to = entries.reduce((m, e) => (e.endDate > m ? e.endDate : m), today);
  const { calFor } = calendarsFor(settings, from, to);
  const rows = entries.map((e) => ({ ...e, workingDays: countWorkingDays(e.startDate, e.endDate, calFor(e.crewId ? crewById.get(e.crewId) : null)) }));
  const showPhase = rows.some((e) => e.phaseLabel);

  const kinds = allowedKinds(dto.projectStatus).map((k) => ({ value: k, label: KIND_LABEL[k] }));
  const left = remainingHours(dto.hours.estimated, dto.hours.scheduled);
  const activeCrews = crews
    .filter((c) => c.active)
    .map((c) => ({ id: c.id, name: c.name, worksSaturdays: c.worksSaturdays, suggestedDays: suggestedWorkingDays(left, c) }));
  const base = scheduling.notBefore && scheduling.notBefore > addDays(today, 1) ? scheduling.notBefore : addDays(today, 1);
  const defaultStart = nextWorkingDay(base, calendarsFor(settings, base, addDays(base, 90)).calFor(null));

  const first = dto.firstWorkDay;
  const calendarHref = `/schedule?from=${mondayOf(first ?? today)}`;
  const canStart = canEdit && can(user.role, "projects.write") && dto.projectStatus === "scheduled" && !!first && first <= today;

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Schedule"
        description={first && dto.lastWorkDay ? `Work booked ${dateRangeLabel(first, dto.lastWorkDay)}` : rows.length ? "No painting booked yet" : "Not on the calendar yet"}
        action={
          <LinkButton href={calendarHref} size="sm" variant="secondary">
            <CalendarDays className="size-4" aria-hidden /> Open calendar
          </LinkButton>
        }
      />
      <div className="grid lg:grid-cols-5">
        <div className="space-y-4 p-4 lg:col-span-3">
          {rows.length ? (
            <Table aria-label="Bookings">
              <thead>
                <tr>
                  <th className={th}>Booking</th>
                  <th className={th}>Crew</th>
                  <th className={th}>Dates</th>
                  <th className={th}>Working days</th>
                  {showPhase && <th className={th}>Phase</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className={td}>{KIND_LABEL[e.kind]}</td>
                    <td className={td}>
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <span className={cn("size-2.5 shrink-0 rounded-full", crewColorClasses(e.crewId ? crewById.get(e.crewId)?.color : null).dot)} aria-hidden />
                        {e.crewName ?? "No crew yet"}
                      </span>
                    </td>
                    <td className={cn(td, "whitespace-nowrap")}>
                      <Link href={`/schedule?from=${mondayOf(e.startDate)}&focus=${e.id}`} className="text-brand hover:underline" title="Open on the calendar">
                        {dateRangeLabel(e.startDate, e.endDate)}
                      </Link>
                    </td>
                    <td className={cn(td, "tabular-nums")}>{e.workingDays}</td>
                    {showPhase && <td className={td}>{e.phaseLabel ?? ""}</td>}
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-sm text-muted">Nothing booked yet.</p>
          )}

          {canEdit && (
            <p className="text-sm text-muted" data-testid="scheduled-hours">
              Scheduled {formatNum(dto.hours.scheduled, 1)} h{Number(dto.hours.estimated) > 0 && <> of {formatNum(dto.hours.estimated, 1)} h estimated</>}
            </p>
          )}
          {canStart && (
            <div className="space-y-2 rounded-md bg-info-soft p-3 text-sm">
              <p>The first work day has come. Mark the job in progress when the crew has started.</p>
              <MarkInProgressButton projectId={dto.projectId} />
            </div>
          )}
          {canEdit && dto.projectStatus === "cancelled" && rows.length > 0 && (
            <div className="space-y-2 text-sm">
              <p className="text-muted">This job is cancelled, so it no longer shows on the calendar.</p>
              <RemoveAllBookingsButton projectId={dto.projectId} count={rows.length} />
            </div>
          )}
          {canEdit && (
            <ScheduleBookingForm
              projectId={dto.projectId}
              onHold={dto.projectStatus === "on_hold"}
              kinds={kinds}
              crews={activeCrews}
              unassignedDays={suggestedWorkingDays(left, defaultCapacity(settings, hoursPerCrewDay))}
              calendar={{ workDays: settings.workDays, holidayRegion: settings.holidayRegion, extraClosedDays: settings.extraClosedDays }}
              defaultStart={defaultStart}
              hasBookings={rows.length > 0}
            />
          )}
        </div>

        <div className="divide-y divide-border border-t border-border lg:col-span-2 lg:border-t-0 lg:border-l">
          <Section title="Customer start date">
            <ScheduleCustomerBlock
              projectId={dto.projectId}
              confirmation={scheduling.confirmation}
              communicatedStart={scheduling.communicatedStart}
              firstWorkDay={first}
              history={confirmationHistory(scheduling)}
              canNotify={canNotify}
            />
          </Section>
          <Section title="Ready to schedule?">
            <p className="text-sm">
              <span className="font-medium">Ready {ready.ready} of {ready.total}</span>
              {ready.missing.length > 0 && <span className="text-muted"> · Waiting on {ready.missing.join(", ")}</span>}
            </p>
            <ReadinessChecklist projectId={dto.projectId} items={dto.readiness} canEdit={canEdit} />
          </Section>
          <Section title="Scheduling preferences">
            <SchedulingPrefsForm
              projectId={dto.projectId}
              version={scheduling.version}
              notBefore={scheduling.notBefore}
              schedulingNotes={scheduling.schedulingNotes}
              nextSpring={nextSpring(today)}
              canEdit={canEdit}
            />
          </Section>
        </div>
      </div>
    </Card>
  );
}
