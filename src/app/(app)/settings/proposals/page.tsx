import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { ProposalEditorProvider, type LibraryImage } from "@/components/proposal-settings/editor-context";
import { DocumentsPanel, type DocumentCardData } from "@/components/proposal-settings/documents";
import { JobTypesForm, JOB_TYPE_NAMES } from "@/components/proposal-settings/job-types";
import { SectionForm } from "@/components/proposal-settings/section-form";
import { DEFAULT_PROPOSAL_TEMPLATE, SUGGESTED_NOTES } from "@/db/seed-data";
import { requirePermission } from "@/lib/authz/guard";
import { formatDate } from "@/lib/utils";
import { currentDocuments, listMedia } from "@/server/media";
import { getCompany, getProposalTemplateState, getSetting } from "@/server/settings";
import { SettingsTabs } from "../tabs";
import { ReviewedButton, SectionSelect } from "./client";
import { MENU_SECTION, PAGES } from "./sections";

export const metadata = { title: "Proposal settings" };

/** Every shipped default picture, offered in the picture library next to the owner's uploads. */
function builtInImages(): LibraryImage[] {
  const seen = new Map<string, LibraryImage>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.src === "string" && o.src.startsWith("/proposal/") && !seen.has(o.src)) seen.set(o.src, { src: o.src, url: o.src, alt: String(o.alt ?? "") });
      Object.values(o).forEach(walk);
    }
  };
  walk(DEFAULT_PROPOSAL_TEMPLATE);
  return [...seen.values()];
}

async function documentCards(): Promise<DocumentCardData[]> {
  const [docs, all] = await Promise.all([currentDocuments(), listMedia({ kind: "document" })]);
  return docs.map((d) => ({
    purpose: d.purpose,
    defaultTitle: d.defaultTitle,
    current: d.id
      ? { id: d.id, title: d.title ?? d.defaultTitle, effectiveOn: d.effectiveOn, expiresOn: d.expiresOn, uploaded: d.readyAt ? formatDate(d.readyAt) : "", status: d.status as "valid" | "expiring" | "expired" }
      : null,
    previous: all
      .filter((m) => m.purpose === d.purpose && m.id !== d.id)
      .map((m) => ({ id: m.id, title: m.title ?? d.defaultTitle, uploaded: m.readyAt ? formatDate(m.readyAt) : "", expiresOn: m.expiresOn, hidden: !!m.archivedAt })),
  }));
}

const DOC_TONE = { valid: "success", expiring: "warning", expired: "danger", missing: "danger" } as const;

async function Overview() {
  const [company, docs, reviewed, { invalidSections }] = await Promise.all([getCompany(), currentDocuments(), getSetting<string[]>("proposal_template_review", []), getProposalTemplateState()]);
  const missing = ([["phone", "Phone"], ["address", "Address"], ["gstNumber", "GST number"]] as const).filter(([k]) => !String((company as Record<string, unknown>)[k] ?? "").trim());
  const notes = SUGGESTED_NOTES.filter((n) => !reviewed.includes(n.id));
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Preview" description="Opens a sample proposal with made-up customer details, exactly as customers see it." />
        <div className="flex flex-wrap gap-2 p-4">
          {(["interior", "exterior", "interior_exterior", "cabinets", "staining", "commercial", "strata", "repairs"] as const).map((k) => (
            <a key={k} href={`/settings/proposals/preview?jobType=${k}`} target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-2 rounded-md border border-border-strong px-3 text-sm font-medium hover:bg-surface-2">
              {JOB_TYPE_NAMES[k]} <ExternalLink className="size-3.5" />
            </a>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="Checklist" />
        <ul className="divide-y divide-border text-sm">
          {missing.length > 0 ? (
            <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span>Missing from the FROM block on every estimate: <strong>{missing.map(([, l]) => l).join(", ")}</strong></span>
              <Link href="/settings?tab=company" className="text-brand hover:underline">Company details →</Link>
            </li>
          ) : (
            <li className="px-4 py-3 text-success">Company details are complete.</li>
          )}
          {docs.map((d) => (
            <li key={d.purpose} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="flex items-center gap-2">
                <Badge tone={DOC_TONE[d.status]}>{d.status === "valid" ? "Valid" : d.status === "expiring" ? "Expires soon" : d.status === "expired" ? "Expired" : "Missing"}</Badge>
                {d.title ?? d.defaultTitle}
                {d.expiresOn && <span className="text-muted">· expires {d.expiresOn}</span>}
              </span>
              <Link href="/settings/proposals?section=documents" className="text-brand hover:underline">Insurance documents →</Link>
            </li>
          ))}
          {invalidSections.map((k) => (
            <li key={k} className="px-4 py-3 text-danger">The saved “{k}” settings couldn&apos;t be read, so the defaults are shown. Open that section and save it again.</li>
          ))}
        </ul>
      </Card>
      {notes.length > 0 && (
        <Card>
          <CardHeader title="Wording we changed or suggest" description="Your Markate wording was copied as-is, except for these. Review each one and edit it in its section if you'd like it different." />
          <ul className="divide-y divide-border text-sm">
            {notes.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="flex items-start gap-2">
                  <Badge tone={n.kind === "changed" ? "brand" : "neutral"}>{n.kind === "changed" ? "Changed" : "Suggested"}</Badge>
                  <span>{n.text}</span>
                </span>
                <ReviewedButton id={n.id} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export default async function ProposalSettingsPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const me = await requirePermission("settings.manage");
  const { section = "overview" } = await searchParams;
  const page = PAGES.find((p) => p.key === section) ?? PAGES[0];
  const { template, updatedAt } = await getProposalTemplateState();
  const D = DEFAULT_PROPOSAL_TEMPLATE;
  const jobTypes = template.jobTypes as unknown as Record<string, Record<string, unknown>>;
  const jobTypeDefaults = D.jobTypes as unknown as Record<string, Record<string, unknown>>;

  return (
    <>
      <PageHeader title="Settings" description="Your proposal's pictures, wording and insurance documents. Changes show on proposals right away." />
      <SettingsTabs active="proposals" role={me.role} />
      <div className="grid gap-6 lg:grid-cols-[13rem_1fr]">
        <div className="lg:hidden"><SectionSelect pages={PAGES.map(({ key, label }) => ({ key, label }))} active={page.key} /></div>
        <nav aria-label="Proposal settings sections" className="hidden lg:block">
          <ul className="sticky top-4 space-y-0.5">
            {PAGES.map((p) => (
              <li key={p.key}>
                <Link
                  href={`/settings/proposals?section=${p.key}`}
                  aria-current={p.key === page.key ? "page" : undefined}
                  className={`block rounded-md px-3 py-2 text-sm ${p.key === page.key ? "bg-brand-soft font-medium text-brand" : "text-muted hover:bg-surface-2 hover:text-text"}`}
                >
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-6">
          <ProposalEditorProvider version={updatedAt} builtIn={builtInImages()}>
            {page.key === "overview" && <Overview />}
            {page.key === "documents" && <DocumentsPanel docs={await documentCards()} />}
            {page.jobTypes && <JobTypesForm title={page.jobTypes.title} description={page.jobTypes.description} initial={jobTypes} defaults={jobTypeDefaults} specs={page.jobTypes.fields} />}
            {page.section && (
              <SectionForm
                section={page.section.key}
                title={page.section.title}
                description={page.section.description}
                initial={template[page.section.key]}
                defaults={D[page.section.key]}
                specs={page.section.fields}
              />
            )}
            {page.key === "links" && MENU_SECTION && (
              <SectionForm section="nav" title={MENU_SECTION.title} description={MENU_SECTION.description} initial={template.nav} defaults={D.nav} specs={MENU_SECTION.fields} />
            )}
          </ProposalEditorProvider>
        </div>
      </div>
    </>
  );
}
