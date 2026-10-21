"use client";
import { Columns3, Kanban, List, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Input, Select } from "@/components/ui";
import { CLOSED_WINDOW_LABELS, CLOSED_WINDOWS, STATUS_FILTERS, type ClosedWindow, type StatusFilter, type ViewMode } from "@/lib/pipeline/list-view";
import { cn } from "@/lib/utils";

export interface Chip {
  key: string;
  label: string;
  onRemove: () => void;
}

const STATUS_LABELS: Record<StatusFilter, string> = { all: "All", open: "Open", won: "Won", lost: "Lost" };

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

function Segmented<T extends string>({ label, options, value, onChange, testId }: { label: string; options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; testId?: string }) {
  return (
    <div role="group" aria-label={label} data-testid={testId} className="inline-flex rounded-md border border-border-strong bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded px-3 text-sm font-medium transition-colors",
            value === o.value ? "bg-brand text-brand-contrast" : "text-muted hover:bg-surface-2 hover:text-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function LeadsToolbar({
  view,
  onView,
  q,
  onQ,
  status,
  onStatus,
  closed,
  onClosed,
  closedPending,
  filterCount,
  filtersOpen,
  onToggleFilters,
  onOpenColumns,
  chips,
  onClearAll,
}: {
  view: ViewMode;
  onView: (v: ViewMode) => void;
  q: string;
  onQ: (q: string) => void;
  status: StatusFilter;
  onStatus: (s: StatusFilter) => void;
  closed: ClosedWindow;
  onClosed: (w: ClosedWindow) => void;
  closedPending: boolean;
  filterCount: number;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  onOpenColumns: () => void;
  chips: Chip[];
  onClearAll: () => void;
}) {
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector("dialog[open]")) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="mb-4 space-y-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="View"
          testId="view-toggle"
          value={view}
          onChange={onView}
          options={[
            { value: "board", label: <><Kanban className="size-4" aria-hidden />Board</> },
            { value: "list", label: <><List className="size-4" aria-hidden />List</> },
          ]}
        />
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input
            ref={search}
            data-page-search=""
            type="search"
            aria-label="Search leads"
            placeholder="Search name, phone, email, city, #…"
            className="h-9 pr-9 pl-9"
            value={q}
            maxLength={100}
            onChange={(e) => onQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && q) {
                e.preventDefault();
                onQ("");
              }
            }}
          />
          <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border border-border px-1.5 text-xs text-subtle md:block" aria-hidden>/</kbd>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Status" testId="status-filter" value={status} onChange={onStatus} options={STATUS_FILTERS.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} />
        <label className="flex items-center gap-2 text-sm text-muted">
          <span className="whitespace-nowrap">Won/lost from</span>
          <Select className="h-9 w-40" value={closed} onChange={(e) => onClosed(e.target.value as ClosedWindow)} aria-busy={closedPending || undefined}>
            {CLOSED_WINDOWS.map((w) => (
              <option key={w} value={w}>{CLOSED_WINDOW_LABELS[w]}</option>
            ))}
          </Select>
          {closedPending && <Loader2 className="size-4 animate-spin" aria-label="Loading" />}
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            aria-expanded={filtersOpen}
            onClick={onToggleFilters}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium",
              filterCount ? "border-brand bg-brand-soft text-brand" : "border-border-strong bg-surface text-text hover:bg-surface-2",
            )}
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            Filters
            {filterCount > 0 && <span className="tabular">· {filterCount}</span>}
          </button>
          {view === "list" && (
            <button type="button" onClick={onOpenColumns} className="hidden h-9 items-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-sm font-medium hover:bg-surface-2 md:inline-flex">
              <Columns3 className="size-4" aria-hidden />
              Columns
            </button>
          )}
        </div>
      </div>
      {chips.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {chips.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                onClick={c.onRemove}
                aria-label={`Remove filter ${c.label}`}
                className="inline-flex items-center gap-1 rounded-full bg-brand-soft py-0.5 pr-1.5 pl-2.5 text-xs font-medium text-brand hover:bg-brand-soft/70"
              >
                {c.label}
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={onClearAll} className="px-1.5 text-xs font-medium text-muted hover:text-text hover:underline">
              Clear all
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
