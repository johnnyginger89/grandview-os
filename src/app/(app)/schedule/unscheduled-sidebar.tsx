"use client";
import { ChevronDown, GripVertical } from "lucide-react";
import { useState, type PointerEvent } from "react";
import { Badge, Button } from "@/components/ui";
import { businessDate, diffDays, type IsoDate } from "@/lib/calendar-date";
import type { CrewCapacity } from "@/lib/schedule/duration";
import { shortDay } from "@/lib/schedule/format";
import type { UnscheduledJobDTO } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";
import { jobTypeTag, matchesSearch, suggestDays } from "./board-model";

const GROUPS: { key: UnscheduledJobDTO["group"]; title: string; hint: string }[] = [
  { key: "need_to_schedule", title: "Need to schedule", hint: "Signed jobs with no work booked yet, oldest sale first." },
  { key: "partly_scheduled", title: "Partly scheduled", hint: "Booked, but with a day or more of estimated hours left." },
  { key: "on_hold", title: "On hold / next season", hint: "On hold, earliest “not before” date first." },
];

/** Hours as written ("42" / "7.5") for display only. */
const hoursText = (h: string) => String(Number(h));

function JobCard({
  job,
  today,
  fallback,
  canEdit,
  showHours,
  draggable,
  dragging,
  onSchedule,
  onDragStart,
}: {
  job: UnscheduledJobDTO;
  today: IsoDate;
  fallback: CrewCapacity;
  canEdit: boolean;
  showHours: boolean;
  draggable: boolean;
  dragging: boolean;
  onSchedule: (job: UnscheduledJobDTO) => void;
  onDragStart: (e: PointerEvent<HTMLElement>, job: UnscheduledJobDTO) => void;
}) {
  const sold = businessDate(job.soldAt);
  const age = diffDays(sold, today);
  const days = suggestDays(job, null, fallback);
  const tag = jobTypeTag(job.jobType);
  const r = job.readiness;
  return (
    <li
      data-testid="unscheduled-job"
      data-project-number={job.number}
      className={cn("rounded-md border border-border bg-surface p-2.5 text-sm shadow-xs", draggable && "md:cursor-grab md:select-none", dragging && "opacity-50")}
      onPointerDown={(e) => {
        // Mouse: drag from anywhere on the card except its buttons. Touch: the grip only.
        if (!draggable || e.pointerType === "touch" || (e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
        onDragStart(e, job);
      }}
    >
      <div className="flex gap-2">
        {draggable && (
          <span
            role="img"
            aria-label={`Drag #${job.number} onto the calendar`}
            title="Drag onto a crew and day"
            className="-ml-1 flex w-5 shrink-0 cursor-grab touch-none items-start justify-center pt-0.5 text-muted select-none hover:text-text"
            onPointerDown={(e) => {
              e.stopPropagation();
              onDragStart(e, job);
            }}
          >
            <GripVertical className="size-4" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold">#{job.number}</span>
            {tag && <Badge className="px-1.5 py-0 text-[11px]">{tag}</Badge>}
            {job.status === "on_hold" && <Badge tone="neutral" className="px-1.5 py-0 text-[11px]">On hold</Badge>}
          </div>
          <p className="truncate font-medium" title={job.customerName}>{job.customerName}</p>
          <p className="truncate text-xs text-muted">{[job.jobTitle, job.city].filter(Boolean).join(" · ")}</p>
          <p className="text-xs text-muted">
            Sold {shortDay(sold)} · {age <= 0 ? "today" : `${age} day${age === 1 ? "" : "s"} ago`}
          </p>
          <p className="text-xs">
            {showHours ? `${hoursText(job.remainingHours)} h${job.group === "partly_scheduled" ? " left" : ""} ` : ""}→ {days} day{days === 1 ? "" : "s"}
            <span className="text-muted"> with a {fallback.crewSize}-person crew</span>
          </p>
          {r.total > 0 && (
            <p className={cn("text-xs", r.ready === r.total ? "text-success" : "text-warning")}>
              Ready {r.ready}/{r.total}
              {r.missing.length > 0 && <span className="text-muted"> · missing: {r.missing.join(", ")}</span>}
            </p>
          )}
          {job.notBefore && <p className="text-xs text-muted">Not before {shortDay(job.notBefore)}</p>}
          {canEdit && (
            <div className="pt-1.5">
              <Button size="sm" variant="secondary" onClick={() => onSchedule(job)}>
                Schedule…
              </Button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Signed jobs waiting for dates. Drag a card onto a crew and day (desktop and
 * tablet), or use "Schedule…" (every screen, and the keyboard path).
 */
export function UnscheduledSidebar({
  jobs,
  search,
  today,
  fallback,
  canEdit,
  draggable,
  draggingProjectId,
  onSchedule,
  onDragStart,
}: {
  jobs: UnscheduledJobDTO[];
  search: string;
  today: IsoDate;
  fallback: CrewCapacity;
  canEdit: boolean;
  draggable: boolean;
  draggingProjectId: string | null;
  onSchedule: (job: UnscheduledJobDTO) => void;
  onDragStart: (e: PointerEvent<HTMLElement>, job: UnscheduledJobDTO) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({ need_to_schedule: true });
  const shown = search.trim() ? jobs.filter((j) => matchesSearch(search, { number: j.number, customerName: j.customerName, city: j.city, jobTitle: j.jobTitle })) : jobs;

  return (
    <div className="space-y-3" data-testid="unscheduled-sidebar">
      {GROUPS.map((g) => {
        const list = shown.filter((j) => j.group === g.key);
        const isOpen = !!open[g.key] || (!!search.trim() && list.length > 0);
        if (g.key !== "need_to_schedule" && !list.length) return null;
        const id = `sched-group-${g.key}`;
        return (
          <section key={g.key} aria-labelledby={`${id}-h`}>
            <h3 id={`${id}-h`}>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={id}
                onClick={() => setOpen((o) => ({ ...o, [g.key]: !isOpen }))}
                className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs font-semibold uppercase tracking-wide text-muted hover:text-text"
              >
                <span className="flex-1">
                  {g.title} <span className="tabular">({list.length})</span>
                </span>
                <ChevronDown className={cn("size-4 transition-transform", !isOpen && "-rotate-90")} aria-hidden />
              </button>
            </h3>
            {isOpen && (
              <div id={id}>
                <p className="mb-2 px-1 text-xs text-muted">{g.hint}</p>
                {list.length ? (
                  <ul className="space-y-2">
                    {list.map((job) => (
                      <JobCard
                        key={job.projectId}
                        job={job}
                        today={today}
                        fallback={fallback}
                        canEdit={canEdit}
                        showHours={canEdit}
                        draggable={draggable}
                        dragging={draggingProjectId === job.projectId}
                        onSchedule={onSchedule}
                        onDragStart={onDragStart}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-md border border-dashed border-border-strong px-3 py-4 text-center text-xs text-muted">
                    {search.trim() ? "No jobs match your search." : "Every signed job is on the schedule."}
                  </p>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
