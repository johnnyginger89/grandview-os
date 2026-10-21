import Link from "next/link";
import type { ReactNode } from "react";
import { BarList } from "@/components/reporting/bar-list";
import { Delta } from "@/components/reporting/delta";
import { Funnel } from "@/components/reporting/funnel";
import { GoalMeter } from "@/components/reporting/goal-meter";
import { HeroFigure } from "@/components/reporting/hero-figure";
import { KpiTile } from "@/components/reporting/kpi-tile";
import { MonthlyColumns, MonthlyTable, type MonthlyGoal, type MonthlySeries } from "@/components/reporting/monthly-columns";
import { Segmented } from "@/components/reporting/segmented";
import { Sparkline } from "@/components/reporting/sparkline";
import { Card, CardHeader, EmptyState, Table, td, th } from "@/components/ui";
import { formatIsoDate } from "@/lib/calendar-date";
import { d } from "@/lib/money";
import { DEFINITION_NOTES, definitionsFor, definitionText } from "@/lib/reporting/definitions";
import { DASH, formatCADCompact, formatCADWhole, formatCount, formatDays, formatRatio, formatWeeks, niceTicks, truncate } from "@/lib/reporting/format";
import { ratio } from "@/lib/reporting/kpi";
import type { MonthlyDTO, PerformanceDTO, PerformanceMoney } from "@/lib/reporting/types";
import { cn } from "@/lib/utils";

/*
 * Every section renders only from the role-shaped DTO. Money tiles and keys exist
 * only when dto.money is present, so they never reach a count-only page.
 */

export interface SectionsProps {
  dto: PerformanceDTO;
  /** Shows the "Set goals" link (owner: settings.manage + financials.read). */
  canEditGoals: boolean;
}

const plural = (n: string | number | null, one: string, many: string) => (Number(n) === 1 ? one : many);

/** A secondary figure beside a headline, with its own test id and raw value. */
function SubKpi({ testId, raw, children, suffix }: { testId: string; raw: string | null; children: ReactNode; suffix?: ReactNode }) {
  return (
    <span data-testid={testId}>
      <span data-value={raw ?? ""} className="font-medium text-text">
        {children}
      </span>
      {suffix}
    </span>
  );
}

export function PerformanceSections({ dto, canEditGoals }: SectionsProps) {
  const noHistory = !dto.counts.leads.compareAvailable;
  return (
    <div className="space-y-4">
      {noHistory && (
        <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-info">
          {dto.dataStartsAt
            ? `Comparisons show a dash until there's history to compare with: records in Grandview OS start ${formatIsoDate(dto.dataStartsAt)}.`
            : "Comparisons will appear once there are leads and sales to compare with."}
        </p>
      )}
      {dto.money ? <MoneyHero dto={dto} money={dto.money} canEditGoals={canEditGoals} /> : <CountHero dto={dto} />}
      <KpiGrid dto={dto} />
      <MonthlyCard dto={dto} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SourcesCard dto={dto} />
        <FunnelCard dto={dto} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <LostCard dto={dto} />
        <PeopleCard dto={dto} />
      </div>
      <Definitions money={!!dto.money} />
    </div>
  );
}

function NoGoal({ what, canEditGoals }: { what: string; canEditGoals: boolean }) {
  return (
    <p className="mt-3 text-xs text-muted">
      No {what} goal covers these dates.{" "}
      {canEditGoals ? (
        <Link href="/settings?tab=goals" className="text-brand hover:underline">
          Set goals
        </Link>
      ) : (
        "The owner sets goals in Settings."
      )}
    </p>
  );
}

function MoneyHero({ dto, money: m, canEditGoals }: { dto: PerformanceDTO; money: PerformanceMoney; canEditGoals: boolean }) {
  const c = dto.counts;
  const vs = dto.period.comparisonLabel;
  const cancelled = d(m.cancelled.value);
  const run = m.goals.runRate;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="p-5">
        <HeroFigure
          testId="kpi-sales"
          label="Sales"
          period={dto.period.currentLabel}
          value={formatCADWhole(m.sales.value)}
          raw={m.sales.value}
          title={definitionText("sales")}
          delta={<Delta kpi={m.sales} kind="money" dir="up_good" vs={vs} className="text-sm" />}
        />
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
          <SubKpi testId="kpi-jobs-sold" raw={c.jobsSold.value} suffix={` ${plural(c.jobsSold.value, "job", "jobs")}`}>
            {formatCount(c.jobsSold.value)}
          </SubKpi>
          <span>
            avg{" "}
            <SubKpi testId="kpi-average-sale" raw={m.averageSale.value}>
              {m.averageSale.value ? formatCADWhole(m.averageSale.value) : DASH}
            </SubKpi>
          </span>
          <SubKpi testId="kpi-cancelled" raw={m.cancelled.value} suffix=" cancelled">
            {cancelled.isZero() ? "$0" : `−${formatCADWhole(cancelled)}`}
          </SubKpi>
          {!cancelled.isZero() && (
            <span>
              net <span className="font-medium text-text">{formatCADWhole(m.netSales.value)}</span>
            </span>
          )}
        </p>
        {m.goals.sales ? <GoalMeter label="Sales goal" progress={m.goals.sales} goalName={dto.period.goalName} /> : <NoGoal what="sales" canEditGoals={canEditGoals} />}
        {run && (
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted" data-testid="kpi-run-rate">
            Last 12 months: <span className="font-medium text-text">{formatCADWhole(run.trailing12)}</span>, {formatRatio(run.pct)} of the {formatCADWhole(run.target)} target for {run.year}.
          </p>
        )}
      </Card>

      <Card className="p-4">
        <KpiTile
          plain
          testId="kpi-produced"
          label="Produced"
          value={formatCADWhole(m.produced.value)}
          raw={m.produced.value}
          title={definitionText("produced")}
          delta={<Delta kpi={m.produced} kind="money" dir="up_good" vs={vs} />}
        />
        <p className="mt-2 text-xs text-muted">
          <SubKpi testId="kpi-jobs-completed" raw={c.jobsCompleted.value} suffix={` ${plural(c.jobsCompleted.value, "job", "jobs")} finished`}>
            {formatCount(c.jobsCompleted.value)}
          </SubKpi>
        </p>
        {m.goals.produced ? (
          <GoalMeter label="Produced goal" series="produced" progress={m.goals.produced} goalName={dto.period.goalName} />
        ) : (
          <NoGoal what="production" canEditGoals={canEditGoals} />
        )}
      </Card>

      <Card className="p-4">
        <KpiTile
          plain
          testId="kpi-backlog"
          label={dto.period.inProgress ? "Backlog now" : "Backlog at period end"}
          value={formatCADWhole(m.backlog.value)}
          raw={m.backlog.value}
          title={definitionText("backlog")}
          delta={<Delta kpi={m.backlog} kind="money" dir="neutral" vs={vs} />}
        />
        <p className="mt-2 flex flex-wrap gap-x-2 text-xs text-muted">
          <SubKpi testId="kpi-backlog-jobs" raw={c.backlogJobs.value} suffix={` ${plural(c.backlogJobs.value, "job", "jobs")}`}>
            {formatCount(c.backlogJobs.value)}
          </SubKpi>
          {m.backlogWeeks.value && (
            <>
              <span aria-hidden>·</span>
              <span title={definitionText("backlogWeeks")}>{formatWeeks(m.backlogWeeks.value)} of work</span>
            </>
          )}
        </p>
        {dto.period.inProgress && !d(m.backlogOnHold).isZero() && (
          <p className="mt-1 text-xs text-muted">
            <span className="font-medium text-text">{formatCADWhole(m.backlogOnHold)}</span> on hold ({formatCount(c.backlogOnHoldJobs)} {plural(c.backlogOnHoldJobs, "job", "jobs")})
          </p>
        )}
      </Card>
    </div>
  );
}

function CountHero({ dto }: { dto: PerformanceDTO }) {
  const c = dto.counts;
  const vs = dto.period.comparisonLabel;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="p-5">
        <HeroFigure
          testId="kpi-jobs-sold"
          label="Jobs sold"
          period={dto.period.currentLabel}
          value={formatCount(c.jobsSold.value)}
          raw={c.jobsSold.value}
          title={definitionText("jobsSold")}
          delta={<Delta kpi={c.jobsSold} kind="count" dir="up_good" vs={vs} className="text-sm" />}
        />
        <p className="mt-2 text-sm text-muted">
          <SubKpi testId="kpi-cancelled-jobs" raw={c.cancelledJobs.value} suffix={` cancelled after the sale`}>
            {formatCount(c.cancelledJobs.value)}
          </SubKpi>
        </p>
      </Card>
      <Card className="p-4">
        <KpiTile
          plain
          testId="kpi-jobs-completed"
          label="Jobs completed"
          value={formatCount(c.jobsCompleted.value)}
          raw={c.jobsCompleted.value}
          title={definitionText("jobsCompleted")}
          delta={<Delta kpi={c.jobsCompleted} kind="count" dir="up_good" vs={vs} />}
        />
      </Card>
      <Card className="p-4">
        <KpiTile
          plain
          testId="kpi-backlog-jobs"
          label={dto.period.inProgress ? "Jobs in backlog now" : "Jobs in backlog at period end"}
          value={formatCount(c.backlogJobs.value)}
          raw={c.backlogJobs.value}
          title={definitionText("backlog")}
          delta={<Delta kpi={c.backlogJobs} kind="count" dir="neutral" vs={vs} />}
          hint={dto.period.inProgress && c.backlogOnHoldJobs > 0 ? `${formatCount(c.backlogOnHoldJobs)} on hold` : undefined}
        />
      </Card>
    </div>
  );
}

function KpiGrid({ dto }: { dto: PerformanceDTO }) {
  const { counts: c, money: m, pipeline: pl } = dto;
  const vs = dto.period.comparisonLabel;
  const rateByValue = m?.closeRateValue.value;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <KpiTile
        testId="kpi-leads"
        label="Leads in"
        value={formatCount(c.leads.value)}
        raw={c.leads.value}
        title={definitionText("leads")}
        delta={<Delta kpi={c.leads} kind="count" dir="up_good" vs={vs} />}
      >
        <Sparkline values={dto.monthly.leads} className="mt-2" />
      </KpiTile>
      <KpiTile
        testId="kpi-visits-booked"
        label="Visits booked"
        value={formatCount(c.visitsBooked.value)}
        raw={c.visitsBooked.value}
        title={definitionText("visitsBooked")}
        delta={<Delta kpi={c.visitsBooked} kind="count" dir="up_good" vs={vs} />}
      />
      <KpiTile
        testId="kpi-visits-completed"
        label="Visits completed"
        value={formatCount(c.visitsCompleted.value)}
        raw={c.visitsCompleted.value}
        title={definitionText("visitsCompleted")}
        delta={<Delta kpi={c.visitsCompleted} kind="count" dir="up_good" vs={vs} />}
      />
      <KpiTile
        testId="kpi-proposals-sent"
        label="Proposals sent"
        value={formatCount(c.proposalsSent.value)}
        raw={c.proposalsSent.value}
        title={definitionText("proposalsSent")}
        delta={<Delta kpi={c.proposalsSent} kind="count" dir="up_good" vs={vs} />}
        hint={m ? `${formatCADCompact(m.proposalsSentValue.value)} quoted` : undefined}
      />
      <KpiTile
        testId="kpi-close-rate"
        label="Close rate"
        value={formatRatio(c.closeRate.value)}
        raw={c.closeRate.value}
        title={definitionText("closeRate")}
        delta={<Delta kpi={c.closeRate} kind="ratio" dir="up_good" vs={vs} />}
        hint={m ? `${formatRatio(rateByValue)} by value` : undefined}
      />
      <KpiTile
        testId="kpi-cycle-days"
        label="Sales cycle"
        value={formatDays(c.salesCycleMedianDays.value)}
        raw={c.salesCycleMedianDays.value}
        title={`${definitionText("salesCycle")}${c.salesCycleMeanDays ? ` Average: ${formatDays(c.salesCycleMeanDays)}.` : ""}`}
        delta={<Delta kpi={c.salesCycleMedianDays} kind="days" dir="down_good" vs={vs} />}
        hint="lead to signed (typical)"
      />
      {m && (
        <KpiTile
          testId="kpi-gross-margin"
          label="Gross margin (est.)"
          value={formatRatio(m.grossMargin.value, 1)}
          raw={m.grossMargin.value}
          title={definitionText("grossMargin")}
          delta={<Delta kpi={m.grossMargin} kind="ratio" dir="up_good" vs={vs} />}
        />
      )}
      <KpiTile
        testId="kpi-pipeline"
        label="Pipeline now"
        value={`${formatCount(pl.proposalsOut)} out`}
        raw={String(pl.proposalsOut)}
        title={definitionText("pipeline")}
        hint={
          <>
            {pl.proposalsOutValue !== undefined && <span className="block">{formatCADCompact(pl.proposalsOutValue)} in proposals</span>}
            <span className="block">
              {formatCount(pl.notQuoted)} {plural(pl.notQuoted, "lead", "leads")} not yet quoted
              {pl.notQuotedEstimatedValue !== undefined && !d(pl.notQuotedEstimatedValue).isZero() && ` (${formatCADCompact(pl.notQuotedEstimatedValue)} est.)`}
            </span>
          </>
        }
      />
    </div>
  );
}

function monthlySeries(monthly: MonthlyDTO): { series: MonthlySeries[]; goal?: MonthlyGoal; money: boolean } {
  const mm = monthly.money;
  if (mm) {
    const sales = mm.sales.map((v) => d(v));
    return {
      money: true,
      series: [
        { key: "sales", label: "Sales", color: "var(--chart-sales)", values: sales.map((v) => v.toNumber()), display: mm.sales.map((v) => formatCADWhole(v)) },
        { key: "produced", label: "Produced", color: "var(--chart-produced)", values: mm.produced.map((v) => d(v).toNumber()), display: mm.produced.map((v) => formatCADWhole(v)) },
      ],
      goal: mm.salesGoal.some((g) => g !== null)
        ? {
            values: mm.salesGoal.map((g) => (g === null ? null : d(g).toNumber())),
            display: mm.salesGoal.map((g) => (g === null ? null : formatCADWhole(g))),
            pctOfGoal: mm.salesGoal.map((g, i) => {
              const r = g === null ? null : ratio(sales[i], g);
              return r ? formatRatio(r.toFixed(4)) : null;
            }),
          }
        : undefined,
    };
  }
  return {
    money: false,
    series: [
      { key: "leads", label: "Leads in", color: "var(--chart-sales)", values: monthly.leads, display: monthly.leads.map((v) => formatCount(v)) },
      { key: "jobsSold", label: "Jobs sold", color: "var(--chart-produced)", values: monthly.jobsSold, display: monthly.jobsSold.map((v) => formatCount(v)) },
    ],
  };
}

function MonthlyCard({ dto }: { dto: PerformanceDTO }) {
  const { months } = dto.monthly;
  const { series, goal, money } = monthlySeries(dto.monthly);
  const span = `${months[0].label} ${months[0].year} – ${months[months.length - 1].label} ${months[months.length - 1].year}`;
  const title = `${money ? "Sales vs produced" : "Leads vs jobs sold"}, ${span}`;
  const empty = series.every((s) => s.values.every((v) => v === 0));
  const max = Math.max(0, ...series.flatMap((s) => s.values), ...(goal?.values.filter((v): v is number => v !== null) ?? []));
  const ticks = niceTicks(max, { integer: !money }).map((v) => ({ value: v, label: money ? formatCADCompact(v) : formatCount(v) }));
  const header = (
    <>
      <h2 className="text-sm font-semibold text-text">{money ? "Sales vs produced" : "Leads vs jobs sold"}</h2>
      <p className="mt-0.5 text-xs text-muted">{span} · shaded months are in the selected period</p>
    </>
  );
  if (empty)
    return (
      <Card>
        <div className="border-b border-border px-4 py-3">{header}</div>
        <div className="p-4">
          <EmptyState title={money ? "No sales or finished jobs in these 12 months yet." : "No leads or sales in these 12 months yet."} />
        </div>
      </Card>
    );
  return (
    <Card>
      <Segmented
        label="Show as"
        header={header}
        options={[
          { key: "chart", label: "Chart", panel: <MonthlyColumns months={months} series={series} goal={goal} ticks={ticks} title={title} /> },
          { key: "table", label: "Table", panel: <MonthlyTable months={months} series={series} goal={goal} title={title} /> },
        ]}
      />
    </Card>
  );
}

function SourcesCard({ dto }: { dto: PerformanceDTO }) {
  const money = !!dto.money;
  const header = (
    <>
      <h2 className="text-sm font-semibold text-text">Leads by source</h2>
      <p className="mt-0.5 text-xs text-muted">{dto.period.currentLabel} · with jobs sold from each source</p>
    </>
  );
  const sources = dto.sources.map((s) => ({
    key: `source-${s.key}`,
    label: s.key,
    value: s.leads,
    display: formatCount(s.leads),
    title: s.leadsCompare === null ? s.key : `${s.key}: ${formatCount(s.leads)} leads, ${formatCount(s.leadsCompare)} in ${dto.period.comparisonLabel}`,
    sub: s.sold > 0 ? `${formatCount(s.sold)} sold${money && s.soldValue ? ` · ${formatCADCompact(s.soldValue)}` : ""}` : undefined,
  }));
  const channels = dto.channels.map((ch) => ({
    key: `channel-${ch.key}`,
    label: ch.label,
    value: ch.leads,
    display: formatCount(ch.leads),
    title: ch.leadsCompare === null ? ch.label : `${ch.label}: ${formatCount(ch.leads)} leads, ${formatCount(ch.leadsCompare)} in ${dto.period.comparisonLabel}`,
  }));
  return (
    <Card>
      <Segmented
        label="Group leads"
        header={header}
        options={[
          { key: "source", label: "By source", panel: <BarList ariaLabel="Leads by source" items={sources.filter((s) => s.value > 0 || s.sub)} /> },
          { key: "channel", label: "By channel", panel: <BarList ariaLabel="Leads by channel" items={channels.filter((c) => c.value > 0)} /> },
        ]}
      />
    </Card>
  );
}

function FunnelCard({ dto }: { dto: PerformanceDTO }) {
  return (
    <Card>
      <CardHeader title="Funnel" description={`Activity in ${dto.period.currentLabel}. Each step counts on its own date, so this isn't one group of leads.`} />
      <Funnel steps={dto.funnel} />
    </Card>
  );
}

function LostCard({ dto }: { dto: PerformanceDTO }) {
  const money = !!dto.money;
  return (
    <Card>
      <CardHeader title="Lost reasons" description={dto.period.currentLabel} />
      <BarList
        ariaLabel="Lost reasons"
        color="var(--chart-muted)"
        items={dto.lostReasons.map((r, i) => ({
          key: `lost-${i}`,
          label: truncate(r.reason),
          title: r.reason,
          value: r.count,
          display: formatCount(r.count),
          sub: money && r.quotedValue && !d(r.quotedValue).isZero() ? `${formatCADCompact(r.quotedValue)} quoted` : undefined,
        }))}
      />
    </Card>
  );
}

function PeopleCard({ dto }: { dto: PerformanceDTO }) {
  const money = !!dto.money;
  return (
    <Card>
      <CardHeader title="By salesperson" description={`${dto.period.currentLabel} · each lead belongs to its estimator`} />
      {dto.people.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">Nothing in this period.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Name</th>
              <th className={`${th} hidden text-right sm:table-cell`}>Visits</th>
              <th className={`${th} text-right`}>Proposals</th>
              <th className={`${th} text-right`}>Sold</th>
              <th className={`${th} text-right`}>Close</th>
              {money && <th className={`${th} hidden text-right sm:table-cell`}>Avg sale</th>}
            </tr>
          </thead>
          <tbody>
            {dto.people.map((p) => (
              <tr key={p.userId ?? "unassigned"}>
                <td className={cn(td, "max-w-40 truncate", p.userId === null && "text-muted")} title={p.name}>
                  {p.name}
                </td>
                <td className={`${td} hidden text-right tabular sm:table-cell`}>{formatCount(p.visitsCompleted)}</td>
                <td className={`${td} text-right tabular`}>
                  {formatCount(p.proposalsSent)}
                  {money && p.proposalsValue && <span className="block text-xs text-muted">{formatCADCompact(p.proposalsValue)}</span>}
                </td>
                <td className={`${td} text-right tabular`}>
                  {formatCount(p.jobsSold)}
                  {money && p.soldValue && <span className="block text-xs text-muted">{formatCADCompact(p.soldValue)}</span>}
                </td>
                <td className={`${td} text-right tabular`}>{formatRatio(p.closeRate)}</td>
                {money && <td className={`${td} hidden text-right tabular sm:table-cell`}>{p.averageSale ? formatCADWhole(p.averageSale) : DASH}</td>}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function Definitions({ money }: { money: boolean }) {
  return (
    <details className="group rounded-lg border border-border bg-surface">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-text marker:hidden">
        <span className="mr-1 inline-block transition-transform group-open:rotate-90" aria-hidden>
          ▸
        </span>
        How these numbers are calculated
      </summary>
      <div className="border-t border-border px-4 py-3 text-sm">
        <ul className="mb-3 list-disc space-y-1 pl-5 text-muted">
          {DEFINITION_NOTES.filter((n) => money || !n.money).map((n, i) => (
            <li key={`note-${i}`}>{n.text}</li>
          ))}
        </ul>
        <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2">
          {definitionsFor({ money }).map((k) => (
            <div key={`def-${k.key}`}>
              <dt className="font-medium text-text">{k.label}</dt>
              <dd className="text-muted">{k.text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  );
}
