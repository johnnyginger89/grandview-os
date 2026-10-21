"use client";
import { ChevronDown, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import Link from "next/link";
import { buttonClass, Input } from "@/components/ui";
import { formatIsoDate, type IsoDate } from "@/lib/calendar-date";
import { crewColorClasses } from "@/lib/schedule/colors";
import type { CrewDTO } from "@/lib/schedule/types";
import type { ScheduleWindow } from "@/lib/schedule/window";
import { shiftWindow } from "@/lib/schedule/window";
import { cn } from "@/lib/utils";

export interface HrefOptions {
  view?: "timeline" | "month";
  from?: IsoDate;
  span?: number;
  crews?: string[];
  /** The open booking (`?focus=`). */
  focus?: string | null;
}
export type HrefFor = (o?: HrefOptions) => string;

function rangeLabel(win: ScheduleWindow): string {
  if (win.view === "month" && win.month) return formatIsoDate(win.month, { month: "long", year: "numeric" });
  const sameYear = win.from.slice(0, 4) === win.to.slice(0, 4);
  return `${formatIsoDate(win.from, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })} – ${formatIsoDate(win.to, { month: "short", day: "numeric", year: "numeric" })}`;
}

function Segment({ items, label, className }: { items: { href: string; text: string; current: boolean }[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn("inline-flex overflow-hidden rounded-md border border-border-strong bg-surface", className)}>
      {items.map((i) => (
        <Link
          key={i.text}
          href={i.href}
          scroll={false}
          aria-current={i.current ? "page" : undefined}
          className={cn("border-r border-border-strong px-3 py-1.5 text-sm last:border-r-0", i.current ? "bg-brand text-brand-contrast" : "text-text hover:bg-surface-2")}
        >
          {i.text}
        </Link>
      ))}
    </nav>
  );
}

/** View, prev / today / next, span, crew filter and search. All of it lives in the URL so a link can be shared. */
export function ScheduleToolbar({
  win,
  today,
  hrefFor,
  crews,
  filter,
  onFilter,
  search,
  onSearch,
  loading,
}: {
  win: ScheduleWindow;
  today: IsoDate;
  hrefFor: HrefFor;
  crews: CrewDTO[];
  filter: string[];
  onFilter: (ids: string[]) => void;
  search: string;
  onSearch: (q: string) => void;
  loading: boolean;
}) {
  const toggle = (id: string) => onFilter(filter.includes(id) ? filter.filter((x) => x !== id) : [...filter, id]);
  const inView = today >= win.from && today <= win.to;
  const selectable = crews.filter((c) => c.active || filter.includes(c.id));

  return (
    <div className="mb-4 space-y-2 print:hidden" data-print-hide>
      <div className="flex flex-wrap items-center gap-2">
        <Segment
          label="View"
          className="hidden md:inline-flex"
          items={[
            { text: "Month", href: hrefFor({ view: "month", from: inView ? today : win.from }), current: win.view === "month" },
            { text: "By crew", href: hrefFor({ view: "timeline", from: inView ? today : win.from }), current: win.view === "timeline" },
          ]}
        />
        <div className="inline-flex items-center gap-1">
          <Link href={hrefFor({ from: shiftWindow(win, -1) })} scroll={false} className={buttonClass("secondary", "sm", "px-2")} aria-label={win.view === "month" ? "Previous month" : "Previous weeks"}>
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
          <Link href={hrefFor({ from: today })} scroll={false} className={buttonClass("secondary", "sm")}>
            Today
          </Link>
          <Link href={hrefFor({ from: shiftWindow(win, 1) })} scroll={false} className={buttonClass("secondary", "sm", "px-2")} aria-label={win.view === "month" ? "Next month" : "Next weeks"}>
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </div>
        <h2 className="min-w-0 text-sm font-semibold sm:text-base" aria-live="polite" data-testid="schedule-range">
          {rangeLabel(win)}
          {loading && <span className="ml-2 text-xs font-normal text-muted">Loading…</span>}
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {win.view === "timeline" && (
            <Segment
              label="How many weeks"
              items={[7, 14, 28].map((span) => ({ text: `${span / 7} wk`, href: hrefFor({ span }), current: win.span === span }))}
            />
          )}
          <details className="relative">
            <summary className={buttonClass("secondary", "sm", "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
              Crews{filter.length ? ` (${filter.length})` : ""} <ChevronDown className="size-4" aria-hidden />
            </summary>
            <div className="absolute left-0 z-40 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-surface p-2 shadow-lg sm:right-0 sm:left-auto">
              <fieldset>
                <legend className="px-1 pb-1 text-xs font-medium text-muted">Show these crews</legend>
                {selectable.length ? (
                  selectable.map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-surface-2">
                      <input type="checkbox" className="size-4" checked={filter.includes(c.id)} onChange={() => toggle(c.id)} />
                      <span className={cn("size-2.5 rounded-full", crewColorClasses(c.color).dot)} aria-hidden />
                      <span className="truncate">{c.name}</span>
                    </label>
                  ))
                ) : (
                  <p className="px-1 py-1.5 text-sm text-muted">No crews yet.</p>
                )}
              </fieldset>
              {filter.length > 0 && (
                <button type="button" className="mt-1 w-full rounded px-1 py-1.5 text-left text-sm text-brand hover:bg-surface-2" onClick={() => onFilter([])}>
                  Show all crews
                </button>
              )}
            </div>
          </details>
          <label className="relative block">
            <span className="sr-only">Search jobs</span>
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input type="search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Customer, #number or city" className="h-8 w-56 pl-8" />
          </label>
        </div>
      </div>
      {filter.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Crew filter">
          {filter.map((id) => {
            const c = crews.find((x) => x.id === id);
            if (!c) return null;
            return (
              <li key={id}>
                <button type="button" onClick={() => toggle(id)} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", crewColorClasses(c.color).chip)} aria-label={`Stop filtering by ${c.name}`}>
                  {c.name} <X className="size-3" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
