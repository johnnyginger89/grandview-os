import { SECTION_KEYS, sectionSchemas, type ProposalTemplate, type SectionKey } from "./schema";

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => !!v && typeof v === "object" && !Array.isArray(v);

/** Objects merge key by key (stored wins); arrays, primitives and null replace whole. */
export function deepMerge(base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  if (isPlain(base) && isPlain(over)) {
    const out: Plain = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
    return out;
  }
  return over;
}

/** A stored `null` inside a job type means "override removed": drop the key. */
function stripNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v;
  if (!isPlain(v)) return v;
  const out: Plain = {};
  for (const [k, x] of Object.entries(v)) if (x !== null) out[k] = stripNulls(x);
  return out;
}

/** Bring older stored documents up to the current version. Only version 1 exists so far. */
export function upgradeTemplate(raw: unknown): Plain {
  if (!isPlain(raw)) return {};
  const version = raw.version;
  if (version === undefined || version === 1) return { ...raw, version: 1 };
  // A newer document than this code understands (e.g. during a rollback): use what we can.
  return { ...raw, version: 1 };
}

export interface MergeResult {
  template: ProposalTemplate;
  /** Sections that failed validation and fell back to the defaults. */
  invalidSections: SectionKey[];
}

/**
 * Merge a stored template over the defaults, then validate section by section.
 * A broken section falls back to its default so a customer never sees a broken page.
 */
export function mergeWithDefaults(stored: unknown, defaults: ProposalTemplate): MergeResult {
  const raw = upgradeTemplate(stored);
  const merged = deepMerge(defaults, raw) as Plain;

  // Job types merge by key; nulls remove an override; the default job type is always complete.
  const jt: Plain = {};
  const storedJt = isPlain(raw.jobTypes) ? raw.jobTypes : {};
  for (const key of new Set([...Object.keys(defaults.jobTypes), ...Object.keys(storedJt)])) {
    const base = (defaults.jobTypes as Plain)[key];
    const over = storedJt[key];
    if (over === null) {
      if (key === "default") jt[key] = base;
      continue;
    }
    let value = stripNulls(deepMerge(base, over));
    if (key === "default") value = deepMerge(base, value);
    if (value !== undefined) jt[key] = value;
  }
  merged.jobTypes = jt;

  const out: Plain = { version: 1 };
  const invalidSections: SectionKey[] = [];
  for (const k of SECTION_KEYS) {
    const r = sectionSchemas[k].safeParse(merged[k]);
    if (r.success) out[k] = r.data;
    else {
      invalidSections.push(k);
      out[k] = defaults[k];
    }
  }
  return { template: out as unknown as ProposalTemplate, invalidSections };
}
