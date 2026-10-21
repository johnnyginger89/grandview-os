"use client";
import { X } from "lucide-react";
import { useState } from "react";
import { Button, Select } from "@/components/ui";
import { BULK_LIMIT, type StageInfo } from "@/lib/pipeline/list-view";
import type { Person } from "./list-cells";

/** Sticky bar for changing every selected lead at once (desktop only). */
export function BulkBar({
  count,
  stages,
  estimators,
  pending,
  onMove,
  onFollowUp,
  onEstimator,
  onClear,
}: {
  count: number;
  stages: StageInfo[];
  estimators: Person[];
  pending: boolean;
  onMove: (stageId: string) => void;
  onFollowUp: () => void;
  onEstimator: (estimatorId: string | null) => void;
  onClear: () => void;
}) {
  const [target, setTarget] = useState("");
  const tooMany = count > BULK_LIMIT;
  const disabled = tooMany || pending;
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      data-testid="bulk-bar"
      className="fixed inset-x-0 bottom-0 z-40 hidden justify-center px-4 pb-4 md:flex lg:left-60"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border-strong bg-surface px-4 py-2.5 shadow-lg">
        <span className="text-sm font-medium" data-testid="bulk-count">{count} selected</span>
        {tooMany && <span className="text-sm text-danger">Select {BULK_LIMIT} or fewer</span>}
        <span className="h-6 w-px bg-border" aria-hidden />
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (target) onMove(target);
          }}
        >
          <label htmlFor="bulk-move-to" className="text-sm text-muted">Move to</label>
          <Select id="bulk-move-to" className="h-8 w-44 text-sm" value={target} onChange={(e) => setTarget(e.target.value)} disabled={disabled}>
            <option value="">Choose a stage…</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
          <Button type="submit" size="sm" disabled={disabled || !target}>Apply</Button>
        </form>
        <span className="h-6 w-px bg-border" aria-hidden />
        <Button size="sm" variant="secondary" onClick={onFollowUp} disabled={disabled}>Set follow-up…</Button>
        {estimators.length > 0 && (
          <Select
            aria-label="Set estimator for selected leads"
            className="h-8 w-44 text-sm"
            value=""
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              if (v) onEstimator(v === "__unassign" ? null : v);
            }}
          >
            <option value="">Set estimator…</option>
            <option value="__unassign">Unassigned</option>
            {estimators.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        )}
        <Button size="sm" variant="ghost" onClick={onClear}>
          <X className="size-4" aria-hidden /> Clear
        </Button>
      </div>
    </div>
  );
}
