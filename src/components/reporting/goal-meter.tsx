import { CircleCheck, Target, TriangleAlert } from "lucide-react";
import { d, Decimal } from "@/lib/money";
import { formatCADWhole, formatRatio } from "@/lib/reporting/format";
import type { GoalProgress } from "@/lib/reporting/types";
import { cn } from "@/lib/utils";

const RAMP = {
  sales: { track: "bg-chart-sales-track", fill: "bg-chart-sales" },
  produced: { track: "bg-chart-produced-track", fill: "bg-chart-produced" },
} as const;

/** Progress toward a goal; the tick marks where it should be by today. */
export function GoalMeter({ label, progress, goalName, series = "sales", className }: { label: string; progress: GoalProgress; goalName: string; series?: keyof typeof RAMP; className?: string }) {
  const pct = d(progress.pct);
  const pace = progress.pace === null ? null : d(progress.pace);
  const behind = progress.status === "behind";
  // Numbers below only place pixels; the figures shown come from the strings.
  const fill = Decimal.min(Decimal.max(pct, 0), 1).times(100).toNumber();
  const now = pct.times(100).toDecimalPlaces(0).toNumber();
  const caption = `${formatRatio(progress.pct)} of ${formatCADWhole(progress.goal)} ${goalName}${pace ? ` · pace ${formatRatio(progress.pace)}` : ""}`;
  return (
    <div data-testid="goal-meter" className={cn("mt-3", className)}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.max(100, now)}
        aria-valuenow={now}
        aria-valuetext={caption}
        className={cn("relative h-2 rounded-full", RAMP[series].track)}
      >
        <div className={cn("h-full rounded-full", behind ? "bg-warning" : RAMP[series].fill)} style={{ width: `${fill}%` }} />
        {pace && <span aria-hidden className="absolute -top-1 h-4 w-0.5 rounded-full bg-chart-goal" style={{ left: `calc(${Decimal.min(pace, 1).times(100).toNumber()}% - 1px)` }} />}
      </div>
      <p className="mt-1.5 text-xs text-muted">{caption}</p>
      <GoalStatusLine progress={progress} />
    </div>
  );
}

function GoalStatusLine({ progress }: { progress: GoalProgress }) {
  const line = "mt-0.5 flex items-center gap-1 text-xs font-medium";
  switch (progress.status) {
    case "behind":
      return (
        <p className={cn(line, "text-warning")}>
          <TriangleAlert className="size-3.5" aria-hidden /> Behind pace by {formatCADWhole(progress.shortBy)}
        </p>
      );
    case "ahead":
      return (
        <p className={cn(line, "text-success")}>
          <CircleCheck className="size-3.5" aria-hidden /> Ahead of pace
        </p>
      );
    case "on_pace":
      return (
        <p className={cn(line, "text-success")}>
          <CircleCheck className="size-3.5" aria-hidden /> On pace
        </p>
      );
    case "complete":
      return d(progress.shortBy).isZero() ? (
        <p className={cn(line, "text-success")}>
          <CircleCheck className="size-3.5" aria-hidden /> Goal reached
        </p>
      ) : (
        <p className={cn(line, "text-muted")}>
          <Target className="size-3.5" aria-hidden /> Short of the goal by {formatCADWhole(progress.shortBy)}
        </p>
      );
  }
}
