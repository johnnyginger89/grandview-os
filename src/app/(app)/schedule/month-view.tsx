"use client";
import { dayOfWeek, formatIsoDate, type IsoDate } from "@/lib/calendar-date";
import { closedDayTitle, type ClosedDay } from "@/lib/schedule/holidays";
import { monthSegments } from "@/lib/schedule/layout";
import type { CrewDTO, EntryDTO, ReadinessSummary } from "@/lib/schedule/types";
import { isWorkingDay } from "@/lib/schedule/working-days";
import { cn } from "@/lib/utils";
import { matchesSearch, monthLayout, MONTH_LANES, type CalFor, type EntryConflict } from "./board-model";
import { EntryBar } from "./entry-bar";
import { barInfo, GhostBar, type BarHandlers, type BoardPreview } from "./timeline-view";

const DATE_H = 22;
const LANE_H = 24;
const BAR_H = 21;
const MORE_H = 20;
const WEEK_H = DATE_H + MONTH_LANES * LANE_H + MORE_H;
const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pct = (n: number) => `${(n / 7) * 100}%`;

/**
 * A 6 × 7 month grid. Bars span the days of each week row and continue (◂ ▸) across
 * rows; up to four per day, then "+n more". Dragging changes dates only; the crew
 * stays (use the timeline or the drawer to change crews).
 */
export function MonthView({
  grid,
  month,
  today,
  entries,
  closed,
  calFor,
  crewsById,
  conflicts,
  readiness,
  search,
  editable,
  preview,
  handlers,
  onShowDay,
}: {
  grid: IsoDate[][];
  /** The 1st of the month shown. */
  month: IsoDate;
  today: IsoDate;
  entries: EntryDTO[];
  closed: ReadonlyMap<IsoDate, ClosedDay>;
  calFor: CalFor;
  crewsById: ReadonlyMap<string, CrewDTO>;
  conflicts: ReadonlyMap<string, EntryConflict>;
  readiness: Record<string, ReadinessSummary>;
  search: string;
  editable: boolean;
  preview: BoardPreview | null;
  handlers: BarHandlers;
  onShowDay: (date: IsoDate) => void;
}) {
  const weeks = monthLayout(entries, grid);
  const company = calFor(null);
  const monthKey = month.slice(0, 7);
  const searching = search.trim().length > 0;
  const ghostSegs = preview ? monthSegments(preview.plan, grid) : [];
  const ghostColor = preview?.plan.crewId ? (crewsById.get(preview.plan.crewId)?.color ?? null) : null;

  return (
    <section aria-label="Month calendar" data-testid="schedule-month" className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-center text-xs font-medium text-muted">
        {grid[0].map((d) => (
          <div key={d} className="py-1.5" title={DOW_LONG[dayOfWeek(d)]}>
            {DOW_LONG[dayOfWeek(d)].slice(0, 3)}
          </div>
        ))}
      </div>
      {weeks.map((week, row) => (
        <div key={week.days[0]} className="relative border-b border-border last:border-b-0" style={{ height: WEEK_H }}>
          <div className="absolute inset-0 grid grid-cols-7">
            {week.days.map((d, col) => {
              const c = closed.get(d);
              const inMonth = d.startsWith(monthKey);
              return (
                <div
                  key={d}
                  data-cell=""
                  data-date={d}
                  title={c ? closedDayTitle(c) : undefined}
                  className={cn("relative border-l border-border first:border-l-0", c ? "bg-warning-soft/70" : !isWorkingDay(d, company) && "bg-surface-2")}
                >
                  <div className="flex items-start justify-between gap-1 px-1.5 pt-0.5 text-xs" style={{ height: DATE_H }}>
                    <span className={cn("tabular", !inMonth && "text-subtle", d === today && "rounded-full bg-accent px-1.5 font-semibold text-white")}>{Number(d.slice(8))}</span>
                    {c && <span className="truncate text-[10px] text-warning">{c.short}</span>}
                  </div>
                  {week.hidden[col] > 0 && (
                    <button
                      type="button"
                      className="absolute inset-x-1 bottom-0.5 rounded px-1 text-left text-[11px] font-medium text-brand hover:bg-brand-soft"
                      style={{ height: MORE_H - 2 }}
                      onClick={() => onShowDay(d)}
                    >
                      +{week.hidden[col]} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {week.segments.map((s) => {
            const crew = s.entry.crewId ? crewsById.get(s.entry.crewId) : null;
            const info = barInfo(s.entry, week.days[0], s.col, s.span, calFor(crew), today);
            return (
              <EntryBar
                key={`${s.entry.id}:${row}`}
                entry={s.entry}
                crewColor={crew?.color ?? null}
                style={{ left: `calc(${pct(s.col)} + 2px)`, width: `calc(${pct(s.span)} - 4px)`, top: DATE_H + s.lane * LANE_H, height: BAR_H, zIndex: 2 }}
                clipStart={s.clipStart}
                clipEnd={s.clipEnd}
                span={s.span}
                {...info}
                conflict={conflicts.get(s.entry.id)}
                readiness={readiness[s.entry.projectId]}
                editable={editable && !s.entry.id.startsWith("temp-")}
                compact
                match={searching ? matchesSearch(search, { number: s.entry.projectNumber, customerName: s.entry.customerName, city: s.entry.city, jobTitle: s.entry.jobTitle }) : null}
                ghosted={preview?.entryId === s.entry.id}
                onOpen={handlers.onOpen}
                onPointerDown={handlers.onPointerDown}
                onKeyDown={handlers.onKeyDown}
                onBlur={handlers.onBlur}
              />
            );
          })}
          {preview &&
            ghostSegs
              .filter((g) => g.row === row)
              .map((g) => (
                <GhostBar key={g.row} plan={preview.plan} crewColor={ghostColor} style={{ left: `calc(${pct(g.col)} + 2px)`, width: `calc(${pct(g.span)} - 4px)`, top: DATE_H, height: BAR_H }} />
              ))}
        </div>
      ))}
      <p className="sr-only">{formatIsoDate(month, { month: "long", year: "numeric" })}</p>
    </section>
  );
}
