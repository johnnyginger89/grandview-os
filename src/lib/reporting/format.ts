/**
 * Display formatting for the dashboard. Values arrive as decimal strings;
 * Number() is used only to hand them to Intl for display.
 */
import { d, type DecimalInput } from "@/lib/money";

export { rangeLabel } from "./periods";

export const DASH = "—";
const MINUS = "−";

const whole = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });

const withMinus = (s: string) => s.replace("-", MINUS);

/** "$84,200" (rounded to the dollar). */
export function formatCADWhole(v: DecimalInput): string {
  return withMinus(whole.format(d(v).toDecimalPlaces(0).toNumber()));
}

/** "$84.2K", "$1.3M". */
export function formatCADCompact(v: DecimalInput): string {
  return withMinus(compact.format(d(v).toDecimalPlaces(0).toNumber()));
}

export function formatCount(v: DecimalInput): string {
  return withMinus(integer.format(d(v).toNumber()));
}

/** A ratio string ("0.4615") as "46%", or a dash when there is none. */
export function formatRatio(v: string | null | undefined, places = 0): string {
  if (v === null || v === undefined) return DASH;
  return `${withMinus(d(v).times(100).toDecimalPlaces(places).toFixed(places))}%`;
}

export function formatDays(v: string | null | undefined): string {
  if (v === null || v === undefined) return DASH;
  const n = d(v).toDecimalPlaces(0);
  return `${formatCount(n)} ${n.abs().eq(1) ? "day" : "days"}`;
}

export function formatWeeks(v: string | null | undefined): string {
  if (v === null || v === undefined) return DASH;
  const n = d(v).toDecimalPlaces(0);
  return `~${formatCount(n)} ${n.eq(1) ? "week" : "weeks"}`;
}

/** Prefix "+" or "−" (zero has no sign). */
export function signed(v: DecimalInput, text: string): string {
  const n = d(v);
  if (n.isZero()) return text.replace(/^[−-]/, "");
  return n.isNegative() ? `${MINUS}${text.replace(/^[−-]/, "")}` : `+${text}`;
}

/** A change between two ratios in percentage points: "+4.2 pts". */
export function formatPctPoints(change: DecimalInput): string {
  const pts = d(change).times(100).toDecimalPlaces(1);
  return signed(pts, `${pts.abs().toFixed(1)} pts`);
}

/** "Oct 2026" for a "YYYY-MM" key. */
export function formatMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/**
 * Four clean axis ticks (0 and three equal steps of a round number) whose top
 * covers `max` without much headroom. Counts never get fractional steps. Geometry only.
 */
const NICE_STEPS = [1, 2, 2.5, 3, 4, 5, 6, 8, 10];
export function niceTicks(max: number, opts: { integer?: boolean } = {}): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1, 2, 3];
  const rough = max / 3;
  const mag = 10 ** Math.floor(Math.log10(rough));
  let step = NICE_STEPS.find((s) => s * mag >= rough - 1e-9 * mag)! * mag;
  if (opts.integer) step = Math.max(1, Math.ceil(step));
  return [0, step, step * 2, step * 3];
}

/** Long free text (lost reasons) is cut for charts; the full text goes in a title. */
export function truncate(s: string, max = 60): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
