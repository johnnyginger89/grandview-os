import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { resolvePeriod } from "@/lib/reporting/periods";
import { performanceQuerySchema } from "@/lib/reporting/query";
import { accessFor, getPerformance } from "@/server/dashboard";
import { getGoals } from "@/server/goals";
import { PerformanceShell } from "./performance-shell";
import { PerformanceSections } from "./sections";

export const metadata = { title: "Performance" };

// Rendered per request for the viewer's role (the guard reads headers); never cached.
export default async function PerformancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePermission("dashboard.view");
  const access = accessFor(user.role);
  const query = performanceQuerySchema.parse(await searchParams);
  const goals = await getGoals();
  const now = new Date();
  const resolved = resolvePeriod({ preset: query.period, compare: query.compare, from: query.from, to: query.to }, now, { fiscalYearStartMonth: goals.fiscalYearStartMonth });
  const dto = await getPerformance(resolved.period, access, { goals, now });

  return (
    <>
      <PageHeader
        title="Performance"
        description={access.money ? "Sales, production and leads. All amounts before GST." : "Leads, visits, proposals and jobs sold. Dollar amounts are before GST."}
      />
      <PerformanceShell
        preset={resolved.period.preset}
        compare={query.compare}
        from={query.from}
        to={query.to}
        today={resolved.period.today}
        error={resolved.ok ? null : resolved.error}
      >
        <PerformanceSections dto={dto} canEditGoals={access.money && can(user.role, "settings.manage")} />
      </PerformanceShell>
    </>
  );
}
