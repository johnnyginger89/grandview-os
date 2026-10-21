import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { LinkButton, PageHeader } from "@/components/ui";
import type { Role } from "@/db/schema/auth";
import { requirePermission } from "@/lib/authz/guard";
import { isFieldRole, ROLE_LABELS } from "@/lib/authz/permissions";
import { parseIso, todayIso } from "@/lib/calendar-date";
import { bcStatHolidays } from "@/lib/schedule/holidays";
import { listCrews } from "@/server/crews";
import { getHoursPerCrewDay, getScheduleSettings } from "@/server/schedule-settings";
import { listUsers } from "@/server/users";
import { CalendarPanel } from "./calendar-panel";
import { CrewsPanel, type MemberOption } from "./crews-panel";
import { ReadinessPanel } from "./readiness-panel";

export const metadata = { title: "Schedule setup" };

const TABS = [
  { key: "crews", label: "Crews" },
  { key: "calendar", label: "Calendar" },
  { key: "readiness", label: "Readiness checks" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const isTab = (v: unknown): v is TabKey => TABS.some((t) => t.key === v);

async function memberOptions(): Promise<MemberOption[]> {
  const users = (await listUsers()).filter((u) => u.active);
  // Field roles first: they're who crews are usually made of.
  return users
    .map((u) => ({ id: u.id, name: u.name, roleLabel: ROLE_LABELS[u.role as Role] ?? u.role, field: isFieldRole(u.role) }))
    .sort((a, b) => Number(b.field) - Number(a.field) || a.name.localeCompare(b.name));
}

export default async function ScheduleSetupPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  await requirePermission("schedule.manage");
  const requested = (await searchParams).tab;
  const tab: TabKey = isTab(requested) ? requested : "crews";
  const settings = await getScheduleSettings();

  return (
    <>
      <PageHeader
        title="Schedule setup"
        description="Your crews, the days you work and the checks a job needs before it starts."
        actions={
          <LinkButton href="/schedule" variant="secondary">
            <ArrowLeft className="size-4" aria-hidden /> Back to schedule
          </LinkButton>
        }
      />
      <nav aria-label="Schedule setup tabs" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/schedule/setup?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === t.key ? "border-brand text-brand" : "border-transparent text-muted hover:text-text"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "crews" && (
        <CrewsPanel
          crews={await listCrews({ includeInactive: true, withMembers: true })}
          users={await memberOptions()}
          defaults={{ crewSize: settings.defaultCrewSize, hoursPerDay: await getHoursPerCrewDay() }}
        />
      )}
      {tab === "calendar" && (
        <CalendarPanel
          settings={settings}
          holidays={[0, 1].map((i) => {
            const year = parseIso(todayIso()).y + i;
            return { year, days: bcStatHolidays(year).map((h) => ({ date: h.date, label: h.label })) };
          })}
        />
      )}
      {tab === "readiness" && <ReadinessPanel settings={settings} />}
    </>
  );
}
