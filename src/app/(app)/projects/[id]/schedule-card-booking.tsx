"use client";
import { CalendarPlus } from "lucide-react";
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { addDays, isIsoDate, type IsoDate } from "@/lib/calendar-date";
import { MAX_WORKING_DAYS, type ScheduleEntryKind } from "@/lib/schedule/constants";
import { dateRangeLabel, shortDay, workingDaysLabel } from "@/lib/schedule/format";
import type { ScheduleSettings } from "@/lib/schedule/settings-schema";
import { addWorkingDays, calendarsFor, nextWorkingDay } from "@/lib/schedule/working-days";
import { createBookingAction, type ScheduleCardResult } from "./schedule-actions";

export interface BookingCrewOption {
  id: string;
  name: string;
  worksSaturdays: boolean;
  /** Working days this crew needs for the hours still unscheduled. */
  suggestedDays: number;
}

export type BookingCalendar = Pick<ScheduleSettings, "workDays" | "holidayRegion" | "extraClosedDays">;

const ON_HOLD_QUESTION = "This job is on hold. Schedule it and move it to Scheduled?";

/** "Schedule this job": crew, start date and working days, with a live end date. */
export function ScheduleBookingForm({
  projectId,
  onHold,
  kinds,
  crews,
  unassignedDays,
  calendar,
  defaultStart,
  hasBookings,
}: {
  projectId: string;
  onHold: boolean;
  kinds: { value: ScheduleEntryKind; label: string }[];
  crews: BookingCrewOption[];
  /** Suggestion before a crew is chosen (default crew size). */
  unassignedDays: number;
  calendar: BookingCalendar;
  defaultStart: IsoDate;
  hasBookings: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [crewId, setCrewId] = useState(crews[0]?.id ?? "");
  const [kind, setKind] = useState<ScheduleEntryKind>(kinds[0]?.value ?? "work");
  const [start, setStart] = useState<string>(defaultStart);
  const [days, setDays] = useState<string>("");
  const [daysTouched, setDaysTouched] = useState(false);
  const [phase, setPhase] = useState("");
  const [crewNotes, setCrewNotes] = useState("");
  const [result, setResult] = useState<ScheduleCardResult | null>(null);
  const [pending, startTransition] = useTransition();

  const crew = crews.find((c) => c.id === crewId) ?? null;
  const suggested = kind === "work" ? (crew?.suggestedDays ?? unassignedDays) : 1;
  const dayText = daysTouched ? days : String(suggested);
  const n = Number(dayText);
  const validDays = /^\d+$/.test(dayText) && n >= 1 && n <= MAX_WORKING_DAYS;

  const range = useMemo(() => {
    if (!isIsoDate(start) || !validDays) return null;
    const cal = calendarsFor(calendar, start, addDays(start, 400)).calFor(crew);
    const first = nextWorkingDay(start, cal);
    return { first, last: addWorkingDays(first, n, cal) };
  }, [calendar, crew, n, start, validDays]);

  if (!kinds.length) return null;

  const reset = () => {
    setDaysTouched(false);
    setDays("");
    setPhase("");
    setCrewNotes("");
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!range || pending) return;
    let confirmOnHold = false;
    if (onHold && kind === "work") {
      if (!window.confirm(ON_HOLD_QUESTION)) return;
      confirmOnHold = true;
    }
    const payload = (confirm: boolean) => ({
      projectId,
      crewId: crewId || null,
      kind,
      startDate: start,
      workingDays: n,
      phaseLabel: phase.trim() || null,
      crewNotes: crewNotes.trim() || null,
      confirmOnHold: confirm,
    });
    setResult(null);
    startTransition(async () => {
      let r = await createBookingAction(payload(confirmOnHold));
      if (!r.ok && r.reason === "confirm_on_hold" && window.confirm(ON_HOLD_QUESTION)) r = await createBookingAction(payload(true));
      setResult(r);
      if (r.ok) {
        reset();
        setOpen(false);
      }
    });
  };

  const feedback = result?.ok && (
    <div role="status" className="space-y-1 text-sm">
      <p className="text-success">{result.message}</p>
      {result.warnings?.length ? (
        <ul className="list-disc space-y-0.5 pl-5 text-warning">
          {result.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      ) : null}
    </div>
  );

  if (!open) {
    return (
      <div className="space-y-2">
        {feedback}
        <Button size="sm" variant={hasBookings ? "secondary" : "primary"} onClick={() => { setOpen(true); setResult(null); }}>
          <CalendarPlus className="size-4" aria-hidden /> {hasBookings ? "Add another booking" : "Schedule this job"}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-border bg-surface-2/50 p-3" aria-label="Schedule this job">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Crew">
          <Select value={crewId} onChange={(e) => setCrewId(e.target.value)}>
            {crews.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="">No crew yet</option>
          </Select>
        </Field>
        {kinds.length > 1 && (
          <Field label="Booking type">
            <Select value={kind} onChange={(e) => setKind(e.target.value as ScheduleEntryKind)}>
              {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Start date">
          <Input type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Working days" hint={`Suggested: ${suggested}${kind === "work" ? (crew ? ` for ${crew.name}` : " with a standard crew") : ""}`}>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_WORKING_DAYS}
            required
            value={dayText}
            onChange={(e) => {
              setDays(e.target.value);
              setDaysTouched(true);
            }}
          />
        </Field>
        <Field label="Phase or area (optional)">
          <Input value={phase} maxLength={80} placeholder="e.g. Building B" onChange={(e) => setPhase(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes the painters will see (optional)">
        <Textarea rows={2} maxLength={2000} value={crewNotes} onChange={(e) => setCrewNotes(e.target.value)} placeholder="Shown on My Jobs, e.g. start with the back deck" />
      </Field>

      <p className="text-sm" aria-live="polite">
        {range ? (
          <>
            <span className="font-medium">{dateRangeLabel(range.first, range.last)}</span> · {workingDaysLabel(n)}
            {range.first !== start && <span className="block text-xs text-muted">{shortDay(start)} isn&apos;t a working day, so it starts {shortDay(range.first)}.</span>}
          </>
        ) : (
          <span className="text-muted">Pick a start date and 1–{MAX_WORKING_DAYS} working days.</span>
        )}
      </p>

      {result && !result.ok && <FormError message={result.error} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!range || pending}>{pending ? "Saving…" : "Add to schedule"}</Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setOpen(false); setResult(null); }}>Cancel</Button>
      </div>
    </form>
  );
}
