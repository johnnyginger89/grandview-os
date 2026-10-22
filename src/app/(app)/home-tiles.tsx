import { count, eq, inArray } from "drizzle-orm";
import { BookOpen, Calculator, CalendarDays, ChartColumn, FileText, FolderKanban, Settings, Users, Workflow } from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";
import { db } from "@/db";
import { estimates, opportunities, pipelineStages, projects } from "@/db/schema";
import { can } from "@/lib/authz/permissions";
import { formatCAD } from "@/lib/money";
import { jobsToday } from "@/server/jobs-today";
import { getCompany } from "@/server/settings";
import { ShareBookingTile } from "./share-booking-tile";

const ACTIVE = ["need_to_schedule", "scheduled", "in_progress", "walk_through", "on_hold"] as const;

function Tile({ href, label, icon: Icon, badge }: { href: string; label: string; icon: ComponentType<{ className?: string }>; badge?: number }) {
  return (
    <Link href={href} className="relative flex aspect-[5/3] flex-col items-center justify-center gap-2 rounded-xl border border-border bg-surface text-center shadow-sm active:bg-surface-2">
      {badge ? <span className="absolute top-2 right-3 text-sm font-semibold tabular-nums text-brand">{badge}</span> : null}
      <Icon className="size-8 text-brand" />
      <span className="text-base font-medium">{label}</span>
    </Link>
  );
}

/** Phone home screen: the big-tile menu Grandview is used to from Markate. Desktop keeps the sidebar. */
export async function HomeTiles({ role }: { role: string }) {
  const now = new Date();
  const money = can(role, "financials.read");
  const [[toContact], [openEstimates], [activeJobs], [toSchedule], today, company] = await Promise.all([
    can(role, "pipeline.read")
      ? db.select({ n: count() }).from(opportunities).innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId)).where(eq(pipelineStages.key, "new_lead"))
      : [{ n: 0 }],
    can(role, "estimates.read") ? db.select({ n: count() }).from(estimates).where(inArray(estimates.status, ["draft", "sent"])) : [{ n: 0 }],
    can(role, "projects.read_all") ? db.select({ n: count() }).from(projects).where(inArray(projects.status, [...ACTIVE])) : [{ n: 0 }],
    can(role, "schedule.read") ? db.select({ n: count() }).from(projects).where(eq(projects.status, "need_to_schedule")) : [{ n: 0 }],
    jobsToday(now, { money }),
    getCompany(),
  ]);

  const jobs = `${today.count} job${today.count === 1 ? "" : "s"} today`;
  return (
    <section aria-label="Menu" className="mb-6 lg:hidden">
      <p className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted" data-testid="jobs-today">
        {money ? `${formatCAD(today.value ?? 0)} (${jobs})` : jobs}
      </p>
      <div className="grid grid-cols-2 gap-3">
        {can(role, "dashboard.view") && <Tile href="/performance" label="Performance" icon={ChartColumn} />}
        {can(role, "pipeline.read") && <Tile href="/leads" label="Leads" icon={Workflow} badge={toContact.n} />}
        {can(role, "estimates.read") && <Tile href="/estimates" label="Estimates" icon={Calculator} badge={openEstimates.n} />}
        {can(role, "customers.read") && <Tile href="/customers" label="Customers" icon={Users} />}
        {can(role, "projects.read_all") && <Tile href="/projects" label="Jobs" icon={FolderKanban} badge={activeJobs.n} />}
        {can(role, "projects.read_all") && <Tile href="/work-orders" label="Work orders" icon={FileText} />}
        {can(role, "schedule.read") && <Tile href="/schedule" label="Schedule" icon={CalendarDays} badge={toSchedule.n} />}
        {can(role, "rates.read") && <Tile href="/rates" label="Rates" icon={BookOpen} />}
        {can(role, "pipeline.read") && company.bookingUrl && <ShareBookingTile url={company.bookingUrl} companyName={company.displayName || company.name} />}
        {can(role, "settings.manage") && <Tile href="/settings" label="Settings" icon={Settings} />}
      </div>
    </section>
  );
}
