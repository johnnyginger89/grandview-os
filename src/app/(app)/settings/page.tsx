import Link from "next/link";
import { asc } from "drizzle-orm";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { messageTemplates } from "@/db/schema";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { getCompany, getList, getPricing, getProposalSettings } from "@/server/settings";
import { listUsers } from "@/server/users";
import { CompanyForm, IntegrationsInfo, ListsForm, PricingForm, ProposalSettingsForm, TemplatesForm, UsersPanel } from "./settings-client";

export const metadata = { title: "Settings" };

const TABS = [
  { key: "company", label: "Company" },
  { key: "pricing", label: "Pricing defaults" },
  { key: "proposals", label: "Proposals" },
  { key: "lists", label: "Pick lists" },
  { key: "templates", label: "Email templates" },
  { key: "users", label: "Users" },
  { key: "integrations", label: "Integrations" },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await requirePermission("settings.manage");
  const { tab = "company" } = await searchParams;
  const appUrl = process.env.APP_URL ?? "";
  return (
    <>
      <PageHeader title="Settings" description="Changes apply to new records. Existing estimates keep the values they were created with." />
      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.filter((t) => t.key !== "users" || can(me.role, "users.manage")).map((t) => (
          <Link key={t.key} href={`/settings?tab=${t.key}`} className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === t.key ? "border-brand text-brand" : "border-transparent text-muted hover:text-text"}`}>{t.label}</Link>
        ))}
      </nav>
      {tab === "company" && <CompanyForm company={await getCompany()} />}
      {tab === "pricing" && <PricingForm pricing={await getPricing()} />}
      {tab === "proposals" && <ProposalSettingsForm settings={await getProposalSettings()} />}
      {tab === "lists" && <ListsForm lists={{ lead_sources: await getList("lead_sources"), lost_reasons: await getList("lost_reasons"), project_types: await getList("project_types") }} />}
      {tab === "templates" && <TemplatesForm templates={(await db.query.messageTemplates.findMany({ orderBy: asc(messageTemplates.name) })).map((t) => ({ id: t.id, name: t.name, subject: t.subject ?? "", body: t.body }))} />}
      {tab === "users" && can(me.role, "users.manage") && (
        <UsersPanel meId={me.id} isOwner={me.role === "owner"} users={(await listUsers()).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, mfa: !!u.twoFactorEnabled }))} />
      )}
      {tab === "integrations" && <IntegrationsInfo appUrl={appUrl} />}
    </>
  );
}
