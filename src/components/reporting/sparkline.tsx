/** A 12-point trend: muted line, the latest point in the accent with a surface ring. Decorative. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const w = 96;
  const h = 28;
  const pad = 5;
  if (values.length < 2) return null;
  const max = Math.max(...values, 0);
  const pts = values.map((v, i) => [pad + (i * (w - 2 * pad)) / (values.length - 1), h - pad - (max > 0 ? (v / max) * (h - 2 * pad) : 0)] as const);
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg aria-hidden width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={className}>
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--chart-muted)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={4} fill="var(--chart-sales)" stroke="var(--surface)" strokeWidth={2} />
    </svg>
  );
}
