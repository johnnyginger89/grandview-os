/** Placeholder filling for owner-edited proposal wording. Output is plain text, rendered as text. */
export type TokenValues = Record<string, string | number | null | undefined>;

const TOKEN_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Replace {name} with its value. Unknown or empty tokens are left untouched (saving rejects unknown ones). */
export function fillTokens(text: string, values: TokenValues): string {
  return text.replace(TOKEN_RE, (whole, name: string) => {
    const v = values[name];
    return v === null || v === undefined || v === "" ? whole : String(v);
  });
}

/**
 * Cover headline. With no first name, a leading "{firstName}, " is dropped and the
 * next letter capitalised; any other {firstName} is removed.
 */
export function cleanupHeadline(template: string, firstName: string | null | undefined, values: TokenValues = {}): string {
  const name = firstName?.trim();
  let s = template;
  if (!name) {
    s = s.replace(/^\s*\{firstName\}\s*[,:!–-]?\s*/, "");
    s = s.replace(/\s*\{firstName\}\s*/g, " ");
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }
  return fillTokens(s, { ...values, firstName: name }).replace(/\s{2,}/g, " ").trim();
}

export interface StatementSegment {
  text: string;
  tone: "dark" | "teal";
}

/** "A *B* C" → dark "A ", teal "B", dark " C". An unpaired asterisk stays literal. */
export function statementSegments(statement: string): StatementSegment[] {
  const out: StatementSegment[] = [];
  const re = /\*([^*]+)\*/g;
  let last = 0;
  for (const m of statement.matchAll(re)) {
    if (m.index > last) out.push({ text: statement.slice(last, m.index), tone: "dark" });
    out.push({ text: m[1], tone: "teal" });
    last = m.index + m[0].length;
  }
  if (last < statement.length) out.push({ text: statement.slice(last), tone: "dark" });
  return out.filter((s) => s.text.length > 0);
}
