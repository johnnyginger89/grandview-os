import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Delta } from "@/components/reporting/delta";
import { GoalMeter } from "@/components/reporting/goal-meter";
import { KpiTile } from "@/components/reporting/kpi-tile";
import { definitionText } from "@/lib/reporting/definitions";
import { formatCADWhole, formatCount, formatWeeks } from "@/lib/reporting/format";
import type { SnapshotDTO } from "@/lib/reporting/types";

const PERFORMANCE = "/performance";

/** "This month" on the home page. Money tiles only exist in the DTO for financials.read. */
export function MonthSnapshot({ data }: { data: SnapshotDTO }) {
  const { counts: c, money: m, period } = data;
  const vs = period.comparisonLabel;
  const leads = (
    <KpiTile
      testId="snapshot-leads"
      href={PERFORMANCE}
      label="Leads this month"
      value={formatCount(c.leads.value)}
      raw={c.leads.value}
      title={definitionText("leads")}
      delta={<Delta kpi={c.leads} kind="count" dir="up_good" vs={vs} />}
    />
  );
  return (
    <section aria-labelledby="month-snapshot-title" className="mb-4">
      <h2 id="month-snapshot-title" className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">
        This month <span className="normal-case tracking-normal">· {period.currentLabel}</span>
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {m ? (
          <>
            <KpiTile
              testId="snapshot-sales"
              href={PERFORMANCE}
              label="Sales this month"
              value={formatCADWhole(m.sales.value)}
              raw={m.sales.value}
              title={definitionText("sales")}
              delta={<Delta kpi={m.sales} kind="money" dir="up_good" vs={vs} />}
            >
              {m.salesGoal && <GoalMeter label="Sales goal" progress={m.salesGoal} goalName={period.goalName} />}
            </KpiTile>
            <KpiTile
              testId="snapshot-produced"
              href={PERFORMANCE}
              label="Produced this month"
              value={formatCADWhole(m.produced.value)}
              raw={m.produced.value}
              title={definitionText("produced")}
              delta={<Delta kpi={m.produced} kind="money" dir="up_good" vs={vs} />}
            />
            <KpiTile
              testId="snapshot-backlog"
              href={PERFORMANCE}
              label="Backlog"
              value={formatCADWhole(m.backlog)}
              raw={m.backlog}
              title={definitionText("backlog")}
              hint={`${formatCount(m.backlogJobs)} ${m.backlogJobs === 1 ? "job" : "jobs"}${m.backlogWeeks ? ` · ${formatWeeks(m.backlogWeeks)}` : ""}`}
            />
            {leads}
          </>
        ) : (
          <>
            {leads}
            <KpiTile
              testId="snapshot-visits-booked"
              href={PERFORMANCE}
              label="Visits booked"
              value={formatCount(c.visitsBooked.value)}
              raw={c.visitsBooked.value}
              title={definitionText("visitsBooked")}
              delta={<Delta kpi={c.visitsBooked} kind="count" dir="up_good" vs={vs} />}
            />
            <KpiTile
              testId="snapshot-proposals-sent"
              href={PERFORMANCE}
              label="Proposals sent"
              value={formatCount(c.proposalsSent.value)}
              raw={c.proposalsSent.value}
              title={definitionText("proposalsSent")}
              delta={<Delta kpi={c.proposalsSent} kind="count" dir="up_good" vs={vs} />}
            />
            <KpiTile
              testId="snapshot-jobs-sold"
              href={PERFORMANCE}
              label="Jobs sold"
              value={formatCount(c.jobsSold.value)}
              raw={c.jobsSold.value}
              title={definitionText("jobsSold")}
              delta={<Delta kpi={c.jobsSold} kind="count" dir="up_good" vs={vs} />}
            />
          </>
        )}
      </div>
      <p className="mt-2 text-right">
        <Link href={PERFORMANCE} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
          Open Performance <ArrowRight className="size-4" aria-hidden />
        </Link>
      </p>
    </section>
  );
}
