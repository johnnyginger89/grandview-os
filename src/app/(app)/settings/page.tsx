import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { messageTemplates } from "@/db/schema";
import { COMPANY_PREFILL, DEFAULT_GOALS } from "@/db/seed-data";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { todayIso } from "@/lib/calendar-date";
import { getGoals } from "@/server/goals";
import { getCompany, getList, getPricing } from "@/server/settings";
import { listUsers } from "@/server/users";
import { getWorkOrderSettings } from "@/server/work-orders";
import { GoalsForm } from "./goals-form";
import { goalsToPayload } from "./goals-shared";
import { getColourFormSettings } from "@/server/colour-selections";
import { companyCamStatus } from "@/server/integrations/companycam";
import { gmailStatus } from "@/server/integrations/gmail";
import { ColourFormSettingsForm, CompanyCamSettings, CompanyForm, GmailSettings, IntegrationsInfo, ListsForm, PricingForm, TemplatesForm, UsersPanel, WorkOrderSettingsForm } from "./settings-client";
import { SettingsTabs, settingsTabAllowed } from "./tabs";

export const metadata = { title: "Settings" };

async function GoalsTab() {
  const [goals, lostReasons] = await Promise.all([getGoals(), getList("lost_reasons")]);
  const starterYears = Object.entries(DEFAULT_GOALS.years)
    .filter(([y, g]) => JSON.stringify(goals.years[y]) === JSON.stringify(g))
    .map(([y]) => y);
  const today = todayIso();
  return <GoalsForm initial={goalsToPayload(goals, today)} lostReasons={lostReasons} today={today} starterYears={starterYears} />;
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; gmail?: string; reason?: string }> }) {
  const me = await requirePermission("settings.manage");
  const sp = await searchParams;
  const { tab = "company" } = sp;
  if (tab === "proposals") redirect("/settings/proposals");
  if (!settingsTabAllowed(tab, me.role)) redirect("/no-access");
  const appUrl = process.env.APP_URL ?? "";
  return (
    <>
      <PageHeader title="Settings" description="Changes apply to new records. Existing estimates keep the values they were created with." />
      <SettingsTabs active={tab} role={me.role} />
      {tab === "company" && <CompanyForm company={await getCompany()} prefill={COMPANY_PREFILL} />}
      {tab === "pricing" && <PricingForm pricing={await getPricing()} />}
      {tab === "goals" && can(me.role, "financials.read") && <GoalsTab />}
      {tab === "lists" && <ListsForm lists={{ lead_sources: await getList("lead_sources"), lost_reasons: await getList("lost_reasons"), project_types: await getList("project_types") }} />}
      {tab === "templates" && <TemplatesForm templates={(await db.query.messageTemplates.findMany({ orderBy: asc(messageTemplates.name) })).map((t) => ({ id: t.id, name: t.name, subject: t.subject ?? "", body: t.body }))} />}
      {tab === "users" && can(me.role, "users.manage") && (
        <UsersPanel meId={me.id} isOwner={me.role === "owner"} users={(await listUsers()).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, mfa: !!u.twoFactorEnabled }))} />
      )}
      {tab === "work-orders" && (
        <>
          <WorkOrderSettingsForm settings={await getWorkOrderSettings()} />
          <ColourFormSettingsForm settings={await getColourFormSettings()} />
        </>
      )}
      {tab === "integrations" && (
        <div className="max-w-3xl space-y-4">
          <GmailSettings status={await gmailStatus()} result={{ gmail: sp.gmail, reason: sp.reason }} />
          <CompanyCamSettings status={await companyCamStatus()} />
          <IntegrationsInfo appUrl={appUrl} />
        </div>
      )}
    </>
  );
}
