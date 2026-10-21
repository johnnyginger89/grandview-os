"use client";
import { useOptimistic, useState, useTransition } from "react";
import { setReadinessAction } from "@/app/(app)/schedule/actions";
import { Badge, Button, FormError, Input } from "@/components/ui";
import { isIsoDate } from "@/lib/calendar-date";
import { READINESS_STATES, type ReadinessState } from "@/lib/schedule/constants";
import { shortDay } from "@/lib/schedule/format";
import type { ReadinessItem } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";
import { callAction } from "./call-action";

const isReady = (s: ReadinessState) => s === "done" || s === "not_needed";

/**
 * "Ready to schedule?" checks with one segmented choice per check (pressure washing,
 * colours & paint, colour consult, deposit), plus an optional date and note. Warns,
 * never blocks. Read-only users see the answers only.
 */
export function ReadinessChecklist({
  projectId,
  items,
  canEdit,
  onSaved,
}: {
  projectId: string;
  items: ReadinessItem[];
  canEdit: boolean;
  onSaved?: (message: string) => void;
}) {
  const [shown, setShown] = useOptimistic(items, (state, u: { key: string; state: ReadinessState }) =>
    state.map((i) => (i.key === u.key ? { ...i, state: u.state, stateLabel: i.states[u.state] } : i)),
  );
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [, start] = useTransition();
  const ready = shown.filter((i) => isReady(i.state)).length;

  function choose(item: ReadinessItem, state: ReadinessState) {
    setError(null);
    start(async () => {
      setShown({ key: item.key, state });
      const r = await callAction(() => setReadinessAction({ projectId, checkKey: item.key, state }));
      if (!r.ok) setError(r.error);
      else onSaved?.(`${item.label}: ${item.states[state]}`);
    });
  }

  if (!shown.length) return <p className="text-sm text-muted">No readiness checks are set up.</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="font-medium" data-testid="readiness-summary">Ready {ready}/{shown.length}</span>
        {ready < shown.length && <span className="text-muted"> · still to do: {shown.filter((i) => !isReady(i.state)).map((i) => i.label).join(", ")}</span>}
      </p>
      <ul className="space-y-3">
        {shown.map((item) => (
          <li key={item.key}>
            {canEdit ? (
              <fieldset>
                <legend className="mb-1 flex w-full flex-wrap items-center gap-x-2 text-sm font-medium">
                  {item.label}
                  {(item.dueDate || item.note) && (
                    <span className="font-normal text-muted">
                      {[item.dueDate ? shortDay(item.dueDate) : null, item.note].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </legend>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex flex-wrap overflow-hidden rounded-md border border-border-strong">
                    {READINESS_STATES.map((s) => (
                      <label
                        key={s}
                        className={cn(
                          "cursor-pointer border-r border-border-strong px-2.5 py-1.5 text-xs last:border-r-0 hover:bg-surface-2",
                          "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                          item.state === s && (isReady(s) ? "bg-success-soft font-semibold text-success" : s === "in_progress" ? "bg-info-soft font-semibold text-info" : "bg-surface-2 font-semibold text-text"),
                        )}
                      >
                        <input type="radio" className="sr-only" name={`readiness-${projectId}-${item.key}`} value={s} checked={item.state === s} onChange={() => choose(item, s)} />
                        {item.states[s]}
                      </label>
                    ))}
                  </div>
                  <Button size="sm" variant="ghost" aria-expanded={details === item.key} onClick={() => setDetails(details === item.key ? null : item.key)}>
                    {item.dueDate || item.note ? "Edit date & note" : "Add date & note"}
                  </Button>
                </div>
                {details === item.key && (
                  <ReadinessDetails
                    projectId={projectId}
                    item={item}
                    onDone={(msg) => {
                      setDetails(null);
                      if (msg) onSaved?.(msg);
                    }}
                  />
                )}
              </fieldset>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{item.label}</span>
                <Badge tone={isReady(item.state) ? "success" : item.state === "in_progress" ? "info" : "neutral"}>{item.stateLabel}</Badge>
                {item.dueDate && <span className="text-muted">{shortDay(item.dueDate)}</span>}
                {item.note && <span className="text-muted">{item.note}</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
      <FormError message={error} />
    </div>
  );
}

function ReadinessDetails({ projectId, item, onDone }: { projectId: string; item: ReadinessItem; onDone: (message: string) => void }) {
  const [date, setDate] = useState(item.dueDate ?? "");
  const [note, setNote] = useState(item.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    if (date && !isIsoDate(date)) {
      setError("Pick a valid date or leave it empty.");
      return;
    }
    setError(null);
    start(async () => {
      const r = await callAction(() => setReadinessAction({ projectId, checkKey: item.key, state: item.state, dueDate: date || null, note: note.trim() || null }));
      if (!r.ok) setError(r.error);
      else onDone(`${item.label}: date and note saved`);
    });
  }

  return (
    <div className="mt-2 grid gap-2 rounded-md bg-surface-2 p-3 sm:grid-cols-[10rem_1fr]">
      <label className="text-sm">
        <span className="mb-1 block font-medium">Date</span>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Note</span>
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Paint ordered from the Cloverdale store" />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        <Button size="sm" variant="ghost" onClick={() => onDone("")} disabled={pending}>Cancel</Button>
      </div>
      <div className="sm:col-span-2">
        <FormError message={error} />
      </div>
    </div>
  );
}
