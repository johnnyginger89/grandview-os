/**
 * Reading what someone typed into the search box. Pure, so the browser and the
 * server agree, and covered by query.test.ts.
 */

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;
const MAX_TOKENS = 6;

export type NumberKind = "job" | "estimate" | "work_order" | "any";

export interface ParsedQuery {
  /** Trimmed, single-spaced text. */
  text: string;
  /** Words that must each match somewhere (name, street, city…). */
  tokens: string[];
  /** "#3033", "EST-5001", "WO 7001" or a bare number. */
  number: { kind: NumberKind; value: number } | null;
  /** Digits when the text looks like (part of) a phone number. */
  phoneDigits: string | null;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readNumber(text: string, estimatePrefix: string): ParsedQuery["number"] {
  const prefix = estimatePrefix.trim().replace(/[-\s#]+$/, "");
  const prefixes = ["est", "estimate", ...(prefix ? [escapeRe(prefix)] : [])].join("|");
  const patterns: [NumberKind, RegExp][] = [
    ["work_order", /^(?:wo|work\s*order)[-\s#]*(\d{1,9})$/i],
    ["estimate", new RegExp(`^(?:${prefixes})[-\\s#]*(\\d{1,9})$`, "i")],
    ["job", /^(?:job|project)[-\s#]*(\d{1,9})$/i],
    ["job", /^#\s*(\d{1,9})$/],
    ["any", /^(\d{3,9})$/],
  ];
  for (const [kind, re] of patterns) {
    const m = text.match(re);
    if (m) return { kind, value: Number(m[1]) };
  }
  return null;
}

function readPhone(text: string): string | null {
  if (!/^[\d\s().+-]+$/.test(text)) return null;
  let digits = text.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length >= 4 ? digits : null;
}

/** Returns null when there's nothing worth searching for yet. */
export function parseSearchQuery(raw: string, opts: { estimatePrefix?: string } = {}): ParsedQuery | null {
  const text = raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH).trim();
  if (text.length < MIN_QUERY_LENGTH) return null;
  const tokens = text
    .split(" ")
    .map((t) => t.replace(/^#/, ""))
    .filter(Boolean)
    .slice(0, MAX_TOKENS);
  if (!tokens.length) return null;
  return { text, tokens, number: readNumber(text, opts.estimatePrefix ?? ""), phoneDigits: readPhone(text) };
}

/** `%word%` for ILIKE, with the wildcard characters in the word itself made literal. */
export function likePattern(token: string): string {
  return `%${token.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Splits text into plain and matched parts so the matched words can be shown in bold. */
export function highlightParts(text: string, tokens: string[]): { text: string; match: boolean }[] {
  const words = [...new Set(tokens.map((t) => t.trim()).filter((t) => t.length > 0))].sort((a, b) => b.length - a.length);
  if (!text || !words.length) return text ? [{ text, match: false }] : [];
  const re = new RegExp(`(${words.map(escapeRe).join("|")})`, "gi");
  const out: { text: string; match: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (!m[0]) continue;
    if (at > last) out.push({ text: text.slice(last, at), match: false });
    out.push({ text: m[0], match: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false });
  return out;
}
