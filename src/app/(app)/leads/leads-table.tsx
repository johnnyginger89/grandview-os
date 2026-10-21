"use client";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight } from "lucide-react";
import { formatCAD } from "@/lib/money";
import { GROUP_RENDER_LIMIT, type ColumnDef, type ColumnKey, type GroupBy, type Group, type ListSort, type PipelineRow, type SortKey } from "@/lib/pipeline/list-view";
import { stageTone } from "@/lib/pipeline/stage-colors";
import { cn } from "@/lib/utils";
import { CellContent, type CellContext } from "./list-cells";

export interface Selection {
  selected: Set<string>;
  onRow: (id: string, checked: boolean, shift: boolean) => void;
  onGroup: (ids: string[], checked: boolean) => void;
}

const plural = (n: number) => `${n} lead${n === 1 ? "" : "s"}`;

export function GroupSummary({ group, className }: { group: Group; className?: string }) {
  return (
    <span className={cn("flex flex-wrap items-center gap-x-1.5 text-xs text-muted", className)}>
      <span data-testid="group-count">{plural(group.count)}</span>
      {group.value != null && <span className="tabular">· {formatCAD(group.value)}</span>}
      {group.stale > 0 && <span className="font-medium text-danger">· {group.stale} stale</span>}
    </span>
  );
}

/** Rows a group renders: all of them once "Show all" is clicked, otherwise the first GROUP_RENDER_LIMIT. */
export function renderedRows(g: Group, showAll: Set<string>): PipelineRow[] {
  return showAll.has(g.key) ? g.rows : g.rows.slice(0, GROUP_RENDER_LIMIT);
}

export function LeadsTable({
  groups,
  columns,
  groupBy,
  collapsed,
  canCollapse,
  onToggleGroup,
  showAll,
  onShowAll,
  sort,
  onSort,
  ctx,
  selection,
  flashId,
  footer,
}: {
  groups: Group[];
  columns: ColumnDef[];
  groupBy: GroupBy;
  collapsed: Set<string>;
  canCollapse: boolean;
  onToggleGroup: (key: string) => void;
  showAll: Set<string>;
  onShowAll: (key: string) => void;
  sort: ListSort | undefined;
  onSort: (col: SortKey) => void;
  ctx: CellContext;
  selection: Selection | null;
  flashId: string | null;
  footer: { count: number; openValue: string | null };
}) {
  const colCount = columns.length + (selection ? 1 : 0);
  // The name column sits right of the 40 px checkbox column when there is one.
  const stickyName = selection ? "left-10" : "left-0";
  const thBase = "border-b border-border bg-surface-2 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-subtle whitespace-nowrap";

  return (
    <div className="max-h-[max(24rem,calc(100dvh-15rem))] overflow-auto rounded-lg border border-border bg-surface" data-testid="leads-table">
      <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
        <caption className="sr-only">Leads. Column headers with buttons are sortable.</caption>
        <thead>
          <tr>
            {selection && (
              <th scope="col" className={cn(thBase, "sticky top-0 left-0 z-30 w-10 min-w-10 max-w-10 px-0")}>
                <span className="sr-only">Select</span>
              </th>
            )}
            {columns.map((c) => {
              const sortable = c.sortable && (c.key !== "stage" || groupBy === "none");
              const active = sortable && sort?.col === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                  title={c.key === "value" ? "Before GST" : undefined}
                  style={{ minWidth: c.widthPx }}
                  className={cn(
                    thBase,
                    "sticky top-0 z-20",
                    c.key === "name" && cn(stickyName, "z-30 shadow-[1px_0_0_var(--border)]"),
                    c.align === "right" && "text-right",
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.key as SortKey)}
                      className={cn("inline-flex items-center gap-1 uppercase hover:text-text", c.align === "right" && "flex-row-reverse", active && "text-text")}
                    >
                      {c.label}
                      {active ? (
                        sort!.dir === "asc" ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />
                      ) : (
                        <ArrowUpDown className="size-3.5 opacity-40" aria-hidden />
                      )}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        {groups.map((g) => {
          const isCollapsed = groupBy === "stage" && collapsed.has(g.key);
          const rows = isCollapsed ? [] : renderedRows(g, showAll);
          const visibleIds = rows.map((r) => r.id);
          const chosen = selection ? visibleIds.filter((id) => selection.selected.has(id)).length : 0;
          const tone = stageTone(g.stage?.color ?? "slate");
          return (
            <tbody key={g.key} id={`grp-${g.key}`}>
              {g.stage && (
                <tr data-testid={`group-${g.key}`}>
                  <th scope="rowgroup" colSpan={colCount} className="border-b border-border bg-surface p-0 text-left font-normal">
                    <div className={cn("sticky left-0 flex w-max items-center gap-2 border-l-4 py-2 pr-4", tone.bar, selection ? "pl-2.5" : "pl-2")}>
                      {selection && (
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--brand)]"
                          aria-label={`Select all leads in ${g.stage.name}`}
                          disabled={!visibleIds.length}
                          checked={visibleIds.length > 0 && chosen === visibleIds.length}
                          ref={(el) => {
                            if (el) el.indeterminate = chosen > 0 && chosen < visibleIds.length;
                          }}
                          onChange={(e) => selection.onGroup(visibleIds, e.target.checked)}
                        />
                      )}
                      <button
                        type="button"
                        aria-expanded={!isCollapsed}
                        disabled={!canCollapse}
                        aria-controls={`grp-${g.key}`}
                        data-testid={`group-toggle-${g.key}`}
                        onClick={() => onToggleGroup(g.key)}
                        className={cn("flex items-center gap-1 rounded text-xs font-semibold uppercase tracking-wide hover:underline", g.count ? tone.text : "text-subtle")}
                      >
                        {isCollapsed ? <ChevronRight className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
                        {g.stage.name}
                        <span className="sr-only"> group</span>
                      </button>
                      <GroupSummary group={g} className={cn(!g.count && "text-subtle")} />
                    </div>
                  </th>
                </tr>
              )}
              {rows.map((r) => (
                <Row key={r.id} row={r} columns={columns} ctx={ctx} selection={selection} stickyName={stickyName} flash={flashId === r.id} />
              ))}
              {!isCollapsed && rows.length < g.rows.length && (
                <tr>
                  <td colSpan={colCount} className="border-b border-border px-3 py-2">
                    <button type="button" onClick={() => onShowAll(g.key)} className="sticky left-3 text-sm font-medium text-brand hover:underline">
                      Show all {g.rows.length}
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}
        <tfoot>
          <tr>
            <td colSpan={colCount} className="sticky bottom-0 z-20 border-t border-border bg-surface-2 px-3 py-2 text-xs text-muted">
              <span className="sticky left-3" data-testid="leads-footer">
                {plural(footer.count)}
                {footer.openValue != null && <span className="tabular"> · open pipeline {formatCAD(footer.openValue)}</span>}
              </span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Row({
  row,
  columns,
  ctx,
  selection,
  stickyName,
  flash,
}: {
  row: PipelineRow;
  columns: ColumnDef[];
  ctx: CellContext;
  selection: Selection | null;
  stickyName: string;
  flash: boolean;
}) {
  const selected = !!selection?.selected.has(row.id);
  // Sticky cells need an opaque background of their own, matching the row's.
  const bg = flash ? "bg-brand-soft" : selected ? "bg-surface-2" : "bg-surface group-hover/row:bg-surface-2";
  const td = "border-b border-border px-3 py-1.5 align-middle whitespace-nowrap";
  return (
    <tr className={cn("group/row transition-colors duration-700", bg)} data-testid="lead-row" data-lead-id={row.id}>
      {selection && (
        <td className={cn(td, bg, "sticky left-0 z-10 w-10 min-w-10 max-w-10 px-0 text-center")}>
          <input
            type="checkbox"
            className="size-4 accent-[var(--brand)]"
            aria-label={`Select ${row.customerName}`}
            checked={selected}
            onClick={(e) => selection.onRow(row.id, e.currentTarget.checked, e.shiftKey)}
            onChange={() => {}}
          />
        </td>
      )}
      {columns.map((c) => (
        <td
          key={c.key}
          className={cn(
            td,
            c.key === "name" && cn(bg, stickyName, "sticky z-10 max-w-80 shadow-[1px_0_0_var(--border)]"),
            c.align === "right" && "text-right",
          )}
        >
          <CellContent col={c.key as ColumnKey} row={row} ctx={ctx} />
        </td>
      ))}
    </tr>
  );
}
