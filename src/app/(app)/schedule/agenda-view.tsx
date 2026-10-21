"use client";
import { Badge } from "@/components/ui";
import type { IsoDate } from "@/lib/calendar-date";
import { crewColorClasses } from "@/lib/schedule/colors";
import { isTentative } from "@/lib/schedule/confirmation";
import { kindLabel, longDay } from "@/lib/schedule/format";
import { closedDayTitle } from "@/lib/schedule/holidays";
import type { CrewDTO, EntryDTO } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";
import { matchesSearch, type AgendaDay, type EntryConflict } from "./board-model";
import { KIND_ICON } from "./entry-bar";

/** Phones: the days ahead as a list of cards. Tapping a card opens the booking; dates change in its form. */
export function AgendaView({
  days,
  today,
  crewsById,
  conflicts,
  search,
  onOpen,
}: {
  days: AgendaDay[];
  today: IsoDate;
  crewsById: ReadonlyMap<string, CrewDTO>;
  conflicts: ReadonlyMap<string, EntryConflict>;
  search: string;
  onOpen: (entry: EntryDTO) => void;
}) {
  const shown = days
    .map((d) => ({ ...d, items: search.trim() ? d.items.filter((i) => matchesSearch(search, { number: i.entry.projectNumber, customerName: i.entry.customerName, city: i.entry.city, jobTitle: i.entry.jobTitle })) : d.items }))
    .filter((d) => d.items.length || d.closed);

  if (!shown.length) {
    return <p className="rounded-lg border border-dashed border-border-strong bg-surface px-4 py-8 text-center text-sm text-muted">Nothing booked in these days.</p>;
  }

  return (
    <ol aria-label="Agenda" data-testid="schedule-agenda" className="space-y-4">
      {shown.map((day) => (
        <li key={day.date}>
          <h3 className={cn("mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide", day.date === today ? "text-accent" : "text-subtle")}>
            {day.date === today ? "Today · " : ""}
            {longDay(day.date)}
          </h3>
          {day.closed && <p className="mb-1.5 rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">{closedDayTitle(day.closed)}</p>}
          <ul className="space-y-2">
            {day.items.map(({ entry: e, dayNumber, totalDays }) => {
              const crew = e.crewId ? crewsById.get(e.crewId) : null;
              const c = crewColorClasses(crew?.color);
              const Icon = KIND_ICON[e.kind];
              const tentative = isTentative(e.kind, e.confirmation);
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    data-testid="agenda-item"
                    data-project-number={e.projectNumber}
                    onClick={() => onOpen(e)}
                    className={cn("w-full rounded-lg border border-border border-l-8 bg-surface px-3 py-2.5 text-left shadow-xs active:bg-surface-2", c.border)}
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <span className={cn("size-2.5 shrink-0 rounded-full", crew ? c.dot : "border border-border-strong")} aria-hidden />
                      <span className="font-semibold">#{e.projectNumber}</span>
                      <span className="min-w-0 flex-1 truncate">{e.customerName}</span>
                      {conflicts.has(e.id) && <Badge tone="danger">Double-booked</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-4.5 text-xs text-muted">
                      <span className="inline-flex items-center gap-1">
                        <Icon className="size-3.5" aria-hidden />
                        {kindLabel(e.kind)}
                        {e.phaseLabel ? ` · ${e.phaseLabel}` : ""}
                      </span>
                      {e.city && <span>{e.city}</span>}
                      <span>{e.crewName ?? "Unassigned"}</span>
                      <span>
                        Day {dayNumber} of {totalDays}
                      </span>
                      {tentative && <span className="text-warning">Tentative</span>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
