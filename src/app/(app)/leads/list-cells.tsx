"use client";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Badge, type Tone } from "@/components/ui";
import { diffDays } from "@/lib/calendar-date";
import { formatCAD } from "@/lib/money";
import {
  businessDate,
  channelName,
  daysInStage,
  isFollowUpDue,
  isStale,
  mailtoHref,
  propertyTypeName,
  rowValue,
  telHref,
  type ColumnKey,
  type PipelineRow,
  type StageInfo,
} from "@/lib/pipeline/list-view";
import { stageTone } from "@/lib/pipeline/stage-colors";
import { cn, formatAddress, formatDate, mapsUrl } from "@/lib/utils";

export interface Person {
  id: string;
  name: string;
}

/** What every cell needs: shared data plus the edit handlers (absent for read-only roles). */
export interface CellContext {
  now: Date;
  stages: StageInfo[];
  stagesById: Map<string, StageInfo>;
  estimators: Person[];
  canEdit: boolean;
  onStage: (row: PipelineRow, stageId: string) => void;
  onFollowUp: (row: PipelineRow) => void;
  onEstimator: (row: PipelineRow, estimatorId: string | null) => void;
}

const Empty = () => <span className="text-subtle">—</span>;

export function formatShortDate(iso: string, now: Date): string {
  const sameYear = businessDate(iso).slice(0, 4) === businessDate(now).slice(0, 4);
  return formatDate(iso, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

export function formatVisit(iso: string): string {
  return formatDate(iso, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "Today", "Yesterday", "3d ago", then a date. Counted in Vancouver calendar days. */
export function relativeLabel(iso: string, now: Date): string {
  const days = diffDays(businessDate(iso), businessDate(now));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return formatShortDate(iso, now);
}

export function StagePill({ row, ctx, idPrefix, className }: { row: PipelineRow; ctx: CellContext; idPrefix: string; className?: string }) {
  const stage = ctx.stagesById.get(row.stageId);
  const tone = stageTone(stage?.color ?? "slate");
  const base = "rounded-full text-xs font-medium ring-1 ring-inset";
  if (!ctx.canEdit) return <span className={cn(base, "inline-flex px-2.5 py-1", tone.pill, className)}>{stage?.name ?? "—"}</span>;
  return (
    <span className="relative inline-flex max-w-full">
      <select
        id={`${idPrefix}-${row.id}`}
        aria-label={`Stage for ${row.customerName}`}
        data-testid="stage-select"
        value={row.stageId}
        onChange={(e) => ctx.onStage(row, e.target.value)}
        className={cn(base, "h-7 max-w-full cursor-pointer appearance-none truncate py-0 pl-2.5 pr-7 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring", tone.pill, className)}
      >
        {ctx.stages.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2" aria-hidden />
    </span>
  );
}

export function FollowUpCell({ row, ctx }: { row: PipelineRow; ctx: CellContext }) {
  const due = isFollowUpDue(row, ctx.now);
  const label = row.nextFollowUpAt ? formatShortDate(row.nextFollowUpAt, ctx.now) : null;
  const text = (
    <>
      {label ?? (ctx.canEdit ? "Set…" : "—")}
      {due && <span className="font-medium"> · due</span>}
    </>
  );
  if (!ctx.canEdit) return <span className={cn(due ? "text-warning" : !label && "text-subtle")}>{text}</span>;
  return (
    <button
      type="button"
      data-testid="follow-up-button"
      onClick={() => ctx.onFollowUp(row)}
      className={cn(
        "-mx-1.5 rounded px-1.5 py-0.5 text-left hover:bg-surface-2 hover:underline",
        due ? "text-warning" : label ? "text-text" : "text-brand",
      )}
    >
      {text}
      <span className="sr-only"> follow-up for {row.customerName}</span>
    </button>
  );
}

export function EstimatorCell({ row, ctx }: { row: PipelineRow; ctx: CellContext }) {
  if (!ctx.canEdit) return row.estimatorName ? <span>{row.estimatorName}</span> : <Empty />;
  const known = !row.estimatorId || ctx.estimators.some((e) => e.id === row.estimatorId);
  return (
    <select
      aria-label={`Estimator for ${row.customerName}`}
      value={row.estimatorId ?? ""}
      onChange={(e) => ctx.onEstimator(row, e.target.value || null)}
      className="h-8 max-w-full cursor-pointer rounded-md border border-transparent bg-transparent pr-6 pl-1 text-sm hover:border-border-strong focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
    >
      <option value="">Unassigned</option>
      {!known && <option value={row.estimatorId!}>{row.estimatorName ?? "Former team member"}</option>}
      {ctx.estimators.map((e) => (
        <option key={e.id} value={e.id}>{e.name}</option>
      ))}
    </select>
  );
}

export function ValueCell({ row }: { row: PipelineRow }) {
  const v = rowValue(row);
  if (!v) return <Empty />;
  return (
    <span className="tabular" title={v.source === "estimated" ? "Estimated value, before GST" : "Estimate total, before GST"}>
      {formatCAD(v.amount)}
      {v.source === "estimated" && <span className="ml-1 text-[10px] text-subtle">est.</span>}
    </span>
  );
}

export function PhoneLink({ phone, className }: { phone: string | null; className?: string }) {
  if (!phone) return <Empty />;
  const href = telHref(phone);
  return href ? <a href={href} className={cn("text-brand hover:underline", className)}>{phone}</a> : <span>{phone}</span>;
}

export function EmailLink({ email, className }: { email: string | null; className?: string }) {
  if (!email) return <Empty />;
  const href = mailtoHref(email);
  return href ? <a href={href} className={cn("text-brand hover:underline", className)}>{email}</a> : <span>{email}</span>;
}

export function ProjectTypeBadges({ types }: { types: string[] }) {
  if (!types.length) return <Empty />;
  return (
    <span className="flex items-center gap-1">
      {types.slice(0, 2).map((t) => (
        <Badge key={t}>{t}</Badge>
      ))}
      {types.length > 2 && <span className="text-xs text-subtle" title={types.slice(2).join(", ")}>+{types.length - 2}</span>}
    </span>
  );
}

const ESTIMATE_TONES: Record<string, Tone> = { draft: "neutral", sent: "info", accepted: "success", declined: "danger", expired: "warning" };
const ESTIMATE_LABELS: Record<string, string> = { draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined", expired: "Expired" };

export function LeadName({ row, ctx }: { row: PipelineRow; ctx: CellContext }) {
  const stale = isStale(row, ctx.stagesById.get(row.stageId), ctx.now);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {!row.firstViewedAt && row.stageKey === "new_lead" && (
        <span className="size-2 shrink-0 rounded-full bg-amber-500" title="Not opened yet">
          <span className="sr-only">Not opened yet</span>
        </span>
      )}
      <Link href={`/leads/${row.id}`} className="truncate font-medium text-text hover:text-brand hover:underline">
        {row.customerName}
      </Link>
      {row.number != null && <span className="shrink-0 text-xs text-subtle">#{row.number}</span>}
      {stale && <Badge tone="danger" className="shrink-0">stale</Badge>}
    </span>
  );
}

/** One table cell's content for a column. */
export function CellContent({ col, row, ctx }: { col: ColumnKey; row: PipelineRow; ctx: CellContext }) {
  switch (col) {
    case "name":
      return <LeadName row={row} ctx={ctx} />;
    case "estimator":
      return <EstimatorCell row={row} ctx={ctx} />;
    case "stage":
      return <StagePill row={row} ctx={ctx} idPrefix="stage-t" />;
    case "daysInStage": {
      if (row.stageKind !== "open") return <span className="text-muted">{formatShortDate(row.closedAt ?? row.stageChangedAt, ctx.now)}</span>;
      const stale = isStale(row, ctx.stagesById.get(row.stageId), ctx.now);
      return <span className={cn("tabular", stale && "font-medium text-danger")}>{daysInStage(row, ctx.now)}d</span>;
    }
    case "followUp":
      return <FollowUpCell row={row} ctx={ctx} />;
    case "visit":
      return row.estimateVisitAt ? (
        <span className={cn(Date.parse(row.estimateVisitAt) < ctx.now.getTime() && "text-muted")}>{formatVisit(row.estimateVisitAt)}</span>
      ) : (
        <Empty />
      );
    case "projectTypes":
      return <ProjectTypeBadges types={row.projectTypes} />;
    case "value":
      return <ValueCell row={row} />;
    case "closed":
      return row.closedAt ? <span>{formatShortDate(row.closedAt, ctx.now)}</span> : <Empty />;
    case "city":
      return row.city ? <span>{row.city}</span> : <Empty />;
    case "address": {
      if (!row.street) return <Empty />;
      const address = formatAddress({ street: row.street, unit: row.unit, city: row.city });
      return <a href={mapsUrl(address)} target="_blank" rel="noreferrer" className="text-brand hover:underline">{address}</a>;
    }
    case "source":
      return row.source ? <span>{row.source}</span> : <Empty />;
    case "created":
      return <span>{formatShortDate(row.createdAt, ctx.now)}</span>;
    case "email":
      return <EmailLink email={row.email} />;
    case "phone":
      return <PhoneLink phone={row.phone} />;
    case "channel":
      return row.channel ? <span>{channelName(row.channel)}</span> : <Empty />;
    case "lastActivity":
      return row.lastActivityAt ? <span title={formatDate(row.lastActivityAt, { dateStyle: "medium", timeStyle: "short" })}>{relativeLabel(row.lastActivityAt, ctx.now)}</span> : <Empty />;
    case "lastContacted":
      return row.lastContactedAt ? <span>{formatShortDate(row.lastContactedAt, ctx.now)}</span> : <Empty />;
    case "lostReason":
      return row.lostReason ? <span>{row.lostReason}</span> : <Empty />;
    case "timeline":
      return row.timeline ? <span>{row.timeline}</span> : <Empty />;
    case "propertyType":
      return row.propertyType ? <span>{propertyTypeName(row.propertyType)}</span> : <Empty />;
    case "contact":
      return row.contactName ? <span>{row.contactName}</span> : <Empty />;
    case "estimateStatus":
      return row.estimateId && row.estimateStatus ? (
        <Link href={`/estimates/${row.estimateId}`} className="hover:underline">
          <Badge tone={ESTIMATE_TONES[row.estimateStatus] ?? "neutral"}>{ESTIMATE_LABELS[row.estimateStatus] ?? row.estimateStatus}</Badge>
        </Link>
      ) : (
        <Empty />
      );
  }
}
