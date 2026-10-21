"use client";
import type { CSSProperties, KeyboardEvent, PointerEvent, RefObject } from "react";
import { previewRangeText } from "@/components/schedule/schedule-text";
import { addDays, dayOfWeek, formatIsoDate, type IsoDate } from "@/lib/calendar-date";
import { crewColorClasses } from "@/lib/schedule/colors";
import { isTentative } from "@/lib/schedule/confirmation";
import { assignLanes, laneCount } from "@/lib/schedule/conflicts";
import { closedDayTitle, type ClosedDay } from "@/lib/schedule/holidays";
import { barGeometry } from "@/lib/schedule/layout";
import type { CrewDTO, EntryDTO, ReadinessSummary } from "@/lib/schedule/types";
import { countWorkingDays, isWorkingDay, type WorkCalendar } from "@/lib/schedule/working-days";
import { cn } from "@/lib/utils";
import { bookedDays, matchesSearch, rowKey, type CalFor, type CrewRow, type DropPlan, type EntryConflict } from "./board-model";
import { EntryBar, type BarMode } from "./entry-bar";

const LANE_H = 34;
const BAR_H = 30;
const PAD = 5;
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export interface BarHandlers {
  onOpen: (entry: EntryDTO) => void;
  onPointerDown: (e: PointerEvent<HTMLElement>, entry: EntryDTO, mode: BarMode) => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>, entry: EntryDTO) => void;
  onBlur: (entry: EntryDTO) => void;
}

export interface BoardPreview {
  /** The booking being moved (dimmed in place), or null for a new one. */
  entryId: string | null;
  plan: DropPlan;
}

/** Shared bar props for a booking in a visible span starting at `from`. */
export function barInfo(e: EntryDTO, from: IsoDate, col: number, span: number, cal: WorkCalendar, today: IsoDate) {
  const offDays: number[] = [];
  for (let i = 0; i < span; i++) if (!isWorkingDay(addDays(from, col + i), cal)) offDays.push(i);
  const workingDays = countWorkingDays(e.startDate, e.endDate, cal);
  const dayNumber = e.startDate <= today && today <= e.endDate && isWorkingDay(today, cal) ? countWorkingDays(e.startDate, today, cal) : null;
  return { offDays, workingDays, dayNumber, tentative: isTentative(e.kind, e.confirmation) };
}

/** The dashed "drop here" ghost with its dates (red when it would double-book). */
export function GhostBar({ plan, style, crewColor }: { plan: DropPlan; style: CSSProperties; crewColor: string | null }) {
  const c = crewColorClasses(crewColor);
  const bad = !plan.valid || plan.conflict;
  return (
    <div
      aria-hidden
      data-testid="drag-preview"
      className={cn(
        "pointer-events-none absolute z-20 flex items-center overflow-hidden rounded-sm border-2 border-dashed px-1.5 text-xs font-medium whitespace-nowrap shadow-md",
        bad ? "border-danger bg-danger-soft text-danger" : cn("border-brand", c.bar, "text-text"),
      )}
      style={style}
    >
      <span className="truncate">
        {previewRangeText(plan.startDate, plan.endDate, plan.workingDays)}
        {!plan.valid && plan.reason ? ` · ${plan.reason}` : plan.conflict ? " · double-booked" : ""}
      </span>
    </div>
  );
}

const pct = (n: number, of: number) => `${(n / of) * 100}%`;

/**
 * Crew rows × days. Bars stack into lanes when they overlap; weekends, stat holidays
 * and closed days are shaded; today has an accent line. Only this card scrolls
 * sideways (4 weeks on a laptop), never the page.
 */
export function TimelineView({
  from,
  days,
  today,
  weekStartsOn,
  rows,
  entries,
  closed,
  calFor,
  crewsById,
  conflicts,
  readiness,
  search,
  editable,
  preview,
  scrollRef,
  handlers,
}: {
  from: IsoDate;
  days: IsoDate[];
  today: IsoDate;
  weekStartsOn: 0 | 1;
  rows: CrewRow[];
  entries: EntryDTO[];
  closed: ReadonlyMap<IsoDate, ClosedDay>;
  calFor: CalFor;
  crewsById: ReadonlyMap<string, CrewDTO>;
  conflicts: ReadonlyMap<string, EntryConflict>;
  readiness: Record<string, ReadinessSummary>;
  search: string;
  editable: boolean;
  preview: BoardPreview | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  handlers: BarHandlers;
}) {
  const n = days.length;
  const to = days[n - 1];
  const company = calFor(null);
  const todayIdx = days.indexOf(today);
  const lanes = assignLanes(entries);
  const searching = search.trim().length > 0;
  const cols = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` };
  const minWidth = `calc(11rem + ${n} * 3rem)`;

  return (
    <section aria-label="Crew timeline" data-testid="schedule-timeline" className="rounded-lg border border-border bg-surface print:border-0">
      {/* Print just the calendar: hide the app's menus and the schedule's own controls. */}
      <style>{"@media print { aside, header.sticky, [data-print-hide] { display: none !important; } }"}</style>
      <div ref={scrollRef} className="overflow-x-auto overscroll-x-contain print:overflow-visible">
        <div style={{ minWidth }}>
          <div className="sticky top-0 z-30 flex border-b border-border bg-surface">
            <div className="sticky left-0 z-10 flex w-44 shrink-0 items-end border-r border-border bg-surface px-3 py-2 text-xs font-semibold uppercase tracking-wide text-subtle">Crew</div>
            <div className="relative grid flex-1" style={cols}>
              {days.map((d, i) => {
                const c = closed.get(d);
                const weekend = !isWorkingDay(d, company) && !c;
                const isToday = d === today;
                const first = i === 0 || d.endsWith("-01");
                return (
                  <div
                    key={d}
                    data-testid="day-header"
                    data-date={d}
                    title={c ? closedDayTitle(c) : formatIsoDate(d, { weekday: "long", month: "long", day: "numeric" })}
                    className={cn(
                      "min-w-0 border-l border-border px-1 py-1 text-center text-xs",
                      dayOfWeek(d) === weekStartsOn && i > 0 && "border-l-border-strong",
                      c ? "bg-warning-soft text-warning" : weekend ? "bg-surface-2 text-muted" : "text-text",
                      isToday && "border-b-2 border-b-accent font-semibold text-accent",
                    )}
                  >
                    <div className="truncate text-[10px] uppercase text-subtle">{first ? formatIsoDate(d, { month: "short" }) : " "}</div>
                    <div>
                      {DOW[dayOfWeek(d)]}
                      <span className="tabular"> {Number(d.slice(8))}</span>
                    </div>
                    {c ? <div className="truncate text-[10px] leading-tight">{c.short}</div> : isToday ? <div className="text-[10px] leading-tight">Today</div> : null}
                  </div>
                );
              })}
            </div>
          </div>

          {rows.map((row) => {
            const rowEntries = entries.filter((e) => rowKey(e.crewId) === row.key);
            const cal = calFor(row.crew);
            const count = laneCount(lanes, rowEntries.map((e) => e.id));
            const height = count * LANE_H + PAD * 2;
            const booked = bookedDays(rowEntries, row.crewId, from, to, cal);
            const available = countWorkingDays(from, to, cal);
            const color = crewColorClasses(row.crew?.color);
            const ghost = preview && rowKey(preview.plan.crewId) === row.key ? preview : null;
            const ghostGeo = ghost ? barGeometry(ghost.plan, { from, days: n }) : null;
            const ghostLane = ghost?.entryId && lanes.has(ghost.entryId) && rowEntries.some((e) => e.id === ghost.entryId) ? (lanes.get(ghost.entryId) ?? 0) : 0;
            return (
              <div
                key={row.key}
                role="group"
                aria-label={row.crewId ? `${row.name}: ${booked} of ${available} work days booked` : `Unassigned: ${rowEntries.length} booking${rowEntries.length === 1 ? "" : "s"}`}
                data-crew-row={row.key}
                data-crew-name={row.name}
                className={cn("flex border-b border-border last:border-b-0", ghost && "bg-brand-soft/40")}
              >
                <div className="sticky left-0 z-10 flex w-44 shrink-0 flex-col justify-center gap-0.5 border-r border-border bg-surface px-3 py-1.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cn("size-2.5 shrink-0 rounded-full", row.crew ? color.dot : "border border-border-strong bg-surface")} aria-hidden />
                    <span className="truncate text-sm font-medium" title={row.name}>{row.name}</span>
                  </div>
                  {row.crew ? (
                    <div className="truncate pl-4.5 text-xs text-muted">
                      {row.crew.crewSize}×{Number(row.crew.hoursPerDay)}h{row.crew.worksSaturdays ? " · Sat" : ""} · <span className="tabular">{booked}/{available} days</span>
                      {!row.crew.active && " · inactive"}
                    </div>
                  ) : (
                    <div className="pl-4.5 text-xs text-muted">No crew yet</div>
                  )}
                </div>
                <div className="relative flex-1" style={{ height }}>
                  <div className="absolute inset-0 grid" style={cols}>
                    {days.map((d) => {
                      const c = closed.get(d);
                      return (
                        <div
                          key={d}
                          data-cell=""
                          data-date={d}
                          data-crew={row.crewId ?? ""}
                          className={cn(
                            "border-l border-border",
                            dayOfWeek(d) === weekStartsOn && d !== from && "border-l-border-strong",
                            c ? "bg-warning-soft/70" : !isWorkingDay(d, cal) && "bg-surface-2",
                          )}
                        />
                      );
                    })}
                  </div>
                  {todayIdx >= 0 && <div aria-hidden className="pointer-events-none absolute inset-y-0 z-[1] w-0.5 bg-accent" style={{ left: pct(todayIdx, n) }} />}
                  {rowEntries.map((e) => {
                    const g = barGeometry(e, { from, days: n });
                    if (!g) return null;
                    const ecal = calFor(e.crewId ? crewsById.get(e.crewId) : null);
                    const info = barInfo(e, from, g.col, g.span, ecal, today);
                    return (
                      <EntryBar
                        key={e.id}
                        entry={e}
                        crewColor={row.crew?.color ?? null}
                        style={{ left: `calc(${pct(g.col, n)} + 2px)`, width: `calc(${pct(g.span, n)} - 4px)`, top: PAD + (lanes.get(e.id) ?? 0) * LANE_H, height: BAR_H, zIndex: 2 }}
                        clipStart={g.clipStart}
                        clipEnd={g.clipEnd}
                        span={g.span}
                        {...info}
                        conflict={conflicts.get(e.id)}
                        readiness={readiness[e.projectId]}
                        editable={editable && !e.id.startsWith("temp-")}
                        match={searching ? matchesSearch(search, { number: e.projectNumber, customerName: e.customerName, city: e.city, jobTitle: e.jobTitle }) : null}
                        ghosted={preview?.entryId === e.id}
                        onOpen={handlers.onOpen}
                        onPointerDown={handlers.onPointerDown}
                        onKeyDown={handlers.onKeyDown}
                        onBlur={handlers.onBlur}
                      />
                    );
                  })}
                  {ghost && ghostGeo && (
                    <GhostBar
                      plan={ghost.plan}
                      crewColor={row.crew?.color ?? null}
                      style={{ left: `calc(${pct(ghostGeo.col, n)} + 2px)`, width: `calc(${pct(ghostGeo.span, n)} - 4px)`, top: PAD + ghostLane * LANE_H, height: BAR_H }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
