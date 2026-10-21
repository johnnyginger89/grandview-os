"use client";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { Button, EmptyState, FormError, LinkButton } from "@/components/ui";
import { formatIsoDate } from "@/lib/calendar-date";
import { formatCAD } from "@/lib/money";
import {
  applyFilters,
  applyPatch,
  businessDate,
  followUpInstant,
  groupExcluded,
  groupRows,
  sortRows,
  sumValues,
  type ColumnDef,
  type Ctx,
  type GroupBy,
  type ListFilters,
  type ListSort,
  type PipelineRow,
  type SortKey,
  type StageInfo,
} from "@/lib/pipeline/list-view";
import { assignEstimatorAction, bulkMoveStageAction, moveStageAction, setFollowUpAction } from "./actions";
import { BulkBar } from "./bulk-bar";
import { FollowUpDialog } from "./follow-up-dialog";
import { LeadsCards } from "./leads-cards";
import { LeadsTable, renderedRows } from "./leads-table";
import type { CellContext, Person } from "./list-cells";
import { LostReasonDialog } from "./lost-reason-dialog";

const FLASH_MS = 1500;
const shortDay = (d: string) => formatIsoDate(d, { weekday: "short", month: "short", day: "numeric" });

export function LeadsList({
  rows,
  stages,
  ctx,
  filters,
  sort,
  groupBy,
  columns,
  collapsed,
  onToggleGroup,
  onSort,
  onClearFilters,
  canEdit,
  includeMoney,
  estimators,
  lostReasons,
  onToast,
  onAnnounce,
}: {
  rows: PipelineRow[];
  stages: StageInfo[];
  ctx: Ctx;
  filters: ListFilters;
  sort: ListSort | undefined;
  groupBy: GroupBy;
  columns: ColumnDef[];
  collapsed: string[];
  onToggleGroup: (key: string) => void;
  onSort: (col: SortKey) => void;
  onClearFilters: () => void;
  canEdit: boolean;
  includeMoney: boolean;
  estimators: Person[];
  lostReasons: string[];
  onToast: (message: string, undo?: () => void) => void;
  onAnnounce: (text: string) => void;
}) {
  const [optimistic, addPatch] = useOptimistic(rows, applyPatch);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const [showAll, setShowAll] = useState<Set<string>>(() => new Set());
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  const focusAfterMove = useRef<string | null>(null);
  const [lostAsk, setLostAsk] = useState<{ ids: string[]; stage: StageInfo; row?: PipelineRow } | null>(null);
  const [wonAsk, setWonAsk] = useState<{ ids: string[]; stage: StageInfo } | null>(null);
  const [followUpAsk, setFollowUpAsk] = useState<{ ids: string[]; row?: PipelineRow } | null>(null);

  const filtered = useMemo(() => applyFilters(optimistic, filters, ctx), [optimistic, filters, ctx]);
  const groups = useMemo(() => {
    const all = groupRows(sortRows(filtered, sort, ctx), stages, groupBy, { includeMoney, ctx });
    return all.filter((g) => !g.stage || !groupExcluded(g.stage, filters));
  }, [filtered, sort, ctx, stages, groupBy, includeMoney, filters]);
  // A lone group (e.g. status "Lost") is always open: a single collapsed header would show nothing.
  const canCollapse = groupBy === "stage" && groups.length > 1;
  const collapsedSet = useMemo(() => new Set(canCollapse ? collapsed : []), [collapsed, canCollapse]);
  /** Rows on screen, in order. Bulk actions only ever touch these. */
  const renderedOrder = useMemo(
    () => groups.flatMap((g) => (collapsedSet.has(g.key) ? [] : renderedRows(g, showAll).map((r) => r.id))),
    [groups, collapsedSet, showAll],
  );
  const selected = useMemo(() => {
    const onScreen = new Set(renderedOrder);
    return new Set([...selection].filter((id) => onScreen.has(id)));
  }, [selection, renderedOrder]);
  const openValue = includeMoney ? sumValues(filtered.filter((r) => r.stageKind === "open")).toFixed(2) : null;
  const orderedStages = useMemo(() => [...stages].sort((a, b) => a.position - b.position), [stages]);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  // After an optimistic move the row sits in a new group; keep keyboard focus on its stage control.
  useEffect(() => {
    const id = focusAfterMove.current;
    if (!id) return;
    focusAfterMove.current = null;
    const el = [document.getElementById(`stage-t-${id}`), document.getElementById(`stage-c-${id}`)].find((e) => e && e.offsetParent !== null);
    el?.focus();
  }, [optimistic]);

  useEffect(() => {
    if (!selected.size) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
      setSelection(new Set());
      onAnnounce("Selection cleared");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size, onAnnounce]);

  function flash(id: string) {
    setFlashId(id);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashId(null), FLASH_MS);
  }

  function updateSelection(next: Set<string>) {
    setSelection(next);
    onAnnounce(next.size ? `${next.size} selected` : "Selection cleared");
  }

  function clearSelection() {
    setSelection(new Set());
    anchor.current = null;
  }

  function selectRow(id: string, checked: boolean, shift: boolean) {
    const next = new Set(selected);
    const from = shift && anchor.current ? renderedOrder.indexOf(anchor.current) : -1;
    const to = renderedOrder.indexOf(id);
    if (from >= 0 && to >= 0) {
      const [lo, hi] = from < to ? [from, to] : [to, from];
      for (const x of renderedOrder.slice(lo, hi + 1)) {
        if (checked) next.add(x);
        else next.delete(x);
      }
    } else if (checked) next.add(id);
    else next.delete(id);
    anchor.current = id;
    updateSelection(next);
  }

  function selectGroup(ids: string[], checked: boolean) {
    const next = new Set(selected);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    updateSelection(next);
  }

  function requestStage(row: PipelineRow, stageId: string) {
    const stage = ctx.stagesById.get(stageId);
    if (!stage || stage.id === row.stageId) return;
    if (stage.kind === "lost") setLostAsk({ ids: [row.id], stage, row });
    else moveOne(row, stage);
  }

  function moveOne(row: PipelineRow, stage: StageInfo, lostReason?: string) {
    const prev = ctx.stagesById.get(row.stageId);
    const prevReason = row.lostReason;
    const at = new Date().toISOString();
    const patch = { type: "stage" as const, ids: [row.id], stage, at, lostReason };
    const hidden = applyFilters(applyPatch([row], patch), filters, ctx).length === 0;
    setError(null);
    flash(row.id);
    focusAfterMove.current = row.id;
    startTransition(async () => {
      addPatch(patch);
      const r = await moveStageAction(row.id, stage.id, lostReason);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onToast(`Moved ${row.customerName} to ${stage.name}${hidden ? ". It's now hidden by your filters." : ""}`, prev ? () => undoMove(row, prev, prevReason) : undefined);
    });
  }

  function undoMove(row: PipelineRow, prev: StageInfo, prevReason: string | null) {
    setError(null);
    startTransition(async () => {
      addPatch({ type: "stage", ids: [row.id], stage: prev, at: new Date().toISOString(), lostReason: prevReason });
      // Moving back to Lost restores the reason it had.
      const r = await moveStageAction(row.id, prev.id, prev.kind === "lost" ? (prevReason ?? undefined) : undefined);
      if (!r.ok) setError(r.error);
      else onToast(`Moved ${row.customerName} back to ${prev.name}`);
    });
  }

  function requestBulkMove(stageId: string) {
    const stage = ctx.stagesById.get(stageId);
    const ids = [...selected];
    if (!stage || !ids.length) return;
    if (stage.kind === "lost") setLostAsk({ ids, stage });
    else if (stage.kind === "won") setWonAsk({ ids, stage });
    else bulkMove(ids, stage);
  }

  function bulkMove(ids: string[], stage: StageInfo, lostReason?: string) {
    setError(null);
    startTransition(async () => {
      addPatch({ type: "stage", ids, stage, at: new Date().toISOString(), lostReason });
      const r = await bulkMoveStageAction({ ids, stageId: stage.id, ...(lostReason ? { lostReason } : {}) });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onToast(r.message ?? "Leads moved");
      clearSelection();
    });
  }

  function saveFollowUp(ids: string[], date: string | null, row?: PipelineRow) {
    setFollowUpAsk(null);
    setError(null);
    if (row) flash(row.id);
    startTransition(async () => {
      addPatch({ type: "followUp", ids, at: date ? followUpInstant(date).toISOString() : null });
      const r = await setFollowUpAction({ ids, date });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (row) onToast(date ? `Follow-up for ${row.customerName} set to ${shortDay(date)}` : `Follow-up cleared for ${row.customerName}`);
      else {
        onToast(r.message ?? "Follow-up saved");
        clearSelection();
      }
    });
  }

  function saveEstimator(ids: string[], estimatorId: string | null, row?: PipelineRow) {
    const name = estimatorId ? (estimators.find((e) => e.id === estimatorId)?.name ?? null) : null;
    setError(null);
    startTransition(async () => {
      addPatch({ type: "estimator", ids, estimatorId, estimatorName: name });
      const r = await assignEstimatorAction({ ids, estimatorId });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (row) onToast(name ? `${row.customerName} assigned to ${name}` : `Estimator removed from ${row.customerName}`);
      else {
        onToast(r.message ?? "Estimator updated");
        clearSelection();
      }
    });
  }

  const cellCtx: CellContext = {
    now: ctx.now,
    stages: orderedStages,
    stagesById: ctx.stagesById,
    estimators,
    canEdit,
    onStage: requestStage,
    onFollowUp: (row) => setFollowUpAsk({ ids: [row.id], row }),
    onEstimator: (row, id) => saveEstimator([row.id], id, row),
  };

  const showAllFor = (key: string) => setShowAll((s) => new Set(s).add(key));

  let body;
  if (!optimistic.length) {
    body = (
      <EmptyState
        title="No leads yet"
        description="New inquiries from your website, YouCanBook.me or the New lead button show up here."
        action={canEdit ? <LinkButton href="/leads/new"><Plus className="size-4" aria-hidden /> New lead</LinkButton> : undefined}
      />
    );
  } else if (!filtered.length) {
    body = <EmptyState title="No leads match these filters" description="Try a different search, or clear the filters to see every lead." action={<Button variant="secondary" onClick={onClearFilters}>Clear filters</Button>} />;
  } else {
    body = (
      <>
        <div className="hidden md:block">
          <LeadsTable
            groups={groups}
            columns={columns}
            groupBy={groupBy}
            collapsed={collapsedSet}
            canCollapse={canCollapse}
            onToggleGroup={onToggleGroup}
            showAll={showAll}
            onShowAll={showAllFor}
            sort={sort}
            onSort={onSort}
            ctx={cellCtx}
            selection={canEdit ? { selected, onRow: selectRow, onGroup: selectGroup } : null}
            flashId={flashId}
            footer={{ count: filtered.length, openValue }}
          />
        </div>
        <div className="md:hidden">
          <LeadsCards
            groups={groups}
            groupBy={groupBy}
            collapsed={collapsedSet}
            canCollapse={canCollapse}
            onToggleGroup={onToggleGroup}
            showAll={showAll}
            onShowAll={showAllFor}
            ctx={cellCtx}
            includeMoney={includeMoney}
            flashId={flashId}
          />
          <p className="mt-3 text-center text-xs text-muted">
            {filtered.length} lead{filtered.length === 1 ? "" : "s"}
            {openValue != null && ` · open pipeline ${formatCAD(openValue)}`}
          </p>
        </div>
      </>
    );
  }

  return (
    <div className={canEdit && selected.size ? "space-y-3 md:pb-20" : "space-y-3"}>
      <FormError message={error} />
      {body}
      {canEdit && selected.size > 0 && (
        <BulkBar
          count={selected.size}
          stages={orderedStages}
          estimators={estimators}
          pending={pending}
          onMove={requestBulkMove}
          onFollowUp={() => setFollowUpAsk({ ids: [...selected] })}
          onEstimator={(id) => saveEstimator([...selected], id)}
          onClear={() => updateSelection(new Set())}
        />
      )}
      <LostReasonDialog
        open={!!lostAsk}
        subject={lostAsk?.row?.customerName}
        count={lostAsk?.ids.length ?? 0}
        reasons={lostReasons}
        onCancel={() => setLostAsk(null)}
        onConfirm={(reason) => {
          const ask = lostAsk;
          setLostAsk(null);
          if (!ask) return;
          if (ask.row) moveOne(ask.row, ask.stage, reason);
          else bulkMove(ask.ids, ask.stage, reason);
        }}
      />
      <FollowUpDialog
        open={!!followUpAsk}
        subject={followUpAsk?.row?.customerName}
        count={followUpAsk?.ids.length ?? 0}
        current={followUpAsk?.row?.nextFollowUpAt ? businessDate(followUpAsk.row.nextFollowUpAt) : null}
        onCancel={() => setFollowUpAsk(null)}
        onSave={(date) => followUpAsk && saveFollowUp(followUpAsk.ids, date, followUpAsk.row)}
      />
      <Dialog
        open={!!wonAsk}
        onClose={() => setWonAsk(null)}
        title={`Mark ${wonAsk?.ids.length ?? 0} leads as Won?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setWonAsk(null)}>Cancel</Button>
            <Button
              data-autofocus
              onClick={() => {
                const ask = wonAsk;
                setWonAsk(null);
                if (ask) bulkMove(ask.ids, ask.stage);
              }}
            >
              Mark as Won
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">Won normally comes from an accepted proposal, which also creates the project. Marking leads as Won here doesn&apos;t create a project. Continue?</p>
      </Dialog>
    </div>
  );
}
