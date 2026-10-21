import { formatCount, formatRatio } from "@/lib/reporting/format";
import type { FunnelStep } from "@/lib/reporting/types";
import { BarList } from "./bar-list";

const STEPS = ["var(--chart-step-1)", "var(--chart-step-2)", "var(--chart-step-3)", "var(--chart-step-4)", "var(--chart-step-5)"];

/** Activity at each sales step, with the rate from the step above. */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  return (
    <BarList
      ariaLabel="Sales funnel"
      items={steps.map((s, i) => ({
        key: `step-${s.key}`,
        label: s.label,
        value: s.count,
        display: formatCount(s.count),
        color: STEPS[i % STEPS.length],
        sub: s.stepRate === null ? undefined : `→ ${formatRatio(s.stepRate)}`,
      }))}
    />
  );
}
