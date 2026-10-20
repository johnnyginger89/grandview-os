/**
 * Per-job-type resolution. Each field is picked independently from the first job
 * type in the chain that defines it: jobType → its `inherits` → default.
 */
import { SCOPES, type AppliesTo, type ImageRef, type JobTypeOverride, type ProposalTemplate, type Scope, type TemplateBlock } from "./schema";

export interface ResolvedJobType {
  key: string;
  label: string;
  chain: string[];
  scopes: Scope[];
  cover: { headline: string; intro: string; heroImage: ImageRef; statement: string };
  portfolio: ImageRef[];
  insuranceImage: ImageRef;
  faqImage: ImageRef;
  areasListMode: "areas" | "surfaces";
  areasExcludedDefault: string;
  servicesInclude: TemplateBlock;
  warrantyMonths: number;
  preparation: TemplateBlock[];
  /** Which job type each field came from ("shared" = the template's shared value). */
  source: Record<string, string>;
}

/** Estimate line categories that imply a scope. Old snapshots without a category contribute nothing. */
export function scopeFromCategory(category: string | null | undefined): Scope | null {
  const c = category?.trim().toLowerCase();
  if (c === "interior" || c === "cabinets") return "interior";
  if (c === "exterior" || c === "staining") return "exterior";
  return null;
}

export function appliesToScopes(appliesTo: AppliesTo | undefined, scopes: readonly Scope[]): boolean {
  return !appliesTo || appliesTo === "all" || scopes.includes(appliesTo);
}

/** The wording to use for a clause on this job: exterior wording when exterior is in scope. */
export function clauseText(c: { text: string; textExterior?: string }, scopes: readonly Scope[]): string {
  return scopes.includes("exterior") && c.textExterior ? c.textExterior : c.text;
}

export function resolveJobType(tpl: ProposalTemplate, jobType: string, lineScopes: readonly Scope[] = []): ResolvedJobType {
  const types = tpl.jobTypes as Record<string, JobTypeOverride | undefined>;
  const keys: string[] = [];
  const own = jobType && jobType !== "default" ? types[jobType] : undefined;
  if (own) {
    keys.push(jobType);
    if (own.inherits !== "default" && types[own.inherits]) keys.push(own.inherits);
  }
  keys.push("default");
  const chain = [...new Set(keys)];
  const entries = chain.map((k) => [k, k === "default" ? tpl.jobTypes.default : types[k]!] as const);
  const source: Record<string, string> = {};

  function pick<T>(field: string, get: (o: JobTypeOverride) => T | undefined): T | undefined {
    for (const [k, o] of entries) {
      const v = get(o);
      if (v !== undefined) {
        source[field] = k;
        return v;
      }
    }
    return undefined;
  }

  const d = tpl.jobTypes.default;
  const headline = pick("cover.headline", (o) => o.cover?.headline) ?? d.cover.headline;
  const intro = pick("cover.intro", (o) => o.cover?.intro) ?? d.cover.intro;
  const heroImage = pick("cover.heroImage", (o) => o.cover?.heroImage) ?? d.cover.heroImage;
  let statement = pick("cover.statement", (o) => o.cover?.statement);
  if (statement === undefined) {
    statement = tpl.cover.statement;
    source["cover.statement"] = "shared";
  }

  const [firstKey, first] = entries[0];
  source.label = firstKey;
  const scopeSet = new Set<Scope>([...(first.scopes ?? []), ...lineScopes]);
  const scopes = SCOPES.filter((s) => scopeSet.has(s));

  let preparation = pick("preparation", (o) => o.preparation);
  if (preparation === undefined) {
    source.preparation = "scopes";
    // Exterior first, then interior: the order Markate used on combined jobs.
    preparation = (["exterior", "interior"] as const).filter((s) => scopeSet.has(s)).map((s) => tpl.estimateDocument.preparationByScope[s]);
  }

  return {
    key: firstKey,
    label: first.label,
    chain,
    scopes,
    cover: { headline, intro, heroImage, statement },
    portfolio: pick("portfolio", (o) => o.portfolio) ?? d.portfolio,
    insuranceImage: pick("insuranceImage", (o) => o.insuranceImage) ?? d.insuranceImage,
    faqImage: pick("faqImage", (o) => o.faqImage) ?? d.faqImage,
    areasListMode: pick("areasListMode", (o) => o.areasListMode) ?? d.areasListMode,
    areasExcludedDefault: pick("areasExcludedDefault", (o) => o.areasExcludedDefault) ?? d.areasExcludedDefault,
    servicesInclude: pick("servicesInclude", (o) => o.servicesInclude) ?? d.servicesInclude,
    warrantyMonths: pick("warrantyMonths", (o) => o.warrantyMonths) ?? d.warrantyMonths,
    preparation,
    source,
  };
}
