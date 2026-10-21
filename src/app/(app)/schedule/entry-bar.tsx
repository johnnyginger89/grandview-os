"use client";
import { AlertTriangle, Briefcase, ClipboardCheck, Clock, Droplets, GripVertical, Hammer, Paintbrush, Palette, Wrench, type LucideIcon } from "lucide-react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import type { ScheduleEntryKind } from "@/lib/schedule/constants";
import { crewColorClasses } from "@/lib/schedule/colors";
import { dayList } from "@/components/schedule/schedule-text";
import { dateRangeLabel, entryAriaLabel, kindLabel, workingDaysLabel } from "@/lib/schedule/format";
import type { EntryDTO, ReadinessSummary } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";
import type { EntryConflict } from "./board-model";

export const KIND_ICON: Record<ScheduleEntryKind, LucideIcon> = {
  work: Paintbrush,
  pressure_wash: Droplets,
  colour_consult: Palette,
  carpentry: Hammer,
  walk_through: ClipboardCheck,
  touch_up: Wrench,
  other: Briefcase,
};

/** Weekends and holidays inside a bar are paled a little (those days aren't counted). */
const OFF_DAY_SHADE: CSSProperties = { backgroundColor: "rgb(255 255 255 / 0.35)" };

export type BarMode = "move" | "resize-start" | "resize-end";

export interface EntryBarProps {
  entry: EntryDTO;
  crewColor: string | null;
  /** Position inside the row or week (left/width/top in %, px). */
  style: CSSProperties;
  clipStart: boolean;
  clipEnd: boolean;
  /** Visible columns of this bar that aren't work days, as 0-based offsets within `span`. */
  offDays: number[];
  span: number;
  workingDays: number;
  /** "Day 2 of 5" when today falls inside the booking. */
  dayNumber: number | null;
  tentative: boolean;
  conflict: EntryConflict | undefined;
  /** "Ready 2/4" for the tooltip. */
  readiness?: ReadinessSummary;
  editable: boolean;
  compact?: boolean;
  /** Search: false = dimmed, true = highlighted, null = no search. */
  match: boolean | null;
  /** Being dragged or moved with the keyboard: the ghost shows where it goes. */
  ghosted: boolean;
  onOpen: (entry: EntryDTO) => void;
  onPointerDown: (e: PointerEvent<HTMLElement>, entry: EntryDTO, mode: BarMode) => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>, entry: EntryDTO) => void;
  onBlur?: (entry: EntryDTO) => void;
}

function tooltip(p: EntryBarProps): string {
  const e = p.entry;
  return [
    `#${e.projectNumber} · ${e.customerName} – ${e.jobTitle}${e.city ? ` · ${e.city}` : ""}`,
    `${kindLabel(e.kind)}${e.phaseLabel ? ` · ${e.phaseLabel}` : ""} · ${e.crewName ?? "Unassigned"}`,
    `${dateRangeLabel(e.startDate, e.endDate)} · ${workingDaysLabel(p.workingDays)}`,
    p.dayNumber ? `Day ${p.dayNumber} of ${p.workingDays}` : null,
    p.tentative ? "Tentative – the customer hasn't confirmed the start date" : null,
    p.readiness && p.readiness.total ? `Ready ${p.readiness.ready}/${p.readiness.total}${p.readiness.missing.length ? ` · missing: ${p.readiness.missing.join(", ")}` : ""}` : null,
    p.conflict ? `⚠ Double-booked with ${p.conflict.otherNumbers.map((n) => `#${n}`).join(", ")} on ${dayList(p.conflict.dates)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * One booking. The bar itself is a <button> (Enter opens the drawer, M or Space starts
 * keyboard move mode). The ⋮⋮ grip and the edge handles are siblings, not children, and
 * only they turn off touch panning, so a finger can still scroll the calendar.
 */
export function EntryBar(p: EntryBarProps) {
  const { entry, editable, compact } = p;
  const c = crewColorClasses(p.crewColor);
  const Icon = KIND_ICON[entry.kind];
  const label = entryAriaLabel({
    projectNumber: entry.projectNumber,
    customerName: entry.customerName,
    kind: entry.kind,
    crewName: entry.crewName,
    startDate: entry.startDate,
    endDate: entry.endDate,
    workingDays: p.workingDays,
    tentative: p.tentative,
    conflict: !!p.conflict,
    phaseLabel: entry.phaseLabel,
  });

  return (
    <div
      className={cn("group absolute select-none", p.ghosted && "opacity-40", p.match === false && "opacity-30")}
      style={p.style}
      data-testid="schedule-bar"
      data-entry-id={entry.id}
      data-project-number={entry.projectNumber}
      data-crew-id={entry.crewId ?? ""}
      data-start={entry.startDate}
      data-end={entry.endDate}
      data-tentative={p.tentative ? "true" : "false"}
      data-conflict={p.conflict ? "true" : "false"}
    >
      <button
        type="button"
        aria-label={label.replace(/^Job \d+/, `Job #${entry.projectNumber}`)}
        title={tooltip(p)}
        className={cn(
          "relative flex h-full w-full items-center gap-1 overflow-hidden rounded-md text-left font-medium shadow-xs outline-offset-1",
          compact ? "px-1 text-[11px] leading-tight" : "px-1.5 text-xs",
          c.solid,
          p.conflict && "ring-2 ring-danger ring-offset-1",
          p.match === true && "ring-2 ring-accent",
          editable && "cursor-grab active:cursor-grabbing",
          p.clipStart && "rounded-l-none",
          p.clipEnd && "rounded-r-none",
        )}
        onClick={() => p.onOpen(entry)}
        onKeyDown={(e) => p.onKeyDown(e, entry)}
        onBlur={() => p.onBlur?.(entry)}
        onKeyUp={(e) => {
          // Space starts move mode for editors; don't let it also "click" the bar.
          if (editable && e.key === " ") e.preventDefault();
        }}
        onPointerDown={(e) => {
          // A finger on the bar body scrolls; touch drags start from the grip.
          if (editable && e.pointerType !== "touch") p.onPointerDown(e, entry, "move");
        }}
      >
        {p.offDays.map((i) => (
          <span key={i} aria-hidden className="pointer-events-none absolute inset-y-0" style={{ left: `${(i / p.span) * 100}%`, width: `${100 / p.span}%`, ...OFF_DAY_SHADE }} />
        ))}
        {p.clipStart && <span aria-hidden className="relative shrink-0 opacity-80">◂</span>}
        {editable && <span aria-hidden className="w-2.5 shrink-0" />}
        {p.conflict && <AlertTriangle className="relative size-3.5 shrink-0" aria-hidden />}
        {p.tentative ? <Clock className="relative size-3.5 shrink-0 opacity-90" aria-hidden /> : <Icon className="relative size-3.5 shrink-0 opacity-90" aria-hidden />}
        <span className="relative min-w-0 flex-1 truncate">
          <span className="font-semibold">#{entry.projectNumber}</span> {entry.customerName}
          {!compact && entry.city ? <span className="opacity-85"> · {entry.city}</span> : null}
          {entry.phaseLabel ? <span className="opacity-85"> · {entry.phaseLabel}</span> : null}
        </span>
        {p.clipEnd && <span aria-hidden className="relative shrink-0 opacity-80">▸</span>}
      </button>
      {editable && (
        <>
          <span
            aria-label={`Drag #${entry.projectNumber} to move it`}
            role="img"
            className="absolute inset-y-0 left-1 flex w-3 cursor-grab touch-none items-center opacity-80"
            onPointerDown={(e) => p.onPointerDown(e, entry, "move")}
          >
            <GripVertical className={compact ? "size-3" : "size-3.5"} aria-hidden />
          </span>
          {!p.clipStart && (
            <span
              aria-label="Change start date"
              role="img"
              className="absolute inset-y-0 -left-0.5 w-2 cursor-ew-resize touch-none rounded-l-sm hover:bg-black/15"
              onPointerDown={(e) => {
                e.stopPropagation();
                p.onPointerDown(e, entry, "resize-start");
              }}
            />
          )}
          {!p.clipEnd && (
            <span
              aria-label="Change end date"
              role="img"
              className="absolute inset-y-0 -right-0.5 w-2 cursor-ew-resize touch-none rounded-r-sm hover:bg-black/15"
              onPointerDown={(e) => {
                e.stopPropagation();
                p.onPointerDown(e, entry, "resize-end");
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
