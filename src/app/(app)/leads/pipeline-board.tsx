"use client";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { CalendarClock, Eye } from "lucide-react";
import { Button, Select } from "@/components/ui";
import { daysInStage, isFollowUpDue, isStale, type PipelineRow, type StageInfo } from "@/lib/pipeline/list-view";
import { stageTone } from "@/lib/pipeline/stage-colors";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { moveStageAction } from "./actions";

export interface BoardCard {
  id: string;
  number: number | null;
  title: string;
  stageId: string;
  stageChangedAt: string;
  estimateVisitAt: string | null;
  firstViewedAt: string | null;
  nextFollowUpAt: string | null;
  projectTypes: string[];
  estimatedValue: string | null;
  channel: string | null;
  customerName: string;
  city: string | null;
  kind: string;
}

type Stage = Pick<StageInfo, "id" | "key" | "name" | "kind" | "color" | "staleAfterDays">;

/** The board's slice of a list row. Money is already null for roles without estimates.read. */
export function toBoardCard(r: PipelineRow): BoardCard {
  return {
    id: r.id,
    number: r.number,
    title: r.title,
    stageId: r.stageId,
    stageChangedAt: r.stageChangedAt,
    estimateVisitAt: r.estimateVisitAt,
    firstViewedAt: r.firstViewedAt,
    nextFollowUpAt: r.nextFollowUpAt,
    projectTypes: r.projectTypes,
    estimatedValue: r.estimatedValue,
    channel: r.channel,
    customerName: r.customerName,
    city: r.city,
    kind: r.stageKind,
  };
}

export function PipelineBoard({ stages, cards, lostReasons, canEdit, now }: { stages: Stage[]; cards: BoardCard[]; lostReasons: string[]; canEdit: boolean; now?: Date }) {
  const [optimistic, applyMove] = useOptimistic(cards, (state, m: { id: string; stageId: string }) =>
    state.map((c) => (c.id === m.id ? { ...c, stageId: m.stageId, stageChangedAt: new Date().toISOString() } : c)),
  );
  const [, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [pendingLost, setPendingLost] = useState<{ id: string; stageId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function move(id: string, stageId: string, lostReason?: string) {
    startTransition(async () => {
      applyMove({ id, stageId });
      const r = await moveStageAction(id, stageId, lostReason);
      if (!r.ok) setError(r.error);
    });
  }

  function onDrop(stage: Stage, id: string) {
    setDragOver(null);
    const card = optimistic.find((c) => c.id === id);
    if (!card || card.stageId === stage.id) return;
    if (stage.kind === "lost") setPendingLost({ id, stageId: stage.id });
    else move(id, stage.id);
  }

  return (
    <>
      {error && <p className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {pendingLost && (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Why was this lead lost?</span>
            <Select id="lost-reason" defaultValue={lostReasons[0]}>
              {lostReasons.map((r) => <option key={r}>{r}</option>)}
            </Select>
          </label>
          <Button onClick={() => {
            const reason = (document.getElementById("lost-reason") as HTMLSelectElement).value;
            move(pendingLost.id, pendingLost.stageId, reason);
            setPendingLost(null);
          }}>Mark lost</Button>
          <Button variant="ghost" onClick={() => setPendingLost(null)}>Cancel</Button>
        </div>
      )}
      {/* Phones: stacked list. Stage changes happen on the lead page. */}
      <div className="space-y-3 md:hidden">
        {stages.map((stage) => {
          const list = optimistic.filter((c) => c.stageId === stage.id);
          return (
            <section key={stage.id} aria-label={stage.name}>
              <header className="mb-1.5 flex items-center gap-2 px-1">
                <span className={cn("size-2 rounded-full", stageTone(stage.color).dot)} />
                <h2 className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted">{stage.name}</h2>
                <span className="text-xs text-subtle tabular">{list.length}</span>
              </header>
              {list.length > 0 && <div className="flex flex-col gap-2">{list.map((c) => <Card key={c.id} card={c} stage={stage} draggable={false} now={now} />)}</div>}
            </section>
          );
        })}
      </div>
      <div className="-mx-4 hidden overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 md:block lg:-mx-8 lg:px-8">
        <div className="flex gap-3" style={{ minWidth: stages.length * 260 }}>
          {stages.map((stage) => {
            const list = optimistic.filter((c) => c.stageId === stage.id);
            return (
              <section
                key={stage.id}
                aria-label={stage.name}
                onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDragOver(stage.id); } }}
                onDragLeave={() => setDragOver((s) => (s === stage.id ? null : s))}
                onDrop={(e) => onDrop(stage, e.dataTransfer.getData("text/plain"))}
                className={cn("flex w-64 shrink-0 flex-col rounded-lg bg-surface-2 p-2 transition-colors", dragOver === stage.id && "bg-brand-soft ring-2 ring-brand/30")}
              >
                <header className="mb-2 flex items-center gap-2 px-1">
                  <span className={cn("size-2 rounded-full", stageTone(stage.color).dot)} />
                  <h2 className="flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted">{stage.name}</h2>
                  <span className="text-xs text-subtle tabular">{list.length}</span>
                </header>
                <div className="flex min-h-24 flex-col gap-2">
                  {list.map((c) => <Card key={c.id} card={c} stage={stage} draggable={canEdit} now={now} />)}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}

function Card({ card, stage, draggable, now = new Date() }: { card: BoardCard; stage: Stage; draggable: boolean; now?: Date }) {
  const days = daysInStage(card, now);
  const stale = isStale({ stageKind: stage.kind, stageChangedAt: card.stageChangedAt }, stage, now);
  const followUpDue = isFollowUpDue({ stageKind: stage.kind, nextFollowUpAt: card.nextFollowUpAt }, now);
  return (
    <Link
      href={`/leads/${card.id}`}
      draggable={draggable}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", card.id)}
      className={cn(
        "block rounded-md border bg-surface p-3 text-sm shadow-xs transition hover:border-border-strong",
        stale ? "border-danger/40" : "border-border",
      )}
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 font-medium leading-snug text-text">{card.customerName}</p>
        {!card.firstViewedAt && stage.key === "new_lead" && (
          <span className="mt-1 size-2 shrink-0 rounded-full bg-amber-500" title="Not opened yet" />
        )}
      </div>
      <p className="mt-0.5 truncate text-xs text-muted">{[card.projectTypes.join(", "), card.city].filter(Boolean).join(" · ") || "No details yet"}</p>
      {card.estimateVisitAt && stage.kind === "open" && (
        <p className="mt-2 flex items-center gap-1 text-xs text-info"><CalendarClock className="size-3.5" />{formatDateTime(card.estimateVisitAt)}</p>
      )}
      <div className="mt-2 flex items-center justify-between text-xs text-subtle">
        <span className={cn(stale && "font-medium text-danger")}>{days === 0 ? "Today" : `${days}d in stage`}</span>
        {followUpDue && stage.kind === "open" ? <span className="font-medium text-warning">Follow-up due</span> : card.firstViewedAt ? <Eye className="size-3.5" aria-label="Viewed" /> : null}
      </div>
      {stage.kind !== "open" && <p className="mt-1 text-xs text-subtle">{formatDate(card.stageChangedAt)}</p>}
    </Link>
  );
}
