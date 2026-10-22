"use client";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { Dialog } from "@/components/dialog";
import { Button, PageHeader } from "@/components/ui";
import { formatIsoDate } from "@/lib/calendar-date";
import {
  activeFilterCount,
  applyFilters,
  channelName,
  DATE_FIELD_LABELS,
  DEFAULT_FILTERS,
  LIST_ROW_LIMIT,
  NONE,
  setColumnVisible,
  toSearchParams,
  visibleColumns,
  type ClosedWindow,
  type ColumnKey,
  type Ctx,
  type GroupBy,
  type ListFilters,
  type ListPrefs,
  type ListSort,
  type ListState,
  type PipelineRow,
  type SortKey,
  type StageInfo,
  type ViewMode,
} from "@/lib/pipeline/list-view";
import { writeListPrefsCookie } from "@/lib/pipeline/prefs-cookie";
import { ColumnsDialog } from "./columns-dialog";
import { LeadsFilters } from "./leads-filters";
import { LeadsList } from "./leads-list";
import { LeadsToolbar, type Chip } from "./leads-toolbar";
import type { Person } from "./list-cells";
import { PipelineBoard, toBoardCard } from "./pipeline-board";

const TOAST_MS = 8000;
const WINDOW_TEXT: Record<ClosedWindow, string> = { "30d": "the last 30 days", "90d": "the last 90 days", "365d": "the last 12 months", all: "all dates" };

interface Toast {
  id: number;
  message: string;
  undo?: () => void;
}

function withoutKey<T extends object, K extends keyof T>(o: T, key: K): Omit<T, K> {
  const copy = { ...o };
  delete copy[key];
  return copy;
}

/**
 * Leads: one set of rows shown as the board or the list. Search, filters
 * and sort run in the browser and live in the URL; the view, columns, collapsed
 * groups and default sort are remembered in a cookie on this computer.
 */
export function LeadsWorkspace({
  initialView,
  initialState,
  initialPrefs,
  rows,
  truncated,
  stages,
  lostReasons,
  leadSources,
  estimators,
  canEdit,
  includeMoney,
  nowIso,
  headerActions,
  notice,
}: {
  initialView: ViewMode;
  initialState: ListState;
  initialPrefs: ListPrefs;
  rows: PipelineRow[];
  truncated: boolean;
  stages: StageInfo[];
  lostReasons: string[];
  leadSources: string[];
  estimators: Person[];
  canEdit: boolean;
  includeMoney: boolean;
  nowIso: string;
  headerActions?: ReactNode;
  /** Shown under the page title, e.g. web leads that couldn't be imported. */
  notice?: ReactNode;
}) {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>(initialView);
  // The view only goes into the URL once it was in the link or the user picked one.
  const [urlView, setUrlView] = useState<ViewMode | undefined>(initialState.view);
  const [closed, setClosed] = useState<ClosedWindow>(initialState.closed);
  const [filters, setFilters] = useState<ListFilters>(initialState.filters);
  const [sort, setSort] = useState<ListSort | undefined>(initialState.sort ?? initialPrefs.sort);
  const [group, setGroup] = useState<GroupBy>(initialState.group ?? initialPrefs.group ?? "stage");
  const [prefs, setPrefs] = useState<ListPrefs>(initialPrefs);
  const [filtersPanel, setFiltersPanel] = useState(false);
  const [filtersDialog, setFiltersDialog] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [closedPending, startClosed] = useTransition();

  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const ctx: Ctx = useMemo(() => ({ now, stagesById: new Map(stages.map((s) => [s.id, s])) }), [now, stages]);
  const deferredQ = useDeferredValue(filters.q);
  const effectiveFilters = useMemo(() => ({ ...filters, q: deferredQ }), [filters, deferredQ]);
  const orderedStages = useMemo(() => [...stages].sort((a, b) => a.position - b.position), [stages]);

  const listState = (over: Partial<ListState> = {}): ListState => ({
    view: urlView,
    closed,
    filters,
    sort,
    group: group === "none" ? "none" : undefined,
    ...over,
  });
  const search = toSearchParams(listState()).toString();

  // Keep the URL shareable without a server round trip; typing in search is debounced.
  const lastQ = useRef(filters.q);
  useEffect(() => {
    if (closedPending) return;
    const typing = lastQ.current !== filters.q;
    lastQ.current = filters.q;
    const t = window.setTimeout(() => {
      const url = search ? `/leads?${search}` : "/leads";
      if (window.location.pathname === "/leads" && window.location.pathname + window.location.search !== url) window.history.replaceState(null, "", url);
    }, typing ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [search, filters.q, closedPending]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [toast]);

  const showToast = useCallback((message: string, undo?: () => void) => setToast({ id: Date.now(), message, undo }), []);

  function savePrefs(next: ListPrefs) {
    setPrefs(next);
    writeListPrefsCookie(next);
  }

  function changeView(v: ViewMode) {
    setView(v);
    setUrlView(v);
    savePrefs({ ...prefs, view: v });
  }

  function changeClosed(w: ClosedWindow) {
    setClosed(w);
    const s = toSearchParams(listState({ closed: w })).toString();
    // The only filter that needs the server: it decides which won/lost leads are loaded.
    startClosed(() => router.replace(s ? `/leads?${s}` : "/leads", { scroll: false }));
  }

  function changeSort(next: ListSort | undefined) {
    setSort(next);
    savePrefs(next ? { ...prefs, sort: next } : withoutKey(prefs, "sort"));
  }

  function cycleSort(col: SortKey) {
    changeSort(sort?.col !== col ? { col, dir: "asc" } : sort.dir === "asc" ? { col, dir: "desc" } : undefined);
  }

  function changeGroup(g: GroupBy) {
    setGroup(g);
    savePrefs({ ...prefs, group: g });
  }

  const collapsed = useMemo(() => prefs.collapsed ?? stages.filter((s) => s.kind !== "open").map((s) => s.key), [prefs.collapsed, stages]);
  function toggleGroup(key: string) {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    savePrefs({ ...prefs, collapsed: [...next] });
  }

  const updateFilters = (patch: Partial<ListFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const clearAll = () => setFilters(DEFAULT_FILTERS);

  const columns = useMemo(() => visibleColumns(prefs, { includeMoney }), [prefs, includeMoney]);

  const estimatorOptions = useMemo(() => {
    const byId = new Map(estimators.map((e) => [e.id, e.name]));
    for (const r of rows) if (r.estimatorId && !byId.has(r.estimatorId)) byId.set(r.estimatorId, r.estimatorName ?? "Former team member");
    return [...byId].map(([id, name]) => ({ id, name }));
  }, [estimators, rows]);

  const sourceOptions = useMemo(() => {
    const known = new Set(leadSources);
    const extra = [...new Set(rows.map((r) => r.source).filter((s): s is string => !!s && !known.has(s)))].sort();
    return [...leadSources, ...extra];
  }, [leadSources, rows]);

  const chips: Chip[] = [];
  const drop = <K extends "stages" | "sources" | "channels" | "estimators">(k: K, v: string) => () => updateFilters({ [k]: filters[k].filter((x) => x !== v) } as Partial<ListFilters>);
  for (const k of filters.stages) chips.push({ key: `stage:${k}`, label: `Stage: ${stages.find((s) => s.key === k)?.name ?? k}`, onRemove: drop("stages", k) });
  for (const v of filters.sources) chips.push({ key: `source:${v}`, label: `Source: ${v === NONE ? "(none)" : v}`, onRemove: drop("sources", v) });
  for (const v of filters.channels) chips.push({ key: `channel:${v}`, label: `Channel: ${v === NONE ? "(none)" : channelName(v)}`, onRemove: drop("channels", v) });
  for (const v of filters.estimators) {
    const name = v === NONE ? "Unassigned" : (estimatorOptions.find((e) => e.id === v)?.name ?? "Unknown");
    chips.push({ key: `estimator:${v}`, label: `Estimator: ${name}`, onRemove: drop("estimators", v) });
  }
  if (filters.from || filters.to) {
    const fmt = (d: string | null) => (d ? formatIsoDate(d, { month: "short", day: "numeric", year: "numeric" }) : "…");
    chips.push({ key: "dates", label: `${DATE_FIELD_LABELS[filters.dateField]}: ${fmt(filters.from)} – ${fmt(filters.to)}`, onRemove: () => updateFilters({ from: null, to: null }) });
  }
  if (filters.dueOnly) chips.push({ key: "due", label: "Follow-up due", onRemove: () => updateFilters({ dueOnly: false }) });
  if (filters.unopenedOnly) chips.push({ key: "unopened", label: "Not opened yet", onRemove: () => updateFilters({ unopenedOnly: false }) });

  function toggleFilters() {
    if (window.matchMedia("(min-width: 768px)").matches) setFiltersPanel((o) => !o);
    else setFiltersDialog(true);
  }

  const boardCards = useMemo(
    () => (view === "board" ? applyFilters(rows, effectiveFilters, ctx).map(toBoardCard) : []),
    [view, rows, effectiveFilters, ctx],
  );

  const intro =
    view === "board"
      ? "Drag cards between stages, or change the stage on the lead."
      : canEdit
        ? "Change a stage or follow-up right in the table."
        : "Every lead in one table. Search, sort and filter to find one fast.";

  const filterProps = { filters, onChange: updateFilters, onClearAll: clearAll, stages: orderedStages, sources: sourceOptions, estimators: estimatorOptions };

  return (
    <>
      <PageHeader title="Leads" description={`${intro} Won and lost show ${WINDOW_TEXT[closed]}.`} actions={headerActions} />
      {notice}
      <LeadsToolbar
        view={view}
        onView={changeView}
        q={filters.q}
        onQ={(q) => updateFilters({ q })}
        status={filters.status}
        onStatus={(status) => updateFilters({ status })}
        closed={closed}
        onClosed={changeClosed}
        closedPending={closedPending}
        filterCount={activeFilterCount(filters)}
        filtersOpen={filtersPanel || filtersDialog}
        onToggleFilters={toggleFilters}
        onOpenColumns={() => setColumnsOpen(true)}
        chips={chips}
        onClearAll={clearAll}
      />
      {filtersPanel && (
        <section aria-label="Filters" className="mb-4 hidden rounded-lg border border-border bg-surface p-4 md:block">
          <LeadsFilters {...filterProps} />
        </section>
      )}
      {truncated && (
        <p className="mb-3 rounded-md bg-info-soft px-3 py-2 text-sm text-info">
          Showing the first {LIST_ROW_LIMIT.toLocaleString("en-CA")} leads. Choose a shorter Won/lost period to see everything.
        </p>
      )}

      {view === "board" ? (
        <PipelineBoard stages={orderedStages} cards={boardCards} lostReasons={lostReasons} canEdit={canEdit} now={now} />
      ) : (
        <LeadsList
          rows={rows}
          stages={orderedStages}
          ctx={ctx}
          filters={effectiveFilters}
          sort={sort}
          groupBy={group}
          columns={columns}
          collapsed={collapsed}
          onToggleGroup={toggleGroup}
          onSort={cycleSort}
          onClearFilters={clearAll}
          canEdit={canEdit}
          includeMoney={includeMoney}
          estimators={estimators}
          lostReasons={lostReasons}
          onToast={showToast}
          onAnnounce={setAnnouncement}
        />
      )}

      <Dialog
        open={filtersDialog}
        onClose={() => setFiltersDialog(false)}
        title="Filters"
        className="h-dvh max-h-dvh w-screen max-w-none rounded-none border-0"
        footer={<Button onClick={() => setFiltersDialog(false)} data-autofocus>Show leads</Button>}
      >
        <LeadsFilters {...filterProps} sort={view === "list" ? { value: sort, columns, onChange: changeSort } : undefined} />
      </Dialog>
      <ColumnsDialog
        open={columnsOpen}
        onClose={() => setColumnsOpen(false)}
        prefs={prefs}
        includeMoney={includeMoney}
        group={group}
        onToggle={(key: ColumnKey, visible: boolean) => savePrefs(setColumnVisible(prefs, key, visible))}
        onGroup={changeGroup}
        onReset={() => {
          setGroup("stage");
          savePrefs({ ...withoutKey(prefs, "group"), hidden: [], shown: [] });
        }}
      />

      <p aria-live="polite" className="sr-only">{announcement}</p>
      <div role="status" className="pointer-events-none fixed right-4 bottom-[calc(var(--app-bottom)+1rem)] z-50 md:bottom-[calc(var(--app-bottom)+5rem)]" data-testid="leads-toast">
        {toast && (
          <div key={toast.id} className="pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg bg-navy px-4 py-3 text-sm text-white shadow-lg">
            <span>{toast.message}</span>
            {toast.undo && (
              <button
                type="button"
                className="rounded px-1 font-semibold underline underline-offset-2 hover:no-underline"
                onClick={() => {
                  const undo = toast.undo;
                  setToast(null);
                  undo?.();
                }}
              >
                Undo
              </button>
            )}
            <button type="button" aria-label="Dismiss" className="-mr-1 rounded p-1 text-white/80 hover:text-white" onClick={() => setToast(null)}>
              <X className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
