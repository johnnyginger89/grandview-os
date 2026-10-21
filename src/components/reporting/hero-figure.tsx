import type { ReactNode } from "react";

/** The one big number a view leads with (48 px, proportional figures). */
export function HeroFigure({ testId, label, period, value, raw, delta, title }: { testId: string; label: string; period: string; value: ReactNode; raw: string | null; delta?: ReactNode; title?: string }) {
  return (
    <div data-testid={testId} title={title} className="min-w-0">
      <p className="text-sm font-medium text-text">
        {label} <span className="font-normal text-muted">· {period}</span>
      </p>
      <p className="mt-1 break-words text-5xl font-semibold tracking-tight text-text" data-value={raw ?? ""}>
        {value}
      </p>
      {delta}
    </div>
  );
}
