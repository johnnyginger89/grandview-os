/**
 * Proposal presentation template: everything the owner edits in
 * Settings → Proposals. Isomorphic (the settings editor validates on the client too).
 */
import { z } from "zod";

export const PROPOSAL_TEMPLATE_KEY = "proposal_template";
export const JOB_TYPE_KEYS = ["default", "interior", "exterior", "interior_exterior", "cabinets", "staining", "commercial", "strata", "repairs"] as const;
export type JobTypeKey = (typeof JOB_TYPE_KEYS)[number];
export const SCOPES = ["interior", "exterior"] as const;
export type Scope = (typeof SCOPES)[number];

const t = (max: number) => z.string().trim().max(max);
const req = (max: number) => z.string().trim().min(1, "Required").max(max);
/** Plain text. Blank line = new paragraph; lines starting "- " = bullet list. No HTML, no markdown. */
const prose = (max = 5000) => t(max);
const itemId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Use lowercase letters, digits and dashes");

export const linkHref = z
  .string()
  .trim()
  .max(500)
  .refine(
    (u) => /^https:\/\/[^\s]+$/i.test(u) || /^tel:\+?[0-9-]{7,20}$/.test(u) || /^mailto:[^\s@]+@[^\s@]+$/.test(u),
    "Links must start with https:// (or tel: / mailto:)",
  );
const optionalHref = linkHref.or(z.literal(""));

export const MEDIA_REF_RE = /^media:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export const imageSrc = z.union([
  z.string().regex(/^\/(proposal|brand)\/[a-z0-9][a-z0-9._-]*\.(jpe?g|png|webp)$/), // shipped defaults
  z.string().regex(MEDIA_REF_RE), // owner uploads
]);
export const imageRef = z.object({
  src: imageSrc,
  alt: t(300), // "" = decorative (icons)
  focalX: z.number().int().min(0).max(100).default(50),
  focalY: z.number().int().min(0).max(100).default(50),
});
export type ImageRef = z.infer<typeof imageRef>;

export const linkSchema = z.object({ label: req(80), href: linkHref });
export const bannerSchema = z.object({ title: req(80), subtitle: t(120) });
const appliesTo = z.enum(["all", "interior", "exterior"]);
export type AppliesTo = z.infer<typeof appliesTo>;
const clause = z.object({
  id: itemId,
  text: req(3000),
  appliesTo: appliesTo.default("all"),
  /** Used instead of `text` when the job includes exterior scope. */
  textExterior: t(3000).optional(),
});
const block = z.object({ title: req(80), body: prose(4000) });
export type TemplateBlock = z.infer<typeof block>;

const coverOverride = z.object({
  headline: req(160).optional(), // tokens: {firstName}
  intro: prose(3000).optional(), // first paragraph(s); shared `cover.introClosing` is appended automatically
  heroImage: imageRef.optional(),
  statement: t(300).optional(), // overrides shared statement, *teal* highlights
});

export const jobTypeOverrideSchema = z.object({
  label: req(40), // word for {jobTypeLabel}: "interior", "exterior", "cabinet"…
  inherits: z.enum(["default", "interior", "exterior"]).default("default"),
  scopes: z.array(z.enum(SCOPES)).max(2).default([]),
  cover: coverOverride.optional(),
  portfolio: z.array(imageRef).max(12).optional(),
  insuranceImage: imageRef.optional(),
  faqImage: imageRef.optional(),
  preparation: z.array(block).max(3).optional(), // replaces scope-derived preparation lines
  areasListMode: z.enum(["areas", "surfaces"]).optional(), // interior lists rooms, exterior lists surfaces
  areasExcludedDefault: prose(3000).optional(), // one exclusion per line
  servicesInclude: block.optional(),
  warrantyMonths: z.number().int().min(0).max(600).optional(),
});
export type JobTypeOverride = z.infer<typeof jobTypeOverrideSchema>;

export const defaultJobTypeSchema = jobTypeOverrideSchema.extend({
  cover: coverOverride.extend({ headline: req(160), intro: prose(3000), heroImage: imageRef }), // statement optional → shared
  portfolio: z.array(imageRef).max(12),
  insuranceImage: imageRef,
  faqImage: imageRef,
  areasListMode: z.enum(["areas", "surfaces"]),
  areasExcludedDefault: prose(3000),
  servicesInclude: block,
  warrantyMonths: z.number().int().min(0).max(600),
});
export type DefaultJobType = z.infer<typeof defaultJobTypeSchema>;
export type JobTypes = { default: DefaultJobType } & Record<string, JobTypeOverride>;

const jobTypesSchema = z.record(z.string().regex(/^[a-z_]{1,40}$/), z.unknown()).transform((raw, ctx): JobTypes => {
  if (!raw.default) {
    ctx.addIssue({ code: "custom", message: "The default job type is required", path: ["default"] });
    return z.NEVER;
  }
  const out: Record<string, JobTypeOverride> = {};
  let failed = false;
  for (const [k, v] of Object.entries(raw)) {
    const r = (k === "default" ? defaultJobTypeSchema : jobTypeOverrideSchema).safeParse(v);
    if (!r.success) {
      failed = true;
      for (const i of r.error.issues) ctx.addIssue({ code: "custom", message: i.message, path: [k, ...i.path] as (string | number)[] });
    } else out[k] = r.data;
  }
  return failed ? z.NEVER : (out as JobTypes);
});

export const sectionSchemas = {
  nav: z.object({
    about: req(30),
    whyUs: req(30),
    reviews: req(30),
    portfolio: req(30),
    insurance: req(30),
    yourProject: req(30),
    terms: req(30),
    nextStep: req(30),
  }),
  links: z.object({
    learnMore: linkSchema,
    reviews: linkSchema,
    portfolio: linkSchema,
    faq: linkSchema,
    pcaStandards: linkHref,
    facebook: optionalHref,
    instagram: optionalHref,
    website: optionalHref,
  }),
  cover: z.object({ ctaLabel: req(40), introClosing: prose(800) /* {jobTypeLabel} */, statement: t(300), statementBody: prose(3000) }),
  about: z.object({
    banner: bannerSchema,
    goodHands: z.object({ title: req(80), body: prose(3000), image: imageRef }),
    history: z.object({ title: req(80), body: prose(5000), image: imageRef }),
    connectLabel: t(40),
  }),
  whyUs: z.object({
    banner: bannerSchema,
    tiles: z.array(z.object({ id: itemId, title: req(60), text: req(300), icon: imageRef })).min(1).max(9),
  }),
  reviews: z
    .object({
      banner: bannerSchema,
      items: z
        .array(
          z.object({
            id: itemId,
            quote: req(2500),
            author: req(80),
            rating: z.number().int().min(1).max(5).default(5),
            featured: z.boolean().default(false),
            jobType: appliesTo.default("all"),
          }),
        )
        .max(12),
    })
    .refine((r) => r.items.filter((i) => i.featured).length <= 1, "Only one review can be featured"),
  portfolio: z.object({ banner: bannerSchema }),
  resources: z.object({
    banner: bannerSchema,
    intro: prose(1500),
    insurance: z.object({ title: req(80), body: prose(2000) }),
    faq: z.object({ title: req(80), body: prose(2000) }),
  }),
  estimateDocument: z.object({
    banner: bannerSchema, // "Your Project" section header
    documentTitle: req(30),
    numberPrefix: t(10),
    labels: z.object({
      estimateDate: req(40),
      expiryDate: req(40),
      poNumber: req(40),
      from: req(40),
      licence: req(40),
      gst: req(40),
      email: req(40),
      phone: req(40),
      to: req(40),
      jobLocation: req(40),
      job: req(40),
      services: req(40),
      subtotal: req(40),
      taxes: req(40),
      grandTotal: req(40),
      deposit: req(40),
      paymentMethods: req(60),
      message: req(40),
      terms: req(40),
    }),
    showTaxLine: z.boolean().default(true),
    showAreaPrices: z.boolean().default(false),
    preparationByScope: z.object({ interior: block, exterior: block }),
    areasToBePainted: z.object({ title: req(80), leadIn: t(200) }),
    areasToBeExcluded: z.object({ title: req(80), leadIn: t(200), closing: t(300) /* {areasLineNo} */ }),
    optionTitle: req(120), // "Optional {title}"
    paintLineTitle: req(80), // "Paint {surface}"
    paymentMethods: z.array(req(40)).max(10),
    defaultMessage: prose(3000), // {depositPct}
    footerNotes: z.array(req(500)).max(6), // shown under "Terms"
  }),
  contract: z.object({
    banner: bannerSchema,
    values: z.object({ colourConsultFee: t(20) }),
    intro: prose(3000),
    scopeOfWork: block,
    termsTitle: req(80),
    clauses: z.array(clause).max(40),
    warranty: z.object({
      title: req(80),
      intro: prose(2000), // {warrantyMonths}
      conditions: z.array(req(500)).max(10),
      exclusionsLeadIn: req(200),
      exclusions: z
        .array(
          z.object({
            id: itemId,
            text: req(1000),
            note: t(500).optional(),
            children: z.array(req(500)).max(20).default([]),
            appliesTo: appliesTo.default("all"),
          }),
        )
        .max(30),
      closing: prose(5000),
    }),
    qualityStandards: z.object({ title: req(80), items: z.array(clause).max(20) }), // {pcaStandardsUrl}
    paintsMaterials: z.object({ title: req(80), items: z.array(clause.extend({ emphasis: z.boolean().default(false) })).max(20) }),
    unforeseen: block,
    customerResponsibility: z.object({ title: req(80), items: z.array(clause).max(20) }),
    insurance: block,
    acceptance: z.object({ title: req(80), items: z.array(req(500)).max(10) }),
    payment: z.object({ title: req(80), items: z.array(req(500)).max(10) }), // {depositPct}
  }),
  nextStep: z.object({
    banner: bannerSchema,
    image: imageRef.nullable(),
    heading: req(80),
    steps: z.array(req(300)).min(1).max(5),
    totalLabel: req(40),
    acceptLabel: req(40),
    declineLabel: req(40),
    agreeLabel: req(200),
  }),
  jobTypes: jobTypesSchema,
};

export const SECTION_KEYS = ["nav", "links", "cover", "about", "whyUs", "reviews", "portfolio", "resources", "estimateDocument", "contract", "nextStep", "jobTypes"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const proposalTemplateSchema = z.object({ version: z.literal(1), ...sectionSchemas });
export type ProposalTemplate = z.infer<typeof proposalTemplateSchema>;
export type ProposalTemplateInput = z.input<typeof proposalTemplateSchema>;

// ---------------------------------------------------------------------------
// Placeholders. Each field accepts only the tokens that make sense there.

const ANYWHERE = ["companyName", "companyPhone"];
const FIELD_TOKENS: [RegExp, string[]][] = [
  [/^jobTypes\.[a-z_]+\.cover\.headline$/, ["firstName"]],
  [/^cover\.introClosing$/, ["jobTypeLabel"]],
  [/^estimateDocument\.defaultMessage$/, ["depositPct"]],
  [/^estimateDocument\.optionTitle$/, ["title"]],
  [/^estimateDocument\.paintLineTitle$/, ["surface"]],
  [/^estimateDocument\.areasToBeExcluded\.closing$/, ["areasLineNo"]],
  [/^contract\.payment\.items\.\d+$/, ["depositPct"]],
  [/^contract\.warranty\.intro$/, ["warrantyMonths"]],
  [/^contract\.clauses\.\d+\.(text|textExterior)$/, ["colourConsultFee"]],
  [/^contract\.qualityStandards\.items\.\d+\.(text|textExterior)$/, ["pcaStandardsUrl"]],
];
export const ALL_TOKENS = [...new Set([...ANYWHERE, ...FIELD_TOKENS.flatMap(([, t]) => t)])];

export function allowedTokens(path: string): string[] {
  return [...ANYWHERE, ...FIELD_TOKENS.filter(([re]) => re.test(path)).flatMap(([, t]) => t)];
}

const TOKEN_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Friendly messages for placeholders a field doesn't support. Walks every string in `value`. */
export function tokenProblems(value: unknown, basePath: string): string[] {
  const problems: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") {
      const allowed = allowedTokens(path);
      for (const m of v.matchAll(TOKEN_RE)) {
        const name = m[1];
        if (allowed.includes(name)) continue;
        const near = ALL_TOKENS.find((k) => k.toLowerCase() === name.toLowerCase());
        if (near && allowed.includes(near)) problems.push(`{${name}} isn't a placeholder we know. Did you mean {${near}}?`);
        else if (near) problems.push(`{${near}} can't be used in this field.`);
        else problems.push(`{${name}} isn't a placeholder we know.${allowed.length ? ` You can use ${allowed.map((a) => `{${a}}`).join(", ")}.` : ""}`);
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${i}`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(value, basePath);
  return [...new Set(problems)];
}

/** Every `media:<uuid>` image reference in a value. */
export function mediaRefs(value: unknown): string[] {
  const ids = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      const m = MEDIA_REF_RE.exec(v);
      if (m) ids.add(m[1]);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
  return [...ids];
}
