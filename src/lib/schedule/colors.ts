/**
 * Crew colour classes keyed by crews.color. Written out in full so Tailwind's
 * source scanner sees every class. Bar text stays text-text on the 50 fill (AA).
 */
import type { CrewColor } from "./constants";

export interface CrewColorClasses {
  /** Small swatch / legend dot. */
  dot: string;
  /** Soft bar fill. */
  bar: string;
  /** Strong left border on bars. */
  border: string;
  /** Pills and chips: 900 text on a 100 background. */
  chip: string;
  /** Calendar bars: the crew's colour, filled, with text that passes 4.5:1 on it. */
  solid: string;
  /** Focus/selection ring in the crew colour. */
  ring: string;
}

export const CREW_COLOR_CLASSES: Record<CrewColor, CrewColorClasses> = {
  emerald: { dot: "bg-emerald-600", bar: "bg-emerald-50", border: "border-l-emerald-600", chip: "bg-emerald-100 text-emerald-900", ring: "ring-emerald-600", solid: "bg-emerald-700 text-white" },
  violet: { dot: "bg-violet-600", bar: "bg-violet-50", border: "border-l-violet-600", chip: "bg-violet-100 text-violet-900", ring: "ring-violet-600", solid: "bg-violet-600 text-white" },
  amber: { dot: "bg-amber-500", bar: "bg-amber-50", border: "border-l-amber-500", chip: "bg-amber-100 text-amber-900", ring: "ring-amber-500", solid: "bg-amber-400 text-amber-950" },
  sky: { dot: "bg-sky-600", bar: "bg-sky-50", border: "border-l-sky-600", chip: "bg-sky-100 text-sky-900", ring: "ring-sky-600", solid: "bg-sky-700 text-white" },
  rose: { dot: "bg-rose-600", bar: "bg-rose-50", border: "border-l-rose-600", chip: "bg-rose-100 text-rose-900", ring: "ring-rose-600", solid: "bg-rose-600 text-white" },
  indigo: { dot: "bg-indigo-600", bar: "bg-indigo-50", border: "border-l-indigo-600", chip: "bg-indigo-100 text-indigo-900", ring: "ring-indigo-600", solid: "bg-indigo-600 text-white" },
  orange: { dot: "bg-orange-500", bar: "bg-orange-50", border: "border-l-orange-500", chip: "bg-orange-100 text-orange-900", ring: "ring-orange-500", solid: "bg-orange-400 text-orange-950" },
  teal: { dot: "bg-teal-600", bar: "bg-teal-50", border: "border-l-teal-600", chip: "bg-teal-100 text-teal-900", ring: "ring-teal-600", solid: "bg-teal-700 text-white" },
  lime: { dot: "bg-lime-600", bar: "bg-lime-50", border: "border-l-lime-600", chip: "bg-lime-100 text-lime-900", ring: "ring-lime-600", solid: "bg-lime-400 text-lime-950" },
  fuchsia: { dot: "bg-fuchsia-600", bar: "bg-fuchsia-50", border: "border-l-fuchsia-600", chip: "bg-fuchsia-100 text-fuchsia-900", ring: "ring-fuchsia-600", solid: "bg-fuchsia-700 text-white" },
  cyan: { dot: "bg-cyan-600", bar: "bg-cyan-50", border: "border-l-cyan-600", chip: "bg-cyan-100 text-cyan-900", ring: "ring-cyan-600", solid: "bg-cyan-700 text-white" },
  slate: { dot: "bg-slate-500", bar: "bg-slate-100", border: "border-l-slate-500", chip: "bg-slate-100 text-slate-900", ring: "ring-slate-500", solid: "bg-slate-600 text-white" },
};

/** The Unassigned row and unknown colours. */
export const UNASSIGNED_COLOR_CLASSES: CrewColorClasses = {
  dot: "bg-slate-300",
  bar: "bg-surface-2",
  border: "border-l-slate-400",
  chip: "bg-slate-100 text-slate-900",
  ring: "ring-slate-400",
  solid: "bg-slate-200 text-slate-900",
};

export function crewColorClasses(color: string | null | undefined): CrewColorClasses {
  return (color && CREW_COLOR_CLASSES[color as CrewColor]) || UNASSIGNED_COLOR_CLASSES;
}

/** Human names for the colour picker. */
export const CREW_COLOR_LABEL: Record<CrewColor, string> = {
  emerald: "Green",
  violet: "Purple",
  amber: "Yellow",
  sky: "Blue",
  rose: "Red",
  indigo: "Indigo",
  orange: "Orange",
  teal: "Teal",
  lime: "Lime",
  fuchsia: "Pink",
  cyan: "Cyan",
  slate: "Grey",
};
