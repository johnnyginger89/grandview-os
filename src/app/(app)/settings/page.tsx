import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { messageTemplates } from "@/db/schema";
import { COMPANY_PREFILL } from "@/db/seed-data";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { getCompany, getList, getPricing } from "@/server/settings";
import { listUsers } from "@/server/users";
import { CompanyForm, IntegrationsInfo, ListsForm, PricingForm, TemplatesForm, UsersPanel } from "./settings-client";
import { SettingsTabs } from "./tabs";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await requirePermission("settings.manage");
  const { tab = "company" } = await searchParams;
  if (tab === "proposals") redirect("/settings/proposals");
  const appUrl = process.env.APP_URL ?? "";
  return (
    <>
      <PageHeader title="Settings" description="Changes apply to new records. Existing estimates keep the values they were created with." />
      <SettingsTabs active={tab} showUsers={can(me.role, "users.manage")} />
      {tab === "company" && <CompanyForm company={await getCompany()} prefill={COMPANY_PREFILL} />}
      {tab === "pricing" && <PricingForm pricing={await getPricing()} />}
      {tab === "lists" && <ListsForm lists={{ lead_sources: await getList("lead_sources"), lost_reasons: await getList("lost_reasons"), project_types: await getList("project_types") }} />}
      {tab === "templates" && <TemplatesForm templates={(await db.query.messageTemplates.findMany({ orderBy: asc(messageTemplates.name) })).map((t) => ({ id: t.id, name: t.name, subject: t.subject ?? "", body: t.body }))} />}
      {tab === "users" && can(me.role, "users.manage") && (
        <UsersPanel meId={me.id} isOwner={me.role === "owner"} users={(await listUsers()).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, mfa: !!u.twoFactorEnabled }))} />
      )}
      {tab === "integrations" && <IntegrationsInfo appUrl={appUrl} />}
    </>
  );
}
