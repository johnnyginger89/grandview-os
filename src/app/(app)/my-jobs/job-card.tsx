import { ClipboardList, KeyRound, MapPin, MessageSquareText, Palette, Phone } from "lucide-react";
import Link from "next/link";
import { Badge, buttonClass, Card } from "@/components/ui";
import { dateRangeLabel, workingDaysLabel } from "@/lib/schedule/format";
import type { FieldJobView } from "@/lib/schedule/types";

/*
 * One booking on /my-jobs, built only from FieldJobView (a whitelist with no
 * prices, no hours and no internal notes). Phone-first: big tap targets, text wraps.
 */

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function Note({ icon: Icon, title, children }: { icon: typeof KeyRound; title: string; children: string }) {
  return (
    <div className="rounded-md bg-surface-2 px-3 py-2 text-sm">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
        <Icon className="size-3.5" aria-hidden /> {title}
      </p>
      <p className="mt-1 whitespace-pre-wrap break-words">{children}</p>
    </div>
  );
}

export function JobCard({ job, workOrderHref }: { job: FieldJobView; workOrderHref?: string | null }) {
  const headingId = `job-${job.entryId}`;
  return (
    <Card className="overflow-hidden">
      <article aria-labelledby={headingId} className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-sm font-medium">
            {dateRangeLabel(job.startDate, job.endDate)} · {workingDaysLabel(job.workingDays)}
          </p>
          {job.dayNumber !== null && <Badge tone="brand">Day {job.dayNumber} of {job.workingDays}</Badge>}
        </div>

        <div>
          <h3 id={headingId} className="text-base font-semibold break-words">
            #{job.projectNumber} · {job.jobTitle}
          </h3>
          <p className="text-sm break-words">{job.customerName}</p>
          <p className="mt-0.5 text-sm text-muted">
            {job.kindLabel}
            {job.phaseLabel ? ` · ${job.phaseLabel}` : ""} · {job.crewName}
          </p>
        </div>

        {(job.tentative || job.projectTypes.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {job.tentative && <Badge tone="warning" className="rounded-md">Tentative – not yet confirmed with the customer</Badge>}
            {job.projectTypes.map((t) => <Badge key={t}>{t}</Badge>)}
          </div>
        )}

        {job.address && (
          <div className="space-y-2">
            <p className="flex items-start gap-1.5 text-sm break-words">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
              <span>{job.address}</span>
            </p>
            {job.mapsUrl && (
              <a href={job.mapsUrl} target="_blank" rel="noreferrer" className={buttonClass("secondary", "md", "w-full sm:w-auto")}>
                <MapPin className="size-4" aria-hidden /> Open in Maps
              </a>
            )}
          </div>
        )}

        {job.accessNotes && <Note icon={KeyRound} title="Access">{job.accessNotes}</Note>}
        {job.crewNotes && <Note icon={MessageSquareText} title="Notes from the office">{job.crewNotes}</Note>}

        {job.contact && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-sm">
              <span className="text-muted">Customer contact:</span> {job.contact.name}
            </p>
            <a href={telHref(job.contact.phone)} className={buttonClass("primary", "md", "w-full sm:w-auto")}>
              <Phone className="size-4" aria-hidden /> Call {job.contact.name}
            </a>
          </div>
        )}

        {job.kind === "colour_consult" && (
          <Link href={`/my-jobs/colours/${job.entryId}`} className={buttonClass("primary", "md", "w-full sm:w-auto")}>
            <Palette className="size-4" aria-hidden /> Colour form
          </Link>
        )}

        {workOrderHref && (
          <Link href={workOrderHref} className={buttonClass("secondary", "md", "w-full sm:w-auto")}>
            <ClipboardList className="size-4" aria-hidden /> Work order
          </Link>
        )}
      </article>
    </Card>
  );
}
