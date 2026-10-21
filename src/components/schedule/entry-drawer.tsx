"use client";
import { AlertTriangle, ExternalLink, Plus, Scissors, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from "@/app/(app)/projects/status";
import { Dialog } from "@/components/dialog";
import { Badge, Button, Field, FormError, Input, LinkButton } from "@/components/ui";
import { addDays, type IsoDate } from "@/lib/calendar-date";
import { isTentative } from "@/lib/schedule/confirmation";
import { remainingHours } from "@/lib/schedule/duration";
import { dateRangeLabel, kindLabel, shortDay, workingDaysLabel } from "@/lib/schedule/format";
import { allowedKinds } from "@/lib/schedule/status-plan";
import type { CrewDTO, EntryDTO, ProjectScheduleDTO, ScheduleWarning } from "@/lib/schedule/types";
import { countWorkingDays, type WorkCalendar } from "@/lib/schedule/working-days";
import { CustomerConfirmation } from "./confirmation-chip";
import { EntryForm, type EntryFormValues } from "./entry-form";
import { ReadinessChecklist } from "./readiness-checklist";
import { dayAfter, warningText } from "./schedule-text";

/** What the page loads for the open booking (`?focus=`). Hours are null for read-only users. */
export interface EntryDetails {
  entryId: string;
  project: Omit<ProjectScheduleDTO, "hours"> & { hours: ProjectScheduleDTO["hours"] | null };
  warnings: ScheduleWarning[];
}

export interface EntryDrawerPerms {
  canEdit: boolean;
  canNotify: boolean;
  canOpenProject: boolean;
  canMarkInProgress: boolean;
}

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="border-t border-border pt-4 first:border-t-0 first:pt-0" data-testid={testId}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">{title}</h3>
      {children}
    </section>
  );
}

/**
 * The booking drawer: a native <dialog> on the right on desktop and a full-screen
 * sheet on phones. Editing goes through the board's callbacks so every change gets
 * the same optimistic update, version chaining and Undo toast as a drag.
 */
export function EntryDrawer({
  open,
  onClose,
  entry,
  details,
  ...rest
}: Omit<DrawerBodyProps, "entry"> & {
  open: boolean;
  onClose: () => void;
  entry: EntryDTO | null;
}) {
  const title = entry ? `#${entry.projectNumber} · ${entry.customerName} – ${entry.jobTitle}` : "Booking";
  return (
    <Dialog
      open={open && !!entry}
      onClose={onClose}
      title={title}
      className="m-0 h-dvh max-h-dvh w-screen max-w-none rounded-none border-0 md:ml-auto md:w-[34rem] md:border-l"
      footer={<Button variant="secondary" onClick={onClose}>Done</Button>}
    >
      {entry && <DrawerBody key={entry.id} entry={entry} details={details && details.entryId === entry.id ? details : null} {...rest} />}
    </Dialog>
  );
}

function DrawerBody(props: DrawerBodyProps) {
  // A booking that is still being saved has no id on the server yet.
  if (props.entry.version === 0) return <p className="text-sm text-muted">Saving this booking…</p>;
  return <SavedDrawerBody {...props} />;
}

interface DrawerBodyProps {
  entry: EntryDTO;
  crews: readonly CrewDTO[];
  /** Null while loading (or for another booking). */
  details: EntryDetails | null;
  calendarFor: (crewId: string | null) => WorkCalendar;
  /** Suggested working days for more work on this project with a crew. */
  suggestDays: (crewId: string | null, remainingHours: string | null) => number;
  today: IsoDate;
  perms: EntryDrawerPerms;
  pending: boolean;
  onSave: (entry: EntryDTO, values: EntryFormValues) => void;
  onSplit: (entry: EntryDTO, firstPartEnd: IsoDate) => void;
  onDelete: (entry: EntryDTO) => void;
  onAddPhase: (entry: EntryDTO, values: EntryFormValues) => void;
  onOpenEntry: (entry: EntryDTO) => void;
  onMarkInProgress: (projectId: string) => void;
  onMessage: (message: string) => void;
}

function SavedDrawerBody({
  entry,
  crews,
  details,
  calendarFor,
  suggestDays,
  today,
  perms,
  pending,
  onSave,
  onSplit,
  onDelete,
  onAddPhase,
  onOpenEntry,
  onMarkInProgress,
  onMessage,
}: DrawerBodyProps) {
  const [splitting, setSplitting] = useState(false);
  const [splitDay, setSplitDay] = useState(entry.startDate);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [addingPhase, setAddingPhase] = useState(false);

  const cal = calendarFor(entry.crewId);
  const workingDays = countWorkingDays(entry.startDate, entry.endDate, cal);
  const project = details?.project ?? null;
  const others = project ? project.entries.filter((e) => e.id !== entry.id) : [];
  const firstWorkDay = project?.firstWorkDay ?? null;
  const lastWorkDay = project?.lastWorkDay ?? null;
  const status = project?.projectStatus ?? entry.projectStatus;
  const kinds = allowedKinds(status);
  const tentative = isTentative(entry.kind, entry.confirmation);
  const canSplit = perms.canEdit && entry.endDate > entry.startDate;
  const started = !!firstWorkDay && firstWorkDay <= today;
  const remaining = project?.hours ? remainingHours(project.hours.estimated, project.hours.scheduled).toFixed(2) : null;

  function split() {
    if (splitDay < entry.startDate || splitDay >= entry.endDate) {
      setSplitError("Pick a day from the first day up to the day before the last.");
      return;
    }
    setSplitError(null);
    setSplitting(false);
    onSplit(entry, splitDay);
  }

  function remove() {
    if (!window.confirm(`Remove #${entry.projectNumber} (${dateRangeLabel(entry.startDate, entry.endDate)}) from the schedule?`)) return;
    onDelete(entry);
  }

  return (
    <div className="space-y-5" data-testid="entry-drawer" data-entry-id={entry.id}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={PROJECT_STATUS_TONE[status]} data-testid="project-status">{PROJECT_STATUS_LABEL[status]}</Badge>
        <Badge>{kindLabel(entry.kind)}</Badge>
        {entry.kind === "work" && <Badge tone={tentative ? "warning" : "success"}>{tentative ? "Tentative" : "Confirmed"}</Badge>}
        {perms.canOpenProject && (
          <LinkButton href={`/projects/${entry.projectId}`} variant="ghost" size="sm" className="ml-auto">
            <ExternalLink className="size-4" aria-hidden /> Open project
          </LinkButton>
        )}
      </div>

      {details && details.warnings.length > 0 && (
        <ul className="space-y-1.5 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning" data-testid="entry-warnings" aria-label="Warnings">
          {details.warnings.map((w, i) => (
            <li key={i} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{warningText(w)}</span>
            </li>
          ))}
        </ul>
      )}

      {perms.canMarkInProgress && status === "scheduled" && started && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-info-soft px-3 py-2 text-sm text-info">
          <span>Work has started on the calendar.</span>
          <Button size="sm" onClick={() => onMarkInProgress(entry.projectId)} disabled={pending}>Mark in progress</Button>
        </div>
      )}

      <Section title="Booking" testId="drawer-booking">
        {perms.canEdit ? (
          <EntryForm
            key={`${entry.id}:${entry.version}`}
            mode="edit"
            crews={crews}
            initial={{
              crewId: entry.crewId,
              kind: entry.kind,
              startDate: entry.startDate,
              endDate: entry.endDate,
              phaseLabel: entry.phaseLabel,
              crewNotes: entry.crewNotes,
              notes: entry.notes,
            }}
            kinds={kinds}
            calendarFor={calendarFor}
            submitLabel="Save"
            pending={pending}
            onSubmit={(values) => onSave(entry, values)}
            extraActions={
              <>
                {canSplit && (
                  <Button variant="secondary" onClick={() => { setSplitting((s) => !s); setSplitDay(entry.startDate); }} aria-expanded={splitting} disabled={pending}>
                    <Scissors className="size-4" aria-hidden /> Split…
                  </Button>
                )}
                <Button variant="ghost" className="text-danger hover:text-danger" onClick={remove} disabled={pending}>
                  <Trash2 className="size-4" aria-hidden /> Remove from schedule
                </Button>
              </>
            }
          />
        ) : (
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted">Crew</dt>
            <dd>{entry.crewName ?? "Unassigned"}</dd>
            <dt className="text-muted">Dates</dt>
            <dd>{dateRangeLabel(entry.startDate, entry.endDate)}</dd>
            <dt className="text-muted">Working days</dt>
            <dd>{workingDays}</dd>
            {entry.phaseLabel && (
              <>
                <dt className="text-muted">Phase</dt>
                <dd>{entry.phaseLabel}</dd>
              </>
            )}
            {entry.crewNotes && (
              <>
                <dt className="text-muted">Crew notes</dt>
                <dd className="whitespace-pre-wrap">{entry.crewNotes}</dd>
              </>
            )}
            {entry.notes && (
              <>
                <dt className="text-muted">Office notes</dt>
                <dd className="whitespace-pre-wrap">{entry.notes}</dd>
              </>
            )}
          </dl>
        )}

        {splitting && (
          <div className="mt-3 space-y-2 rounded-md border border-border bg-surface-2 p-3">
            <p className="text-sm">Split this booking in two, for example around a rain day. The second part starts on the next work day.</p>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Last day of the first part">
                <Input type="date" value={splitDay} min={entry.startDate} max={addDays(entry.endDate, -1)} onChange={(e) => setSplitDay(e.target.value)} className="w-44" />
              </Field>
              <Button onClick={split} disabled={pending}>Split booking</Button>
              <Button variant="ghost" onClick={() => setSplitting(false)}>Cancel</Button>
            </div>
            <FormError message={splitError} />
          </div>
        )}
      </Section>

      <Section title="Other bookings for this job" testId="drawer-other-bookings">
        {!project ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <>
            {others.length ? (
              <ul className="divide-y divide-border rounded-md border border-border text-sm">
                {others.map((o) => (
                  <li key={o.id}>
                    <button type="button" className="flex w-full flex-wrap items-center gap-x-2 px-3 py-2 text-left hover:bg-surface-2" onClick={() => onOpenEntry(o)}>
                      <span className="font-medium">{kindLabel(o.kind)}{o.phaseLabel ? ` · ${o.phaseLabel}` : ""}</span>
                      <span className="text-muted">{dateRangeLabel(o.startDate, o.endDate)}</span>
                      <span className="text-muted">· {o.crewName ?? "Unassigned"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No other bookings.</p>
            )}
            {project.hours && (
              <p className="mt-2 text-sm text-muted" data-testid="drawer-hours">
                Scheduled {Number(project.hours.scheduled)} h{Number(project.hours.estimated) > 0 && <> of {Number(project.hours.estimated)} h estimated</>}
              </p>
            )}
            {perms.canEdit && kinds.length > 0 && !addingPhase && (
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => setAddingPhase(true)} disabled={pending}>
                <Plus className="size-4" aria-hidden /> Add phase
              </Button>
            )}
            {perms.canEdit && addingPhase && (
              <div className="mt-3 rounded-md border border-border p-3">
                <h4 className="mb-2 text-sm font-semibold">New booking for #{entry.projectNumber}</h4>
                <EntryForm
                  mode="create"
                  crews={crews}
                  initial={{
                    crewId: entry.crewId,
                    kind: kinds.includes("work") ? "work" : kinds[0],
                    startDate: dayAfter(lastWorkDay ?? entry.endDate),
                  }}
                  kinds={kinds}
                  calendarFor={calendarFor}
                  suggestDays={(crewId) => suggestDays(crewId, remaining)}
                  submitLabel="Add booking"
                  pending={pending}
                  onSubmit={(values) => {
                    setAddingPhase(false);
                    onAddPhase(entry, values);
                  }}
                  onCancel={() => setAddingPhase(false)}
                />
              </div>
            )}
          </>
        )}
      </Section>

      <Section title="Ready to schedule?" testId="drawer-readiness">
        {project ? <ReadinessChecklist projectId={entry.projectId} items={project.readiness} canEdit={perms.canEdit} onSaved={onMessage} /> : <p className="text-sm text-muted">Loading…</p>}
      </Section>

      <Section title="Customer" testId="drawer-customer">
        {project ? (
          <CustomerConfirmation
            projectId={entry.projectId}
            confirmation={project.scheduling.confirmation}
            communicatedStart={project.scheduling.communicatedStart}
            currentStart={firstWorkDay}
            canNotify={perms.canNotify}
            onDone={onMessage}
          />
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
        {project?.scheduling.notBefore && <p className="mt-2 text-sm text-muted">Not before {shortDay(project.scheduling.notBefore)}</p>}
        {project?.scheduling.schedulingNotes && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{project.scheduling.schedulingNotes}</p>}
      </Section>

      {!perms.canEdit && <p className="text-xs text-muted">{workingDaysLabel(workingDays)}. You can view the schedule but not change it.</p>}
    </div>
  );
}
