"use client";
import Link from "next/link";
import { CalendarClock, ChevronDown, ChevronRight, Clock, Mail, Phone } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { daysInStage, isFollowUpDue, isStale, mailtoHref, telHref, type Group, type GroupBy, type PipelineRow } from "@/lib/pipeline/list-view";
import { stageTone } from "@/lib/pipeline/stage-colors";
import { cn } from "@/lib/utils";
import { formatShortDate, formatVisit, StagePill, ValueCell, type CellContext } from "./list-cells";
import { GroupSummary, renderedRows } from "./leads-table";

/** Phone layout: one card per lead, grouped by stage, with large Call / Email / Follow-up buttons. */
export function LeadsCards({
  groups,
  groupBy,
  collapsed,
  canCollapse,
  onToggleGroup,
  showAll,
  onShowAll,
  ctx,
  includeMoney,
  flashId,
}: {
  groups: Group[];
  groupBy: GroupBy;
  collapsed: Set<string>;
  canCollapse: boolean;
  onToggleGroup: (key: string) => void;
  showAll: Set<string>;
  onShowAll: (key: string) => void;
  ctx: CellContext;
  includeMoney: boolean;
  flashId: string | null;
}) {
  return (
    <div className="space-y-4" data-testid="leads-cards">
      {groups.map((g) => {
        const isCollapsed = groupBy === "stage" && collapsed.has(g.key);
        const rows = isCollapsed ? [] : renderedRows(g, showAll);
        const tone = stageTone(g.stage?.color ?? "slate");
        return (
          <section key={g.key} aria-label={g.stage?.name ?? "All leads"} data-testid={`cards-group-${g.key}`}>
            {g.stage && (
              <h2 className={cn("sticky top-14 z-10 -mx-1 mb-2 flex items-center gap-2 border-l-4 bg-bg px-2 py-2", tone.bar)}>
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  disabled={!canCollapse}
                  onClick={() => onToggleGroup(g.key)}
                  className={cn("flex min-h-8 items-center gap-1 text-xs font-semibold uppercase tracking-wide", g.count ? tone.text : "text-subtle")}
                >
                  {isCollapsed ? <ChevronRight className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
                  {g.stage.name}
                  <span className="sr-only"> group</span>
                </button>
                <GroupSummary group={g} />
              </h2>
            )}
            {rows.length > 0 && (
              <div className="flex flex-col gap-2">
                {rows.map((r) => (
                  <LeadCard key={r.id} row={r} ctx={ctx} includeMoney={includeMoney} flash={flashId === r.id} />
                ))}
              </div>
            )}
            {!isCollapsed && rows.length < g.rows.length && (
              <button type="button" onClick={() => onShowAll(g.key)} className={buttonClass("ghost", "md", "mt-2 w-full")}>
                Show all {g.rows.length}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

function LeadCard({ row, ctx, includeMoney, flash }: { row: PipelineRow; ctx: CellContext; includeMoney: boolean; flash: boolean }) {
  const stale = isStale(row, ctx.stagesById.get(row.stageId), ctx.now);
  const due = isFollowUpDue(row, ctx.now);
  const tel = telHref(row.phone);
  const mail = mailtoHref(row.email);
  const action = "h-11 flex-1 px-2";
  return (
    <article
      aria-label={row.customerName}
      data-testid="lead-card"
      data-lead-id={row.id}
      className={cn("rounded-lg border bg-surface p-3 text-sm shadow-xs transition-colors duration-700", stale ? "border-danger/40" : "border-border", flash && "bg-brand-soft")}
    >
      <div className="flex items-start gap-2">
        <Link href={`/leads/${row.id}`} className="min-w-0 flex-1 font-medium leading-snug text-text hover:underline">
          {row.customerName}
        </Link>
        {!row.firstViewedAt && row.stageKey === "new_lead" && (
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-500" title="Not opened yet">
            <span className="sr-only">Not opened yet</span>
          </span>
        )}
        {row.number != null && <span className="shrink-0 text-xs text-subtle">#{row.number}</span>}
        {row.stageKind === "open" && <span className={cn("shrink-0 text-xs tabular", stale ? "font-medium text-danger" : "text-subtle")}>{daysInStage(row, ctx.now)}d</span>}
      </div>
      <p className="mt-0.5 truncate text-xs text-muted">{[row.projectTypes.join(", "), row.city].filter(Boolean).join(" · ") || "No details yet"}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <StagePill row={row} ctx={ctx} idPrefix="stage-c" className={ctx.canEdit ? "h-9" : undefined} />
        {includeMoney && <ValueCell row={row} />}
      </div>
      {row.estimateVisitAt && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-info">
          <CalendarClock className="size-3.5" aria-hidden /> Visit {formatVisit(row.estimateVisitAt)}
        </p>
      )}
      {row.nextFollowUpAt && (
        <p className={cn("mt-1 flex items-center gap-1.5 text-xs", due ? "font-medium text-warning" : "text-muted")}>
          <Clock className="size-3.5" aria-hidden /> Follow-up {formatShortDate(row.nextFollowUpAt, ctx.now)}
          {due && " · due"}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        {tel ? (
          <a href={tel} className={buttonClass("secondary", "md", action)}>
            <Phone className="size-4" aria-hidden /> Call
          </a>
        ) : (
          <span className={buttonClass("secondary", "md", cn(action, "pointer-events-none opacity-50"))} aria-disabled="true">
            <Phone className="size-4" aria-hidden /> Call
          </span>
        )}
        {mail ? (
          <a href={mail} className={buttonClass("secondary", "md", action)}>
            <Mail className="size-4" aria-hidden /> Email
          </a>
        ) : (
          <span className={buttonClass("secondary", "md", cn(action, "pointer-events-none opacity-50"))} aria-disabled="true">
            <Mail className="size-4" aria-hidden /> Email
          </span>
        )}
        {ctx.canEdit && (
          <button type="button" onClick={() => ctx.onFollowUp(row)} className={buttonClass("secondary", "md", action)}>
            <Clock className="size-4" aria-hidden /> Follow-up
            <span className="sr-only"> for {row.customerName}</span>
          </button>
        )}
      </div>
    </article>
  );
}
