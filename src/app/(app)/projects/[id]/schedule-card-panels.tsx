"use client";
import { useId, useState, useTransition, type FormEvent } from "react";
import { Badge, Button, Field, FormError, Input, Select, Textarea, type Tone } from "@/components/ui";
import { formatIsoDate, isIsoDate, type IsoDate } from "@/lib/calendar-date";
import { READINESS_STATES, type ReadinessState } from "@/lib/schedule/constants";
import type { ReadinessItem } from "@/lib/schedule/readiness";
import { markInProgressAction, removeAllBookingsAction, saveSchedulingPrefsAction, setReadinessAction, type ScheduleCardResult } from "./schedule-actions";

const STATE_TONE: Record<ReadinessState, Tone> = { todo: "warning", in_progress: "info", done: "success", not_needed: "neutral" };

const dayLabel = (d: IsoDate) => formatIsoDate(d, { month: "short", day: "numeric", year: "numeric" });

function ReadinessRow({ projectId, item, canEdit }: { projectId: string; item: ReadinessItem; canEdit: boolean }) {
  const selectId = useId();
  const [override, setOverride] = useState<ReadinessState | null>(null);
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(item.dueDate ?? "");
  const [note, setNote] = useState(item.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const state = override ?? item.state;

  const save = (patch: { state: ReadinessState; dueDate?: string | null; note?: string | null }, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await setReadinessAction({ projectId, checkKey: item.key, ...patch });
      setOverride(null);
      if (r.ok) after?.();
      else setError(r.error);
    });

  const changeState = (s: ReadinessState) => {
    setOverride(s);
    save({ state: s });
  };

  const saveDetails = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (date && !isIsoDate(date)) return;
    save({ state, dueDate: date || null, note: note.trim() || null }, () => setEditing(false));
  };

  const details = [item.dueDate ? dayLabel(item.dueDate) : null, item.note].filter(Boolean).join(" · ");

  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={canEdit ? selectId : undefined} className="text-sm font-medium">{item.label}</label>
        {canEdit ? (
          <Select id={selectId} value={state} disabled={pending} onChange={(e) => changeState(e.target.value as ReadinessState)} className="h-9 w-auto min-w-36">
            {READINESS_STATES.map((s) => <option key={s} value={s}>{item.states[s]}</option>)}
          </Select>
        ) : (
          <Badge tone={STATE_TONE[item.state]}>{item.stateLabel}</Badge>
        )}
      </div>
      {details && !editing && <p className="mt-0.5 text-xs text-muted">{details}</p>}
      {canEdit && !editing && (
        <button type="button" className="mt-0.5 text-xs text-brand hover:underline" onClick={() => setEditing(true)}>
          {details ? "Edit date or note" : "Add date or note"}
          <span className="sr-only"> for {item.label}</span>
        </button>
      )}
      {editing && (
        <form onSubmit={saveDetails} className="mt-2 space-y-2 rounded-md bg-surface-2 p-3">
          <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={`${item.label} date`} />
            </Field>
            <Field label="Note">
              <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} aria-label={`${item.label} note`} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>Save</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setEditing(false); setDate(item.dueDate ?? ""); setNote(item.note ?? ""); }}>Cancel</Button>
          </div>
        </form>
      )}
      <FormError message={error} />
    </li>
  );
}

/** "Ready to schedule?" checks. They warn on the calendar but never block a booking. */
export function ReadinessChecklist({ projectId, items, canEdit }: { projectId: string; items: ReadinessItem[]; canEdit: boolean }) {
  if (!items.length) return <p className="text-sm text-muted">No readiness checks are set up.</p>;
  return (
    <ul aria-label="Readiness checks" className="divide-y divide-border">
      {items.map((item) => <ReadinessRow key={item.key} projectId={projectId} item={item} canEdit={canEdit} />)}
    </ul>
  );
}

/** "Not before" (e.g. next spring) and office-only scheduling notes. */
export function SchedulingPrefsForm({
  projectId,
  version,
  notBefore,
  schedulingNotes,
  nextSpring,
  canEdit,
}: {
  projectId: string;
  version: number;
  notBefore: IsoDate | null;
  schedulingNotes: string | null;
  /** April 1 of the coming spring. */
  nextSpring: IsoDate;
  canEdit: boolean;
}) {
  const [date, setDate] = useState(notBefore ?? "");
  const [notes, setNotes] = useState(schedulingNotes ?? "");
  const [result, setResult] = useState<ScheduleCardResult | null>(null);
  const [pending, start] = useTransition();

  if (!canEdit) {
    if (!notBefore && !schedulingNotes) return <p className="text-sm text-muted">No scheduling notes.</p>;
    return (
      <div className="space-y-1 text-sm">
        {notBefore && <p>Not before {dayLabel(notBefore)}</p>}
        {schedulingNotes && <p className="whitespace-pre-wrap text-muted">{schedulingNotes}</p>}
      </div>
    );
  }

  const changed = date !== (notBefore ?? "") || notes.trim() !== (schedulingNotes ?? "");
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (date && !isIsoDate(date)) return;
    start(async () => {
      setResult(await saveSchedulingPrefsAction({ projectId, version, notBefore: date || null, schedulingNotes: notes.trim() || null }));
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <Field label="Not before" hint="You'll get a warning if it's booked earlier, e.g. exterior work that has to wait for spring.">
          <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setResult(null); }} className="max-w-48" />
        </Field>
        <div className="mt-1 flex gap-3 text-xs">
          <button type="button" className="text-brand hover:underline" onClick={() => { setDate(nextSpring); setResult(null); }}>Next spring ({dayLabel(nextSpring)})</button>
          {date && <button type="button" className="text-brand hover:underline" onClick={() => { setDate(""); setResult(null); }}>Clear date</button>}
        </div>
      </div>
      <Field label="Scheduling notes (office only)">
        <Textarea rows={3} maxLength={2000} value={notes} onChange={(e) => { setNotes(e.target.value); setResult(null); }} placeholder="e.g. Customer away Nov 2–9; wants the deck done first" />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={pending || !changed}>{pending ? "Saving…" : "Save scheduling details"}</Button>
        {result?.ok && <span role="status" className="text-sm text-success">{result.message}</span>}
      </div>
      {result && !result.ok && <FormError message={result.error} />}
    </form>
  );
}

function ActionButton({
  label,
  question,
  run,
  variant = "secondary",
}: {
  label: string;
  question?: string;
  run: () => Promise<ScheduleCardResult>;
  variant?: "primary" | "secondary" | "danger";
}) {
  const [result, setResult] = useState<ScheduleCardResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant={variant}
        disabled={pending}
        onClick={() => {
          if (question && !window.confirm(question)) return;
          start(async () => setResult(await run()));
        }}
      >
        {pending ? "Saving…" : label}
      </Button>
      {result?.ok && <p role="status" className="text-sm text-success">{result.message}</p>}
      {result && !result.ok && <FormError message={result.error} />}
    </div>
  );
}

/** Shown once the first work day has come and the job is still "Scheduled". Never automatic. */
export function MarkInProgressButton({ projectId }: { projectId: string }) {
  return <ActionButton label="Mark in progress" run={() => markInProgressAction({ projectId })} />;
}

/** For cancelled jobs: take every booking off the calendar at once. */
export function RemoveAllBookingsButton({ projectId, count }: { projectId: string; count: number }) {
  return (
    <ActionButton
      label="Remove all from the calendar"
      variant="danger"
      question={`Take ${count === 1 ? "this booking" : `all ${count} bookings`} off the calendar?`}
      run={() => removeAllBookingsAction({ projectId })}
    />
  );
}
