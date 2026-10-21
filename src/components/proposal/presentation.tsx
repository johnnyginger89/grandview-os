import Image from "next/image";
import { FileText } from "lucide-react";
import type { Presentation } from "@/server/proposal-presentation";
import type { ProposalViewV2 } from "@/server/proposal-view";
import type { ProposalTotals } from "@/server/proposals";
import { Contract } from "./contract";
import { EstimateDocument } from "./estimate-document";
import { Blocks, BrandIcon, CtaBar, ExternalHint, MediaRow, NavyBand, Photo, Section, SectionBanner, Stars } from "./parts";
import { PhotoGrid } from "./photo-grid";
import { SectionNav } from "./section-nav";
import { SignPanel } from "./sign-panel";
import { MobileStickyCta, ProposalStateProvider, StatusBanner, type AcceptInput, type ProposalMode } from "./state";

type Result = { ok: true } | { ok: false; error: string };

export interface PresentationData {
  status: string;
  view: ProposalViewV2;
  initialSelection: string[];
  totals: ProposalTotals;
  accepted: { name: string; at: string; signature: string; hash: string; message: string | null } | null;
}

const NOTICES: Partial<Record<ProposalMode, { tone: string; text: string }>> = {
  staff: { tone: "bg-info-soft text-info", text: "Staff preview: you're signed in, so this visit isn't counted as a customer view." },
  draft: { tone: "bg-warning-soft text-warning", text: "Draft preview: not sent. This is what the customer will see." },
  sample: { tone: "bg-danger text-white", text: "SAMPLE PROPOSAL: example data only, not a real customer." },
};

export function ProposalPresentation({
  mode,
  data,
  presentation: p,
  preview,
  acceptAction,
  declineAction,
}: {
  mode: ProposalMode;
  data: PresentationData;
  presentation: Presentation;
  preview: (selectedIds: string[]) => Promise<ProposalTotals | null>;
  acceptAction?: (input: AcceptInput) => Promise<Result>;
  declineAction?: (reason: string) => Promise<Result>;
}) {
  const { view } = data;
  const notice = NOTICES[mode];
  const contact = view.company.phones[0]?.number || view.company.email;
  const signLabel = "Review & sign";
  const navLabel = (id: string) => p.nav.find((n) => n.id === id)?.label ?? id;
  const social = [
    p.social.facebook && { name: "facebook" as const, href: p.social.facebook, label: "Facebook" },
    p.social.instagram && { name: "instagram" as const, href: p.social.instagram, label: "Instagram" },
    p.social.website && { name: "website" as const, href: p.social.website, label: "Website" },
  ].filter((x): x is { name: "facebook" | "instagram" | "website"; href: string; label: string } => !!x);

  return (
    <ProposalStateProvider
      mode={mode}
      initialStatus={data.status}
      initialSelection={data.initialSelection}
      initialTotals={data.totals}
      preview={preview}
      acceptAction={acceptAction}
      declineAction={declineAction}
    >
      <a href="#your-project" className="sr-only z-50 rounded bg-brand px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to your estimate
      </a>
      <SectionNav items={p.nav} name={p.topBar.displayName} phone={p.topBar.phone} tel={p.topBar.tel} signLabel={signLabel} />

      <div className="min-h-screen bg-surface pb-24 text-text lg:pb-0 print:pb-0">
        {notice && <p className={`px-4 py-2 text-center text-sm font-medium print:hidden ${notice.tone}`}>{notice.text}</p>}

        <main className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="pt-4 empty:hidden print:hidden">
            <StatusBanner contact={contact} />
          </div>

          {/* Cover */}
          <section id="cover" aria-label="Cover" className="scroll-mt-28 print:hidden">
            <div id="cover-header" className="-mx-4 flex items-center justify-between gap-6 bg-bg px-4 py-8 sm:-mx-6 sm:px-10 lg:py-12">
              <div>
                <p className="hidden font-[family-name:var(--font-display)] text-[28px] font-bold leading-none text-brand sm:block lg:text-5xl">{p.cover.wordmark}</p>
                <Image src="/brand/logo-blue.png" alt={p.cover.wordmark} width={180} height={90} className="h-auto w-40 sm:hidden" priority />
                {p.cover.tagline && <p className="mt-3 text-[13px] font-bold uppercase tracking-[0.06em] lg:mt-5 lg:text-[15px]">{p.cover.tagline}</p>}
              </div>
              <Image src="/brand/logo-blue.png" alt="" width={200} height={100} className="hidden h-auto w-40 sm:block lg:w-[200px]" priority />
            </div>
            <div className="-mx-4 grid items-center gap-6 bg-surface-2 sm:-mx-6 lg:grid-cols-2 lg:gap-12 lg:px-6 lg:py-14">
              <Photo image={p.cover.hero} testId="cover-photo" priority sizes="(min-width: 1024px) 50vw, 100vw" className="aspect-[3/2] rounded-none lg:rounded-xl" />
              <div className="px-4 pb-8 sm:px-6 lg:px-0 lg:pb-0">
                <h1 className="font-[family-name:var(--font-sans)] text-[28px] font-medium leading-tight lg:text-[44px]">{p.cover.headline}</h1>
                <Blocks blocks={p.cover.intro} className="mt-5 max-w-[60ch] text-[17px] leading-relaxed" />
                <a href="#about" className="mt-8 flex h-14 w-full items-center justify-center rounded-full bg-brand px-10 text-lg font-medium text-white hover:bg-brand-hover sm:inline-flex sm:w-auto">
                  {p.cover.ctaLabel}
                </a>
                <p className="mt-4">
                  <a href="#your-project" className="text-sm font-medium text-brand underline-offset-2 hover:underline">Skip to your estimate ↓</a>
                </p>
              </div>
            </div>
            <div className="py-12 lg:py-16">
              <p className="font-[family-name:var(--font-display)] text-[28px] font-bold uppercase leading-[1.05] sm:text-[34px] lg:text-[56px]">
                {p.cover.statement.map((s, i) => (
                  <span key={i} className={s.tone === "teal" ? "text-accent" : "text-brand-hover"}>{s.text}</span>
                ))}
              </p>
              <Blocks blocks={p.cover.statementBody} className="mt-8 max-w-[70ch] text-[17px] leading-relaxed" />
            </div>
          </section>

          {/* Print-only header */}
          <div className="hidden items-center justify-between border-b border-border pb-4 print:flex">
            <Image src="/brand/logo-blue.png" alt={view.company.displayName} width={160} height={80} className="h-auto w-36" />
            <p className="text-right text-sm">Proposal for <strong>{view.customerName}</strong><br />{view.title}</p>
          </div>

          <Section id="about" className="print:hidden">
            <SectionBanner id="about-title" title={p.about.banner.title} subtitle={p.about.banner.subtitle} />
            <div className="mt-8 space-y-10 lg:mt-12">
              <MediaRow title={p.about.goodHands.title} body={p.about.goodHands.body} image={p.about.goodHands.image} />
              <MediaRow title={p.about.history.title} body={p.about.history.body} image={p.about.history.image} reverse surface portrait />
              {(social.length > 0 || p.topBar.phone) && (
                <div className="flex flex-wrap items-center gap-3">
                  {p.about.connectLabel && <span className="mr-2 font-medium">{p.about.connectLabel}</span>}
                  {social.map((s) => (
                    <a key={s.name} href={s.href} target="_blank" rel="noopener" aria-label={`${s.label} (opens in a new tab)`} className="grid size-11 place-items-center rounded-full bg-accent text-white hover:brightness-95">
                      <BrandIcon name={s.name} />
                    </a>
                  ))}
                  {p.topBar.phone && (
                    <a href={p.social.phone} className="flex items-center gap-3 font-medium hover:text-brand">
                      <span className="grid size-11 place-items-center rounded-full bg-accent text-white"><BrandIcon name="phone" /></span>
                      {p.topBar.phone}
                    </a>
                  )}
                </div>
              )}
            </div>
          </Section>

          <Section id="why-us" className="print:hidden">
            <SectionBanner id="why-us-title" title={p.whyUs.banner.title} subtitle={p.whyUs.banner.subtitle} />
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:mt-12 lg:grid-cols-3 lg:gap-6">
              {p.whyUs.tiles.map((t) => (
                <li key={t.id} className="rounded-xl border border-border bg-surface p-6">
                  <Image src={t.icon.url} alt="" width={80} height={80} className="size-20 object-contain" />
                  <h3 className="mt-4 font-[family-name:var(--font-display)] text-xl font-bold">{t.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted lg:text-base">{t.text}</p>
                </li>
              ))}
            </ul>
            <CtaBar link={p.whyUs.cta} />
          </Section>

          <Section id="reviews" className="print:hidden">
            <SectionBanner id="reviews-title" title={p.reviews.banner.title} subtitle={p.reviews.banner.subtitle} />
            {p.reviews.featured && (
              <figure className="mx-auto mt-10 max-w-[60ch] text-center lg:mt-14">
                <span className="block font-[family-name:var(--font-display)] text-7xl leading-none text-accent" aria-hidden="true">“</span>
                <blockquote className="text-lg italic leading-relaxed lg:text-xl">{p.reviews.featured.quote}</blockquote>
                <figcaption className="mt-4 flex flex-col items-center gap-2 text-sm font-bold">
                  <Stars rating={p.reviews.featured.rating} />
                  {p.reviews.featured.author}
                </figcaption>
              </figure>
            )}
            {p.reviews.items.length > 0 && (
              <ul className="mt-10 grid gap-4 md:grid-cols-3 lg:gap-6">
                {p.reviews.items.map((r) => (
                  <li key={r.id}>
                    <figure className="h-full rounded-xl border border-border bg-surface p-6">
                      <Stars rating={r.rating} />
                      <blockquote className="mt-3 text-[15px] leading-relaxed lg:text-base">{r.quote}</blockquote>
                      <figcaption className="mt-3 text-sm font-bold text-muted">{r.author}</figcaption>
                    </figure>
                  </li>
                ))}
              </ul>
            )}
            <CtaBar link={p.reviews.cta} />
          </Section>

          {p.portfolio.photos.length > 0 && (
            <Section id="portfolio" className="print:hidden">
              <SectionBanner id="portfolio-title" title={p.portfolio.banner.title} subtitle={p.portfolio.banner.subtitle} />
              <div className="mt-8 lg:mt-12"><PhotoGrid photos={p.portfolio.photos} /></div>
              <CtaBar link={p.portfolio.cta} />
            </Section>
          )}

          <Section id="insurance" className="print:hidden">
            <SectionBanner id="insurance-title" title={p.resources.banner.title} subtitle={p.resources.banner.subtitle} />
            <div className="mt-8 space-y-10 lg:mt-12">
              <NavyBand blocks={p.resources.intro} />
              <MediaRow title={p.resources.insurance.title} body={p.resources.insurance.body} image={p.resources.insurance.image}>
                {p.resources.insurance.documents.length > 0 && (
                  <ul className="mt-6 space-y-3">
                    {p.resources.insurance.documents.map((d) => (
                      <li key={d.href}>
                        <a href={d.href} target="_blank" rel="noopener" className="inline-flex min-h-11 items-start gap-3 rounded-md border border-border-strong bg-surface px-4 py-2.5 hover:bg-surface-2">
                          <FileText className="mt-0.5 size-5 shrink-0 text-brand" />
                          <span>
                            <span className="block font-medium">{d.label}<span className="sr-only"> (opens in a new tab)</span></span>
                            <span className="block text-xs text-muted">{[d.updated, d.validTo].filter(Boolean).join(" · ")}</span>
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </MediaRow>
              <hr className="border-border" />
              <MediaRow title={p.resources.faq.title} body={p.resources.faq.body} image={p.resources.faq.image} reverse>
                <a
                  href={p.resources.faq.link.href}
                  {...(p.resources.faq.link.external ? { target: "_blank", rel: "noopener" } : {})}
                  className="mt-6 inline-flex min-h-11 items-center rounded-md border border-border-strong bg-surface px-4 font-medium hover:bg-surface-2"
                >
                  {p.resources.faq.link.label}
                  <ExternalHint link={p.resources.faq.link} />
                </a>
              </MediaRow>
            </div>
          </Section>
        </main>

        <div className="bg-bg print:bg-white">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Section id="your-project" className="print:py-4">
              <SectionBanner id="your-project-title" title={p.estimateBanner.title || navLabel("your-project")} subtitle={p.estimateBanner.subtitle} logo={false} className="bg-surface print:hidden" />
              <div className="mt-8 lg:mt-12 print:mt-0"><EstimateDocument view={view} /></div>
            </Section>
          </div>
        </div>

        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Section id="terms" className="print:break-before-page">
            <SectionBanner id="terms-title" title={view.contract.banner.title || navLabel("terms")} subtitle={view.contract.banner.subtitle} />
            <div className="mt-8 lg:mt-12"><Contract contract={view.contract} /></div>
          </Section>

          <Section id="next-step">
            <SectionBanner id="next-step-title" title={p.nextStep.banner.title} subtitle={p.nextStep.banner.subtitle} tone="accent" />
            {p.nextStep.image && <Photo image={p.nextStep.image} sizes="100vw" className="mt-8 aspect-[21/9] print:hidden" />}
            <h3 className="mt-10 text-center font-[family-name:var(--font-display)] text-2xl font-bold uppercase tracking-wide print:hidden">{p.nextStep.heading}</h3>
            <ol className="mt-6 grid gap-4 md:grid-cols-3 print:hidden">
              {p.nextStep.steps.map((s, i) => (
                <li key={i} className="flex gap-4 rounded-xl border border-border bg-surface p-5 md:flex-col md:gap-2">
                  <span className="font-[family-name:var(--font-display)] text-[32px] font-bold leading-none text-accent">{i + 1}</span>
                  <span className="text-base lg:text-lg">{s}</span>
                </li>
              ))}
            </ol>
            <div className="mt-10">
              <SignPanel
                labels={{ totalLabel: p.nextStep.totalLabel, acceptLabel: p.nextStep.acceptLabel, declineLabel: p.nextStep.declineLabel, agreeLabel: p.nextStep.agreeLabel }}
                options={view.options.map((o) => ({ id: o.id, title: o.title, price: o.price }))}
                gstNote={view.showTaxLine ? "GST included" : null}
                depositNote="Deposit due on acceptance"
                accepted={data.accepted}
              />
            </div>
          </Section>
        </div>

        <footer className="border-t border-border print:border-0">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-subtle sm:px-6">
            <span>{view.company.displayName} · {view.labels.documentTitle} # {view.displayNumber}</span>
            {view.company.website && <a href={view.company.website} target="_blank" rel="noopener" className="hover:underline print:hidden">{view.company.website.replace(/^https?:\/\//, "")}</a>}
          </div>
        </footer>
      </div>
      <MobileStickyCta label={signLabel} />
    </ProposalStateProvider>
  );
}
