"use client";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import type { IsoDate } from "@/lib/calendar-date";
import { SCHEDULE_ENTRY_KINDS, type ScheduleEntryKind } from "@/lib/schedule/constants";
import { kindLabel, shortDay } from "@/lib/schedule/format";
import type { CrewDTO } from "@/lib/schedule/types";
import type { WorkCalendar } from "@/lib/schedule/working-days";
import { previewRangeText, resolveRange, type RangeInput } from "./schedule-text";

export interface EntryFormValues {
  crewId: string | null;
  kind: ScheduleEntryKind;
  startDate: IsoDate;
  endDate: IsoDate;
  workingDays: number;
  phaseLabel: string | null;
  crewNotes: string | null;
  notes: string | null;
}

export interface EntryFormInitial {
  crewId: string | null;
  kind: ScheduleEntryKind;
  startDate: IsoDate;
  /** Edit: the saved end date. Create: leave out and give workingDays. */
  endDate?: IsoDate;
  workingDays?: number;
  phaseLabel?: string | null;
  crewNotes?: string | null;
  notes?: string | null;
}

const UNASSIGNED = "";

/**
 * Crew, kind, start date and working days ⇄ end date (live), phase and notes. Used by
 * the booking drawer, the phone "Schedule…" sheet and the project page. Fully
 * controlled, so a failed save never wipes what was typed (feasibility review F10).
 */
export function EntryForm({
  mode,
  crews,
  initial,
  calendarFor,
  suggestDays,
  kinds = SCHEDULE_ENTRY_KINDS,
  submitLabel,
  pending = false,
  error,
  showNotes = true,
  extraActions,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  /** Crews to choose from; inactive ones are listed only when already selected. */
  crews: readonly CrewDTO[];
  initial: EntryFormInitial;
  calendarFor: (crewId: string | null) => WorkCalendar;
  /** Create: suggested working days per crew (updates while the user hasn't typed a number). */
  suggestDays?: (crewId: string | null) => number;
  kinds?: readonly ScheduleEntryKind[];
  submitLabel: string;
  pending?: boolean;
  error?: string | null;
  showNotes?: boolean;
  extraActions?: ReactNode;
  onSubmit: (values: EntryFormValues) => void;
  onCancel?: () => void;
}) {
  const uid = useId();
  const [crewId, setCrewId] = useState<string>(initial.crewId ?? UNASSIGNED);
  const [kind, setKind] = useState<ScheduleEntryKind>(initial.kind);
  const [range, setRange] = useState<RangeInput>(() => ({
    start: initial.startDate,
    end: initial.endDate ?? "",
    days: String(initial.workingDays ?? suggestDays?.(initial.crewId) ?? 1),
    mode: initial.endDate ? "end" : "days",
  }));
  const [daysTouched, setDaysTouched] = useState(false);
  const [phaseLabel, setPhaseLabel] = useState(initial.phaseLabel ?? "");
  const [crewNotes, setCrewNotes] = useState(initial.crewNotes ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  const crew = crewId === UNASSIGNED ? null : crewId;
  const cal = calendarFor(crew);
  const res = resolveRange(range, cal);
  const choices = crews.filter((c) => c.active || c.id === initial.crewId);

  function changeCrew(next: string) {
    setCrewId(next);
    if (mode === "create" && !daysTouched && suggestDays) setRange((r) => ({ ...r, days: String(suggestDays(next === UNASSIGNED ? null : next)), mode: "days" }));
  }

  function changeStart(start: string) {
    // Keep the length: with an end date set, move to "working days" so the end follows.
    setRange((r) => (r.mode === "end" && res.ok ? { start, end: r.end, days: String(Math.max(1, res.workingDays)), mode: "days" } : { ...r, start }));
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!res.ok) {
      setLocalError(res.error);
      return;
    }
    setLocalError(null);
    onSubmit({
      crewId: crew,
      kind,
      startDate: res.startDate,
      endDate: res.endDate,
      workingDays: res.workingDays,
      phaseLabel: phaseLabel.trim() || null,
      crewNotes: crewNotes.trim() || null,
      notes: notes.trim() || null,
    });
  }

  const endValue = range.mode === "days" ? (res.ok ? res.endDate : "") : range.end;
  const daysValue = range.mode === "end" ? (res.ok ? String(res.workingDays) : "") : range.days;

  return (
    <form onSubmit={submit} className="space-y-3" data-testid={`entry-form-${mode}`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Crew">
          <Select value={crewId} onChange={(e) => changeCrew(e.target.value)} disabled={pending}>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.active ? "" : " (inactive)"}
              </option>
            ))}
            <option value={UNASSIGNED}>Unassigned (no crew yet)</option>
          </Select>
        </Field>
        <Field label="Type of visit">
          <Select value={kind} onChange={(e) => setKind(e.target.value as ScheduleEntryKind)} disabled={pending}>
            {(kinds.includes(kind) ? kinds : [kind, ...kinds]).map((k) => (
              <option key={k} value={k}>{kindLabel(k)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Start date">
          <Input type="date" value={range.start} onChange={(e) => changeStart(e.target.value)} required disabled={pending} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Working days">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={120}
              step={1}
              value={daysValue}
              onChange={(e) => {
                setDaysTouched(true);
                setRange((r) => ({ ...r, days: e.target.value, mode: "days" }));
              }}
              disabled={pending}
            />
          </Field>
          <Field label="End date">
            <Input type="date" value={endValue} min={range.start || undefined} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value, mode: "end" }))} disabled={pending} />
          </Field>
        </div>
      </div>

      <p className="text-sm text-muted" aria-live="polite" id={`${uid}-range`}>
        {res.ok ? (
          <>
            {previewRangeText(res.startDate, res.endDate, res.workingDays)}
            {res.snappedFrom && <> · {shortDay(res.snappedFrom)} isn&apos;t a work day, so it starts {shortDay(res.startDate)}</>}
          </>
        ) : (
          res.error
        )}
      </p>

      <Field label="Phase or area (optional)">
        <Input value={phaseLabel} onChange={(e) => setPhaseLabel(e.target.value)} maxLength={80} placeholder="e.g. Building B, back deck" disabled={pending} />
      </Field>
      {showNotes && (
        <>
          <Field label="Notes for the crew" hint="The crew sees these on My Jobs.">
            <Textarea value={crewNotes} onChange={(e) => setCrewNotes(e.target.value)} maxLength={2000} rows={2} disabled={pending} />
          </Field>
          <Field label="Office notes" hint="Only the office sees these.">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} disabled={pending} />
          </Field>
        </>
      )}

      <FormError message={localError ?? error} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={pending}>Cancel</Button>
        )}
        {extraActions}
      </div>
    </form>
  );
}
