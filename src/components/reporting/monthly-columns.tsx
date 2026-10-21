import { Table, td, th } from "@/components/ui";
import type { MonthPoint } from "@/lib/reporting/types";
import { cn } from "@/lib/utils";

export interface MonthlySeries {
  key: string;
  label: string;
  /** A chart colour token, e.g. "var(--chart-sales)". */
  color: string;
  /** Pixel geometry only. */
  values: number[];
  display: string[];
}

export interface MonthlyGoal {
  values: (number | null)[];
  display: (string | null)[];
  /** First series as a share of the goal, formatted ("101%"). */
  pctOfGoal: (string | null)[];
}

interface ChartProps {
  months: MonthPoint[];
  series: MonthlySeries[];
  goal?: MonthlyGoal;
  ticks: { value: number; label: string }[];
  title: string;
}

const pctOf = (v: number, max: number) => (max > 0 ? Math.min(100, (v / max) * 100) : 0);
const monthName = (m: MonthPoint) => `${m.label} ${m.year}`;

function readout(p: ChartProps, i: number): string {
  const parts = p.series.map((s) => `${s.label} ${s.display[i]}`);
  if (p.goal?.display[i]) parts.push(`Goal ${p.goal.display[i]}`, `${p.goal.pctOfGoal[i]} of goal`);
  return `${monthName(p.months[i])}: ${parts.join(", ")}`;
}

export function MonthlyLegend({ series, goal }: { series: MonthlySeries[]; goal: boolean }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
      {series.map((s) => (
        <li key={`legend-${s.key}`} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
      {goal && (
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3.5 rounded-full bg-chart-goal" />
          Goal
        </li>
      )}
    </ul>
  );
}

/**
 * Twelve months of grouped columns, drawn with CSS so it renders on the server
 * at any width. Each month is focusable and shows every series on hover or focus.
 * Phones get one row per month instead, which doubles as the table.
 */
export function MonthlyColumns(p: ChartProps) {
  const max = p.ticks[p.ticks.length - 1]?.value ?? 0;
  const last = p.months.length - 1;
  return (
    <div className="px-4 pb-4 pt-3">
      <MonthlyLegend series={p.series} goal={!!p.goal} />

      <div data-testid="monthly-chart" className="mt-4 hidden md:block" role="group" aria-label={p.title}>
        <div className="relative ml-12 h-56">
          {p.ticks.map((t) => (
            <div key={`tick-${t.value}`} aria-hidden className="absolute inset-x-0 border-t border-chart-grid" style={{ bottom: `${pctOf(t.value, max)}%` }}>
              <span className="absolute right-full mr-2 -translate-y-1/2 text-[11px] text-muted tabular">{t.label}</span>
            </div>
          ))}
          <div className="absolute inset-0 flex">
            {p.months.map((m, i) => {
              const top = Math.max(...p.series.map((s) => pctOf(s.values[i], max)));
              const goal = p.goal?.values[i];
              return (
                <div
                  key={m.key}
                  tabIndex={0}
                  role="img"
                  aria-label={readout(p, i)}
                  className={cn("group relative flex h-full flex-1 items-end justify-center gap-[2px] outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring", m.inPeriod && "bg-chart-band")}
                >
                  {p.series.map((s, si) => (
                    <div key={`bar-${s.key}`} className="relative flex h-full items-end" style={{ width: "min(24px, 32%)" }}>
                      <div className="w-full rounded-t-[4px]" style={{ height: `${pctOf(s.values[i], max)}%`, minHeight: s.values[i] > 0 ? 2 : 0, background: s.color }} />
                      {i === last && si === 0 && s.values[i] > 0 && (
                        <span aria-hidden className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold text-text tabular" style={{ bottom: `calc(${top}% + 4px)` }}>
                          {s.display[i]}
                        </span>
                      )}
                    </div>
                  ))}
                  {goal !== null && goal !== undefined && (
                    <div aria-hidden className="pointer-events-none absolute left-1/2 h-0.5 -translate-x-1/2 rounded-full bg-chart-goal" style={{ bottom: `${pctOf(goal, max)}%`, width: "min(64px, 84%)" }} />
                  )}
                  <span aria-hidden className="absolute top-full mt-1.5 w-full text-center text-xs leading-tight text-muted">
                    {m.label}
                    {(i === 0 || m.label === "Jan") && <span className="block text-[11px] text-subtle">{m.year}</span>}
                  </span>
                  <div
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute top-2 z-20 hidden w-48 rounded-md border border-border bg-surface p-2.5 text-xs shadow-lg group-hover:block group-focus:block",
                      i < p.months.length / 2 ? "left-full ml-1" : "right-full mr-1",
                    )}
                  >
                    <p className="mb-1.5 font-medium text-text">{monthName(m)}</p>
                    {p.series.map((s) => (
                      <p key={`tip-${s.key}`} className="flex items-center gap-2">
                        <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
                        <span className="font-semibold text-text tabular">{s.display[i]}</span>
                        <span className="text-muted">{s.label}</span>
                      </p>
                    ))}
                    {p.goal?.display[i] && (
                      <>
                        <p className="flex items-center gap-2">
                          <span className="h-0.5 w-3 shrink-0 rounded-full bg-chart-goal" />
                          <span className="font-semibold text-text tabular">{p.goal.display[i]}</span>
                          <span className="text-muted">Goal</span>
                        </p>
                        <p className="mt-1 text-muted">
                          <span className="font-semibold text-text">{p.goal.pctOfGoal[i]}</span> of goal
                        </p>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="h-9" aria-hidden />
      </div>

      <ul data-testid="monthly-rows" className="mt-3 divide-y divide-border md:hidden" aria-label={p.title}>
        {p.months.map((m, i) => (
          <li key={m.key} className={cn("-mx-4 grid grid-cols-[4.75rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2", m.inPeriod && "bg-chart-band")}>
            <span className="text-xs text-muted">{monthName(m)}</span>
            <div className="space-y-1" aria-hidden>
              {p.series.map((s) => (
                <div key={`row-${s.key}`} className="h-2 rounded-r-[4px]" style={{ width: `${pctOf(s.values[i], max)}%`, minWidth: s.values[i] > 0 ? 2 : 0, background: s.color }} />
              ))}
            </div>
            <div className="text-right text-xs leading-4 tabular">
              {p.series.map((s, si) => (
                <p key={`val-${s.key}`} className={si === 0 ? "font-semibold text-text" : "text-muted"}>
                  <span className="sr-only">{s.label} </span>
                  {s.display[i]}
                </p>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The same numbers as a table, so no value depends on hovering. */
export function MonthlyTable({ months, series, goal, title }: Omit<ChartProps, "ticks">) {
  return (
    <Table>
      <caption className="sr-only">{title}</caption>
      <thead>
        <tr>
          <th className={th}>Month</th>
          {series.map((s) => (
            <th key={`th-${s.key}`} className={`${th} text-right`}>
              {s.label}
            </th>
          ))}
          {goal && <th className={`${th} hidden text-right sm:table-cell`}>Goal</th>}
          {goal && <th className={`${th} text-right`}>% of goal</th>}
        </tr>
      </thead>
      <tbody>
        {months.map((m, i) => (
          <tr key={m.key} className={m.inPeriod ? "bg-chart-band" : undefined}>
            <td className={`${td} whitespace-nowrap`}>{monthName(m)}</td>
            {series.map((s) => (
              <td key={`td-${s.key}`} className={`${td} text-right tabular`}>
                {s.display[i]}
              </td>
            ))}
            {goal && <td className={`${td} hidden text-right tabular sm:table-cell`}>{goal.display[i] ?? "—"}</td>}
            {goal && <td className={`${td} text-right tabular`}>{goal.pctOfGoal[i] ?? "—"}</td>}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
