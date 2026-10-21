"use client";
import { useState, useTransition, type FormEvent } from "react";
import { Button, Card, CardHeader, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import type { ProjectStatus } from "@/db/schema/projects";
import { formatIsoDate, isIsoDate, type IsoDate } from "@/lib/calendar-date";
import { changeProjectStatusAction, setCompletionDateAction, type StatusActionResult } from "./status-actions";

export interface StatusOption {
  value: ProjectStatus;
  label: string;
  /** Finished statuses (complete, invoiced, job costed) count as produced. */
  done: boolean;
}

export interface StatusHistoryEntry {
  id: string;
  change: string;
  when: string;
  by: string | null;
  note: string | null;
}

const NOTE_MAX = 500;
const monthOf = (iso: IsoDate) => formatIsoDate(iso, { month: "long", year: "numeric" });

function ProducedHint({ date }: { date: string }) {
  return <p className="mt-1 text-xs text-muted">{isIsoDate(date) ? `Counts as produced in ${monthOf(date)}.` : "Pick the day the job finished."}</p>;
}

export function StatusControl({
  projectId,
  status,
  options,
  soldDate,
  completedDate,
  cancelledDate,
  today,
  history,
}: {
  projectId: string;
  status: ProjectStatus;
  options: StatusOption[];
  soldDate: IsoDate;
  completedDate: IsoDate | null;
  cancelledDate: IsoDate | null;
  today: IsoDate;
  history: StatusHistoryEntry[];
}) {
  const [to, setTo] = useState<ProjectStatus>(status);
  const [date, setDate] = useState<string>(today);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [finishDate, setFinishDate] = useState<string>(completedDate ?? today);
  const [result, setResult] = useState<StatusActionResult | null>(null);
  const [pending, start] = useTransition();

  const isDone = (s: ProjectStatus) => options.some((o) => o.value === s && o.done);
  const finished = completedDate !== null;
  const changed = to !== status;
  const needsFinishDate = changed && isDone(to) && !finished;
  const cancelling = changed && to === "cancelled";
  const cancelBlocked = cancelling && finished;
  const reopening = changed && finished && !isDone(to) && to !== "cancelled";
  const canSave = changed && !cancelBlocked && !pending && (!needsFinishDate || isIsoDate(date)) && (!cancelling || note.trim().length > 0);

  const run = (call: () => Promise<StatusActionResult>, after?: () => void) =>
    start(async () => {
      const r = await call();
      setResult(r);
      if (r.ok) after?.();
    });

  const saveStatus = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSave) return;
    if (cancelling && !confirm("Cancel this job? It will be taken out of the backlog.")) return;
    if (reopening && completedDate && !confirm(`This job will no longer count as produced in ${monthOf(completedDate)}. Continue?`)) return;
    run(
      () => changeProjectStatusAction({ projectId, status: to, effectiveDate: needsFinishDate ? date : undefined, note: note.trim() || undefined }),
      () => setNote(""),
    );
  };

  const saveFinishDate = () => {
    if (!isIsoDate(finishDate)) return;
    run(() => setCompletionDateAction({ projectId, date: finishDate }), () => setEditing(false));
  };

  return (
    <Card>
      <CardHeader title="Status" description={`Sold ${formatIsoDate(soldDate)}`} />
      <div className="space-y-4 p-4">
        {finished && (
          editing ? (
            <div className="space-y-2 rounded-md bg-surface-2 p-3">
              <Field label="Finish date">
                <Input type="date" min={soldDate} max={today} value={finishDate} onChange={(e) => setFinishDate(e.target.value)} className="max-w-48" />
              </Field>
              <ProducedHint date={finishDate} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={saveFinishDate} disabled={pending || !isIsoDate(finishDate)}>Save finish date</Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setFinishDate(completedDate); }} disabled={pending}>Keep date</Button>
              </div>
            </div>
          ) : (
            <p className="text-sm">
              Finished {formatIsoDate(completedDate)} ·{" "}
              <button type="button" className="text-brand hover:underline" aria-label="Edit finish date" onClick={() => { setEditing(true); setResult(null); }}>Edit</button>
            </p>
          )
        )}
        {status === "cancelled" && cancelledDate && <p className="text-sm">Cancelled {formatIsoDate(cancelledDate)}</p>}

        <form onSubmit={saveStatus} className="space-y-3">
          <Field label="Project status">
            <Select value={to} onChange={(e) => { setTo(e.target.value as ProjectStatus); setResult(null); }} className="max-w-xs">
              {options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </Field>

          {needsFinishDate && (
            <div>
              <Field label="Finish date">
                <Input type="date" min={soldDate} max={today} value={date} onChange={(e) => setDate(e.target.value)} className="max-w-48" />
              </Field>
              <ProducedHint date={date} />
            </div>
          )}
          {cancelBlocked && <FormError message="This job is marked as finished. Reopen it first if it wasn't actually finished." />}
          {reopening && completedDate && (
            <p className="text-sm text-warning">This job will no longer count as produced in {monthOf(completedDate)}.</p>
          )}
          {changed && !cancelBlocked && (
            <Field label={cancelling ? "Reason for cancelling" : "Note (optional)"}>
              <Textarea rows={2} maxLength={NOTE_MAX} required={cancelling} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!canSave}>{pending ? "Saving…" : "Save status"}</Button>
            {result?.ok && <span role="status" className="text-sm text-success">{result.message}</span>}
          </div>
          {result && !result.ok && <FormError message={result.error} />}
        </form>
      </div>

      {history.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-subtle">Status history</h3>
          <ol aria-label="Status history" className="mt-2 space-y-1.5 text-sm">
            {history.map((h) => (
              <li key={h.id}>
                <span className="font-medium">{h.change}</span>
                <span className="text-muted"> · {h.when}{h.by ? ` · ${h.by}` : ""}</span>
                {h.note && <span className="block text-xs text-muted">{h.note}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}
