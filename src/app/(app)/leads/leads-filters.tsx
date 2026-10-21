"use client";
import { Button, Input, Select } from "@/components/ui";
import { isIsoDate } from "@/lib/calendar-date";
import {
  CHANNEL_LABELS,
  DATE_FIELD_LABELS,
  DATE_FIELDS,
  NONE,
  type ColumnDef,
  type DateField,
  type ListFilters,
  type ListSort,
  type SortKey,
  type StageInfo,
} from "@/lib/pipeline/list-view";
import type { Person } from "./list-cells";

interface Option {
  value: string;
  label: string;
}

function CheckGroup({ legend, options, selected, onChange }: { legend: string; options: Option[]; selected: string[]; onChange: (next: string[]) => void }) {
  const set = new Set(selected);
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-[var(--brand)]"
              checked={set.has(o.value)}
              onChange={(e) => onChange(e.target.checked ? [...selected, o.value] : selected.filter((v) => v !== o.value))}
            />
            <span className="truncate">{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const day = (v: string) => (v && isIsoDate(v) ? v : null);

/** Every filter except search and status, which live in the toolbar. Applies to both the board and the list. */
export function LeadsFilters({
  filters,
  onChange,
  onClearAll,
  stages,
  sources,
  estimators,
  sort,
}: {
  filters: ListFilters;
  onChange: (patch: Partial<ListFilters>) => void;
  onClearAll: () => void;
  stages: StageInfo[];
  sources: string[];
  estimators: Person[];
  /** Phones have no sortable column headers, so the filters offer a sort instead. */
  sort?: { value: ListSort | undefined; columns: ColumnDef[]; onChange: (s: ListSort | undefined) => void };
}) {
  const setDates = (from: string | null, to: string | null) => {
    if (from && to && from > to) [from, to] = [to, from];
    onChange({ from, to });
  };
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <CheckGroup
          legend="Stage"
          options={stages.map((s) => ({ value: s.key, label: s.name }))}
          selected={filters.stages}
          onChange={(stages) => onChange({ stages })}
        />
        <CheckGroup
          legend="Lead source"
          options={[...sources.map((s) => ({ value: s, label: s })), { value: NONE, label: "(none)" }]}
          selected={filters.sources}
          onChange={(sources) => onChange({ sources })}
        />
        <CheckGroup
          legend="Channel"
          options={[...Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label })), { value: NONE, label: "(none)" }]}
          selected={filters.channels}
          onChange={(channels) => onChange({ channels })}
        />
        <CheckGroup
          legend="Estimator"
          options={[...estimators.map((p) => ({ value: p.id, label: p.name })), { value: NONE, label: "Unassigned" }]}
          selected={filters.estimators}
          onChange={(estimators) => onChange({ estimators })}
        />
      </div>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Dates</legend>
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Date to filter by" className="w-44" value={filters.dateField} onChange={(e) => onChange({ dateField: e.target.value as DateField })}>
              {DATE_FIELDS.map((f) => (
                <option key={f} value={f}>{DATE_FIELD_LABELS[f]}</option>
              ))}
            </Select>
            <label className="flex items-center gap-1.5 text-sm">
              From
              <Input type="date" className="w-40" min="2000-01-01" max="2100-12-31" value={filters.from ?? ""} onChange={(e) => setDates(day(e.target.value), filters.to)} />
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              To
              <Input type="date" className="w-40" min="2000-01-01" max="2100-12-31" value={filters.to ?? ""} onChange={(e) => setDates(filters.from, day(e.target.value))} />
            </label>
          </div>
        </fieldset>
        <fieldset className="flex flex-wrap gap-4">
          <legend className="sr-only">Quick filters</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={filters.dueOnly} onChange={(e) => onChange({ dueOnly: e.target.checked })} />
            Follow-up due
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={filters.unopenedOnly} onChange={(e) => onChange({ unopenedOnly: e.target.checked })} />
            Not opened yet
          </label>
        </fieldset>
        {sort && (
          <label className="text-sm">
            <span className="mb-1.5 block font-medium">Sort by</span>
            <Select
              className="w-56"
              value={sort.value ? `${sort.value.col}:${sort.value.dir}` : ""}
              onChange={(e) => {
                const [col, dir] = e.target.value.split(":");
                sort.onChange(col ? { col: col as SortKey, dir: dir === "desc" ? "desc" : "asc" } : undefined);
              }}
            >
              <option value="">Longest in stage first</option>
              {sort.columns
                .filter((c) => c.sortable && c.key !== "stage")
                .flatMap((c) => [
                  <option key={`${c.key}:asc`} value={`${c.key}:asc`}>{c.label} (ascending)</option>,
                  <option key={`${c.key}:desc`} value={`${c.key}:desc`}>{c.label} (descending)</option>,
                ])}
            </Select>
          </label>
        )}
        <Button variant="ghost" onClick={onClearAll} className="ml-auto">Clear all</Button>
      </div>
    </div>
  );
}
