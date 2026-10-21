"use client";
import { CircleCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { Button, FormError } from "@/components/ui";
import { shortDay } from "@/lib/schedule/format";
import type { FinishCandidateDTO } from "@/lib/schedule/types";
import { callAction } from "@/components/schedule/call-action";
import { completeFromScheduleAction } from "./actions";

/**
 * "Finished?": jobs whose last work day was two or more work days ago but are still
 * scheduled or in progress (feasibility review F15). One click marks the job complete
 * with the last booking day as its finish date, so it counts as produced that month.
 */
export function FinishList({ items, onDone }: { items: FinishCandidateDTO[]; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  if (!items.length) return null;

  function complete(item: FinishCandidateDTO) {
    setError(null);
    setBusy(item.projectId);
    start(async () => {
      const r = await callAction(() => completeFromScheduleAction({ projectId: item.projectId }));
      setBusy(null);
      if (!r.ok) setError(r.error);
      else onDone(`#${item.number} marked complete (finished ${shortDay(r.finishDate)}).`);
    });
  }

  return (
    <section aria-labelledby="finish-list-h" data-testid="finish-list" className="rounded-lg border border-info/30 bg-info-soft/40 p-3">
      <h3 id="finish-list-h" className="text-xs font-semibold uppercase tracking-wide text-info">
        Finished? <span className="tabular">({items.length})</span>
      </h3>
      <p className="mt-1 text-xs text-muted">The last work day has passed. Mark these complete so they count as produced.</p>
      <ul className="mt-2 space-y-2">
        {items.map((item) => (
          <li key={item.projectId} data-testid="finish-item" data-project-number={item.number} className="rounded-md bg-surface p-2.5 text-sm shadow-xs">
            <p>
              <span className="font-semibold">#{item.number}</span> <span className="font-medium">{item.customerName}</span>
            </p>
            <p className="text-xs text-muted">
              {item.jobTitle} · last work day {shortDay(item.lastWorkDay)}
            </p>
            <Button size="sm" variant="secondary" className="mt-1.5" onClick={() => complete(item)} disabled={busy !== null}>
              <CircleCheck className="size-4" aria-hidden /> {busy === item.projectId ? "Saving…" : "Mark complete"}
            </Button>
          </li>
        ))}
      </ul>
      <FormError message={error} />
    </section>
  );
}
