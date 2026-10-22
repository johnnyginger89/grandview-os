import "server-only";
/**
 * Live marketing content around the frozen proposal: rendered from current settings on
 * every request, so a replaced photo or insurance certificate shows on proposals already sent.
 * Copies named fields only; nothing here comes from the estimate except the frozen view.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { DEFAULT_PROPOSAL_TEMPLATE } from "@/db/seed-proposal-template";
import { imageUrl, mediaId } from "@/lib/proposal-template/images";
import { parseProse, type Block } from "@/lib/proposal-template/prose";
import { appliesToScopes, resolveJobType } from "@/lib/proposal-template/resolve";
import { mediaRefs, type ImageRef, type ProposalTemplate } from "@/lib/proposal-template/schema";
import { cleanupHeadline, fillTokens, statementSegments, type StatementSegment, type TokenValues } from "@/lib/proposal-template/tokens";
import { businessZone } from "@/lib/time";
import { currentDocuments, visibleDocuments, type CurrentDocument } from "./media";
import { companyBlock, telHref, type CompanyInput, type ProposalViewV2 } from "./proposal-view";
import { getCompany, getProposalTemplate } from "./settings";

export type PresentationMode = "customer" | "staff" | "draft" | "sample";

export interface PresentationImage {
  url: string;
  alt: string;
  focalX: number;
  focalY: number;
}

export interface PresentationLink {
  label: string;
  href: string;
  external: boolean;
}

export interface PresentationDocument {
  label: string;
  href: string;
  /** "Updated Oct 2026" */
  updated: string;
  /** "Valid to Jan 10, 2027", or null when the document has no expiry. */
  validTo: string | null;
}

export interface Review {
  id: string;
  quote: string;
  author: string;
  rating: number;
}

export interface Presentation {
  jobTypeLabel: string;
  topBar: { displayName: string; phone: string; tel: string };
  nav: { id: string; label: string }[];
  cover: {
    wordmark: string;
    tagline: string;
    headline: string;
    intro: Block[];
    hero: PresentationImage;
    ctaLabel: string;
    statement: StatementSegment[];
    statementBody: Block[];
  };
  about: {
    banner: { title: string; subtitle: string };
    goodHands: { title: string; body: Block[]; image: PresentationImage };
    history: { title: string; body: Block[]; image: PresentationImage };
    connectLabel: string;
  };
  whyUs: { banner: { title: string; subtitle: string }; tiles: { id: string; title: string; text: string; icon: PresentationImage }[]; cta: PresentationLink };
  reviews: { banner: { title: string; subtitle: string }; featured: Review | null; items: Review[]; cta: PresentationLink };
  portfolio: { banner: { title: string; subtitle: string }; photos: PresentationImage[]; cta: PresentationLink };
  resources: {
    banner: { title: string; subtitle: string };
    intro: Block[];
    insurance: { title: string; body: Block[]; image: PresentationImage; documents: PresentationDocument[] };
    faq: { title: string; body: Block[]; image: PresentationImage; link: PresentationLink };
  };
  estimateBanner: { title: string; subtitle: string };
  nextStep: {
    banner: { title: string; subtitle: string };
    image: PresentationImage | null;
    heading: string;
    steps: string[];
    totalLabel: string;
    acceptLabel: string;
    declineLabel: string;
    agreeLabel: string;
  };
  social: { facebook: string; instagram: string; website: string; phone: string };
}

const TYPE_LABEL: Record<string, string> = { "application/pdf": "PDF", "image/jpeg": "JPG", "image/png": "PNG" };

function documentLabel(d: CurrentDocument): string {
  const t = (d.title || d.defaultTitle).trim();
  const kind = TYPE_LABEL[d.contentType ?? ""] ?? "file";
  return `View ${t.charAt(0).toLowerCase()}${t.slice(1)} (${kind})`;
}

const monthYear = (at: Date) => new Intl.DateTimeFormat("en-CA", { month: "short", year: "numeric", timeZone: businessZone(at) }).format(at);
const calendarDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

export interface PresentationInput {
  view: ProposalViewV2;
  template: ProposalTemplate;
  company: CompanyInput & { tagline?: string };
  documents: CurrentDocument[];
  /** Media ids that exist and are ready; any other `media:` reference falls back to the default slot. */
  knownMedia: Set<string>;
  mode: PresentationMode;
  token?: string;
}

/** Pure: everything the presentation needs, from already-loaded settings. */
export function presentationFrom(input: PresentationInput): Presentation {
  const { view, template: tpl, mode } = input;
  const resolved = resolveJobType(tpl, view.jobType, view.scopes);
  const fallback = resolveJobType(DEFAULT_PROPOSAL_TEMPLATE, view.jobType, view.scopes);
  const company = companyBlock(input.company);
  const phone = company.phones[0]?.number ?? "";
  const values: TokenValues = { companyName: company.displayName, companyPhone: phone, jobTypeLabel: resolved.label };
  const fill = (s: string) => fillTokens(s, values);
  const prose = (s: string) => parseProse(fill(s));

  const usable = (ref: ImageRef | null | undefined) => {
    if (!ref) return false;
    const id = mediaId(ref.src);
    return !id || input.knownMedia.has(id);
  };
  const image = (ref: ImageRef, fallbackRef: ImageRef): PresentationImage => {
    const r = usable(ref) ? ref : fallbackRef;
    return { url: imageUrl(r), alt: r.alt, focalX: r.focalX, focalY: r.focalY };
  };
  const link = (l: { label: string; href: string }): PresentationLink => ({ label: l.label, href: l.href, external: /^https:/i.test(l.href) });

  const reviewsInScope = tpl.reviews.items.filter((r) => appliesToScopes(r.jobType, view.scopes));
  const reviews = (reviewsInScope.length ? reviewsInScope : tpl.reviews.items).map((r) => ({ id: r.id, quote: r.quote, author: r.author, rating: r.rating, featured: r.featured }));
  const featured = reviews.find((r) => r.featured) ?? null;
  const strip = (r: (typeof reviews)[number]): Review => ({ id: r.id, quote: r.quote, author: r.author, rating: r.rating });

  const docs = visibleDocuments(input.documents).map((d) => ({
    label: documentLabel(d),
    href: mode === "sample" || mode === "draft" || !input.token ? `/api/media/${d.id}` : `/share/p/${input.token}/documents/${d.purpose}`,
    updated: d.readyAt ? `Updated ${monthYear(d.readyAt)}` : "",
    validTo: d.expiresOn ? `Valid to ${calendarDay(d.expiresOn)}` : null,
  }));

  const D = DEFAULT_PROPOSAL_TEMPLATE;
  const introText = [resolved.cover.intro, tpl.cover.introClosing].filter((s) => s.trim()).join("\n\n");
  return {
    jobTypeLabel: resolved.label,
    topBar: { displayName: company.displayName, phone, tel: telHref(phone) },
    nav: [
      { id: "about", label: tpl.nav.about },
      { id: "why-us", label: tpl.nav.whyUs },
      { id: "reviews", label: tpl.nav.reviews },
      { id: "portfolio", label: tpl.nav.portfolio },
      { id: "insurance", label: tpl.nav.insurance },
      { id: "your-project", label: tpl.nav.yourProject },
      { id: "terms", label: tpl.nav.terms },
      { id: "next-step", label: tpl.nav.nextStep },
    ],
    cover: {
      wordmark: company.displayName,
      tagline: input.company.tagline ?? "",
      headline: cleanupHeadline(resolved.cover.headline, view.firstName, values),
      intro: prose(introText),
      hero: image(resolved.cover.heroImage, fallback.cover.heroImage),
      ctaLabel: tpl.cover.ctaLabel,
      statement: statementSegments(fill(resolved.cover.statement)),
      statementBody: prose(tpl.cover.statementBody),
    },
    about: {
      banner: tpl.about.banner,
      goodHands: { title: tpl.about.goodHands.title, body: prose(tpl.about.goodHands.body), image: image(tpl.about.goodHands.image, D.about.goodHands.image) },
      history: { title: tpl.about.history.title, body: prose(tpl.about.history.body), image: image(tpl.about.history.image, D.about.history.image) },
      connectLabel: tpl.about.connectLabel,
    },
    whyUs: {
      banner: tpl.whyUs.banner,
      tiles: tpl.whyUs.tiles.map((t, i) => ({ id: t.id, title: t.title, text: fill(t.text), icon: image(t.icon, D.whyUs.tiles[i]?.icon ?? D.whyUs.tiles[0].icon) })),
      cta: link(tpl.links.learnMore),
    },
    reviews: { banner: tpl.reviews.banner, featured: featured ? strip(featured) : null, items: reviews.filter((r) => r !== featured).map(strip), cta: link(tpl.links.reviews) },
    portfolio: {
      banner: tpl.portfolio.banner,
      photos: resolved.portfolio.filter(usable).map((r) => ({ url: imageUrl(r), alt: r.alt, focalX: r.focalX, focalY: r.focalY })),
      cta: link(tpl.links.portfolio),
    },
    resources: {
      banner: tpl.resources.banner,
      intro: prose(tpl.resources.intro),
      insurance: { title: tpl.resources.insurance.title, body: prose(tpl.resources.insurance.body), image: image(resolved.insuranceImage, fallback.insuranceImage), documents: docs },
      faq: { title: tpl.resources.faq.title, body: prose(tpl.resources.faq.body), image: image(resolved.faqImage, fallback.faqImage), link: link(tpl.links.faq) },
    },
    estimateBanner: tpl.estimateDocument.banner,
    nextStep: {
      banner: tpl.nextStep.banner,
      image: tpl.nextStep.image && usable(tpl.nextStep.image) ? image(tpl.nextStep.image, tpl.nextStep.image) : null,
      heading: tpl.nextStep.heading,
      steps: tpl.nextStep.steps.map(fill),
      totalLabel: tpl.nextStep.totalLabel,
      acceptLabel: tpl.nextStep.acceptLabel,
      declineLabel: tpl.nextStep.declineLabel,
      agreeLabel: tpl.nextStep.agreeLabel,
    },
    social: { facebook: tpl.links.facebook, instagram: tpl.links.instagram, website: tpl.links.website || company.website, phone: telHref(phone) },
  };
}

async function readyMediaIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ id: media.id })
    .from(media)
    .where(and(inArray(media.id, ids), eq(media.status, "ready"), eq(media.kind, "image")));
  return new Set(rows.map((r) => r.id));
}

/** Load current settings and documents, then build the presentation. Loaders can be injected (tests, previews). */
export async function buildPresentation(
  view: ProposalViewV2,
  opts: {
    mode?: PresentationMode;
    token?: string;
    deps?: Partial<{ template: ProposalTemplate; company: PresentationInput["company"]; documents: CurrentDocument[]; knownMedia: Set<string> }>;
  } = {},
): Promise<Presentation> {
  const [template, company, documents] = await Promise.all([
    opts.deps?.template ?? getProposalTemplate(),
    opts.deps?.company ?? getCompany(),
    opts.deps?.documents ?? currentDocuments(),
  ]);
  const knownMedia = opts.deps?.knownMedia ?? (await readyMediaIds(mediaRefs(template)));
  return presentationFrom({ view, template, company, documents, knownMedia, mode: opts.mode ?? "customer", token: opts.token });
}
