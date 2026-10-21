import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { Decimal } from "@/lib/money";
import { delta, deltaTone, type Direction } from "@/lib/reporting/kpi";
import { DASH, formatCADCompact, formatCount, formatPctPoints, formatRatio, signed } from "@/lib/reporting/format";
import type { KpiValue } from "@/lib/reporting/types";
import { cn } from "@/lib/utils";

export type DeltaKind = "money" | "count" | "ratio" | "days";

const TONE = { success: "text-success", danger: "text-danger", neutral: "text-muted" } as const;

function deltaText(kind: DeltaKind, abs: Decimal, pct: Decimal | null): string {
  switch (kind) {
    case "ratio":
      return formatPctPoints(abs);
    case "days": {
      const n = abs.toDecimalPlaces(0);
      return signed(n, `${formatCount(n.abs())} ${n.abs().eq(1) ? "day" : "days"}`);
    }
    case "money":
      return pct ? signed(pct, formatRatio(pct.abs().toFixed(4), 1)) : signed(abs, formatCADCompact(abs.abs()));
    case "count": {
      const n = signed(abs, formatCount(abs.abs()));
      return pct ? `${n} (${signed(pct, formatRatio(pct.abs().toFixed(4), 0))})` : n;
    }
  }
}

/** Change against the comparison period: icon + signed value, coloured by whether up is good. */
export function Delta({ kpi, kind, dir, vs, className }: { kpi: KpiValue; kind: DeltaKind; dir: Direction; vs: string; className?: string }) {
  const change = kpi.compareAvailable ? delta(kpi.value, kpi.compare) : null;
  if (!change)
    return (
      <p className={cn("mt-1 flex items-center gap-1 text-xs text-muted", className)} title={kpi.compareAvailable ? undefined : "No records yet for the earlier period"}>
        <Minus className="size-3.5 shrink-0" aria-hidden />
        <span>{DASH}</span>
        <span className="min-w-0 truncate">vs {vs}</span>
      </p>
    );
  const tone = deltaTone(change.abs, dir);
  const Icon = change.abs.isZero() ? Minus : change.abs.isPositive() ? TrendingUp : TrendingDown;
  return (
    <p className={cn("mt-1 flex items-center gap-1 text-xs", className)}>
      <Icon className={cn("size-3.5 shrink-0", TONE[tone])} aria-hidden />
      <span className={cn("font-medium", TONE[tone])}>{change.abs.isZero() ? "No change" : deltaText(kind, change.abs, change.pct)}</span>
      <span className="min-w-0 truncate text-muted">vs {vs}</span>
    </p>
  );
}
