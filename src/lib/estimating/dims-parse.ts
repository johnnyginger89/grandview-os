/**
 * Typing sizes quickly: "15 12 8", "15x12x8", "15 × 12" (length, width, height in feet),
 * and simple sums in a quantity box: "12*8+10*8", "40x18".
 */

const NUM = String.raw`\d+(?:\.\d+)?|\.\d+`;
const SIZE_RE = new RegExp(String.raw`^\s*(${NUM})\s*(?:[x×*,]\s*|\s+)(${NUM})(?:\s*(?:[x×*,]\s*|\s+)(${NUM}))?\s*$`, "i");

/** Two or three numbers in one box → length, width and maybe height. Null when it isn't that. */
export function parseSize(text: string): { length: string; width: string; height: string | null } | null {
  const m = text.match(SIZE_RE);
  if (!m) return null;
  return { length: tidy(m[1]), width: tidy(m[2]), height: m[3] ? tidy(m[3]) : null };
}

function tidy(n: string): string {
  return String(Number(n));
}

/**
 * A plain number, or a sum of products ("12*8+10*8", "40x18 + 6"). Returns the result as a
 * string with at most 2 decimals, or null when the text isn't a number or a simple sum.
 * No division or brackets: enough for measuring, nothing that can go wrong.
 */
export function evalQuantity(text: string): string | null {
  const t = text.replace(/\s+/g, "").replace(/[x×]/gi, "*");
  if (!t) return null;
  if (!new RegExp(String.raw`^(?:${NUM})(?:[*+](?:${NUM}))*$`).test(t)) return null;
  // Work in hundredths to keep sums of feet-and-tenths exact.
  const total = t
    .split("+")
    .map((term) => term.split("*").reduce((acc, f) => acc * Number(f), 1))
    .reduce((a, b) => a + b, 0);
  if (!Number.isFinite(total) || total > 10_000_000) return null;
  return String(Math.round(total * 100) / 100);
}
