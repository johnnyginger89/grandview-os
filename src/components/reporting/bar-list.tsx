import type { ReactNode } from "react";

export interface BarItem {
  key: string;
  label: string;
  /** Bar length only; the shown figure is `display`. */
  value: number;
  display: string;
  sub?: ReactNode;
  color?: string;
  title?: string;
}

/** Horizontal bars with the value at each bar's tip, so no tooltip is needed. */
export function BarList({ items, ariaLabel, empty = "Nothing in this period.", color = "var(--chart-sales)" }: { items: BarItem[]; ariaLabel: string; empty?: string; color?: string }) {
  if (items.length === 0) return <p className="px-4 py-8 text-center text-sm text-muted">{empty}</p>;
  const max = Math.max(...items.map((i) => i.value), 0);
  return (
    <ul role="list" aria-label={ariaLabel} className="space-y-3 px-4 py-3">
      {items.map((i) => (
        <li key={i.key} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-text" title={i.title ?? i.label}>
              {i.label}
            </span>
            {i.sub && <span className="shrink-0 text-xs text-muted tabular">{i.sub}</span>}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div
              aria-hidden
              className="h-2.5 shrink-0 rounded-r-[4px]"
              style={{ width: `${max > 0 ? (i.value / max) * 85 : 0}%`, minWidth: i.value > 0 ? 2 : 0, background: i.color ?? color }}
            />
            <span className="text-xs font-semibold text-text tabular">{i.display}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
