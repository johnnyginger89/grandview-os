/**
 * Stage colour classes keyed by pipeline_stages.color. Written out in full so
 * Tailwind's source scanner sees every class. Unknown colours fall back to slate.
 */
export const STAGE_DOT: Record<string, string> = {
  amber: "bg-amber-500",
  sky: "bg-sky-500",
  blue: "bg-blue-600",
  violet: "bg-violet-500",
  indigo: "bg-indigo-500",
  orange: "bg-orange-500",
  slate: "bg-slate-400",
  emerald: "bg-emerald-600",
  rose: "bg-rose-500",
};

/** 900 text on a 100 background passes AA at small sizes. */
export const STAGE_PILL: Record<string, string> = {
  amber: "bg-amber-100 text-amber-900 ring-amber-300",
  sky: "bg-sky-100 text-sky-900 ring-sky-300",
  blue: "bg-blue-100 text-blue-900 ring-blue-300",
  violet: "bg-violet-100 text-violet-900 ring-violet-300",
  indigo: "bg-indigo-100 text-indigo-900 ring-indigo-300",
  orange: "bg-orange-100 text-orange-900 ring-orange-300",
  slate: "bg-slate-100 text-slate-900 ring-slate-300",
  emerald: "bg-emerald-100 text-emerald-900 ring-emerald-300",
  rose: "bg-rose-100 text-rose-900 ring-rose-300",
};

export const STAGE_BAR: Record<string, string> = {
  amber: "border-l-amber-500",
  sky: "border-l-sky-500",
  blue: "border-l-blue-600",
  violet: "border-l-violet-500",
  indigo: "border-l-indigo-500",
  orange: "border-l-orange-500",
  slate: "border-l-slate-400",
  emerald: "border-l-emerald-600",
  rose: "border-l-rose-500",
};

export const STAGE_TEXT: Record<string, string> = {
  amber: "text-amber-800",
  sky: "text-sky-800",
  blue: "text-blue-800",
  violet: "text-violet-800",
  indigo: "text-indigo-800",
  orange: "text-orange-800",
  slate: "text-slate-700",
  emerald: "text-emerald-800",
  rose: "text-rose-800",
};

export function stageTone(color: string) {
  return {
    dot: STAGE_DOT[color] ?? STAGE_DOT.slate,
    pill: STAGE_PILL[color] ?? STAGE_PILL.slate,
    bar: STAGE_BAR[color] ?? STAGE_BAR.slate,
    text: STAGE_TEXT[color] ?? STAGE_TEXT.slate,
  };
}
