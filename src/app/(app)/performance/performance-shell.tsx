"use client";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition, type ReactNode } from "react";
import { Button, Field, FormError, Input, Select } from "@/components/ui";
import {
  COMPARE_LABELS,
  COMPARE_MODES,
  EARLIEST_CUSTOM_DATE,
  FORCED_LY,
  PERIOD_LABELS,
  PERIOD_PRESETS,
  performanceHref,
  type CompareMode,
  type PeriodPreset,
} from "@/lib/reporting/periods";
import { cn } from "@/lib/utils";

/**
 * The one filter row that scopes the whole page. The URL is the state; while the
 * next period loads, the current numbers stay on screen, dimmed.
 */
export function PerformanceShell({
  preset,
  compare,
  from,
  to,
  today,
  error,
  children,
}: {
  preset: PeriodPreset;
  compare: CompareMode;
  from?: string;
  to?: string;
  today: string;
  error?: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(preset);
  const [customOpen, setCustomOpen] = useState(preset === "custom" || !!error);
  const [customFrom, setCustomFrom] = useState(from ?? "");
  const [customTo, setCustomTo] = useState(to ?? "");
  const forced = FORCED_LY.includes(shown);

  function go(period: PeriodPreset, cmp: CompareMode = compare) {
    startTransition(() => {
      setShown(period);
      router.push(performanceHref({ period, compare: cmp, from: customFrom, to: customTo }), { scroll: false });
    });
  }

  function choose(period: PeriodPreset) {
    if (period === "custom") {
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    go(period);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Date range" data-testid="period-buttons" className="hidden flex-wrap rounded-md border border-border-strong bg-surface p-0.5 lg:inline-flex">
          {PERIOD_PRESETS.map((p) => {
            const active = p === "custom" ? customOpen || shown === "custom" : shown === p && !customOpen;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={active}
                onClick={() => choose(p)}
                className={cn("rounded px-3 py-1.5 text-sm font-medium transition-colors", active ? "bg-brand text-brand-contrast" : "text-muted hover:bg-surface-2 hover:text-text")}
              >
                {PERIOD_LABELS[p]}
              </button>
            );
          })}
        </div>
        <Field label="Period" className="w-full sm:w-48 lg:hidden">
          <Select data-testid="period-select" value={customOpen ? "custom" : shown} onChange={(e) => choose(e.target.value as PeriodPreset)}>
            {PERIOD_PRESETS.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Compare" className="w-full sm:w-56">
          <Select data-testid="compare-select" value={forced ? "ly" : compare} disabled={forced} onChange={(e) => go(shown, e.target.value as CompareMode)}>
            {COMPARE_MODES.map((c) => (
              <option key={c} value={c}>
                {COMPARE_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {customOpen && (
        <form
          className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault();
            go("custom");
          }}
        >
          <Field label="From" className="w-[calc(50%-0.375rem)] sm:w-44">
            <Input type="date" name="from" value={customFrom} min={EARLIEST_CUSTOM_DATE} max={today} required onChange={(e) => setCustomFrom(e.target.value)} />
          </Field>
          <Field label="To" className="w-[calc(50%-0.375rem)] sm:w-44">
            <Input type="date" name="to" value={customTo} min={EARLIEST_CUSTOM_DATE} max={today} required onChange={(e) => setCustomTo(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" disabled={pending}>
            Apply
          </Button>
        </form>
      )}

      {error && (
        <div className="mb-4">
          <FormError message={`${error} Showing this month instead.`} />
        </div>
      )}

      <div aria-busy={pending} className={cn("transition-opacity", pending && "opacity-60")}>
        {children}
      </div>
    </>
  );
}
