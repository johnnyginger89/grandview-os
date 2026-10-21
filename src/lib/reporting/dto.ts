/**
 * Turns raw aggregate rows into the page's DTO. Pure, so the per-role money rule
 * is unit-tested: with `money: false` no money field is ever copied, even if the
 * raw rows contain one.
 */
import { businessDate, formatIsoDate } from "@/lib/calendar-date";
import { d, Decimal, type DecimalInput } from "@/lib/money";
import type { Goals } from "./goals";
import { backlogWeeks, goalForMonth, goalForRange, grossMargin, ratio, type GoalSeries } from "./kpi";
import { monthKey, type ResolvedPeriod } from "./periods";
import type {
  ChannelRow,
  FunnelStep,
  GoalProgress,
  GoalStatus,
  KpiValue,
  LostReasonRow,
  MonthlyDTO,
  PerformanceDTO,
  PerformanceMoney,
  PeriodInfo,
  PersonRow,
  PipelineNow,
  RunRate,
  SnapshotDTO,
  SourceRow,
} from "./types";

export interface Pair<T> {
  cur: T;
  cmp: T;
}

export interface RawProjects {
  soldN: Pair<number>;
  completedN: Pair<number>;
  cancelledN: Pair<number>;
  backlogN: Pair<number>;
  onHoldN: number;
  cycleMedian: Pair<string | null>;
  cycleMean: Pair<string | null>;
  money?: {
    sales: Pair<string>;
    soldCost: Pair<string>;
    produced: Pair<string>;
    cancelled: Pair<string>;
    backlog: Pair<string>;
    onHold: string;
    produced91d: Pair<string>;
    trailing12: string;
  };
}

export interface RawOpps {
  leads: Pair<number>;
  visitsBooked: Pair<number>;
  visitsCompleted: Pair<number>;
  won: Pair<number>;
  lost: Pair<number>;
  money?: { wonValue: Pair<string>; lostValue: Pair<string> };
}

export interface RawProposals {
  sentN: Pair<number>;
  sentValue?: Pair<string>;
}

export interface RawMonthly {
  k: "sold" | "produced" | "leads";
  m: string;
  n: number;
  v: string | null;
}

export interface RawSource {
  dim: "source" | "channel" | "sold";
  key: string;
  n: number;
  nCmp: number;
  v: string | null;
}

export interface RawLost {
  reason: string;
  n: number;
  quoted: string | null;
}

export interface RawPerson {
  ownerId: string | null;
  name: string | null;
  k: "visits" | "proposals" | "sold" | "won" | "lost";
  n: number;
  v: string | null;
}

export interface RawPipeline {
  proposalsOut: number;
  proposalsOutValue: string | null;
  notQuoted: number;
  notQuotedValue: string | null;
}

export interface RawSnapshot {
  projects: RawProjects;
  opps: RawOpps;
  proposals: RawProposals;
  pipeline: RawPipeline;
}

export interface RawPerformance extends RawSnapshot {
  monthly: RawMonthly[];
  sources: RawSource[];
  lost: RawLost[];
  people: RawPerson[];
}

export interface DtoContext {
  /** financials.read: company money (sales, produced, backlog, goals, margin, $ close rate, $ per person). */
  money: boolean;
  /** estimates.read: open pipeline value. */
  pipelineMoney: boolean;
  period: ResolvedPeriod;
  goals: Goals;
  dataStartsAt: Date | null;
  channelLabel?: (key: string) => string;
}

export const SOURCE_LIMIT = 8;
export const OTHER_SOURCE = "Other";

const money2 = (v: DecimalInput) => d(v).toFixed(2);
const fixed = (v: Decimal | null, places: number) => (v ? v.toFixed(places) : null);
const kv = (value: string | null, compare: string | null, compareAvailable: boolean): KpiValue => ({ value, compare, compareAvailable });
const countKv = (p: Pair<number>, a: boolean) => kv(String(p.cur), String(p.cmp), a);
const moneyKv = (p: Pair<DecimalInput>, a: boolean) => kv(money2(p.cur), money2(p.cmp), a);
const ZERO: Pair<string> = { cur: "0", cmp: "0" };

const monthName = (iso: string) => formatIsoDate(iso, { month: "long" });

export function goalName(p: Pick<ResolvedPeriod, "preset" | "current" | "fiscalYear" | "fiscalYearStartMonth">): string {
  switch (p.preset) {
    case "this_month":
    case "last_month":
      return `goal for ${monthName(p.current.from)}`;
    case "qtd":
      return "goal for this quarter";
    case "ytd":
      return p.fiscalYearStartMonth === 1 ? `goal for ${p.fiscalYear}` : `goal for fiscal ${p.fiscalYear}`;
    case "l12m":
      return "goal for these 12 months";
    case "custom":
      return "goal for these dates";
  }
}

export function periodInfo(p: ResolvedPeriod): PeriodInfo {
  return {
    preset: p.preset,
    compare: p.compare,
    from: p.current.from,
    to: p.current.toInclusive,
    currentLabel: p.current.label,
    comparisonLabel: p.comparison.label,
    lastYearLabel: p.lastYear.label,
    inProgress: p.inProgress,
    goalName: goalName(p),
  };
}

/** Comparisons are only meaningful when the comparison range lies inside recorded history. */
export function compareAvailable(p: ResolvedPeriod, dataStartsAt: Date | null): boolean {
  return dataStartsAt !== null && p.comparison.start.getTime() >= dataStartsAt.getTime();
}

const PACE_TOLERANCE = new Decimal("0.05");

/** Progress against the goal for the whole period, with pace while it is in progress. */
export function goalProgress(actual: DecimalInput, goals: Goals, which: GoalSeries, p: Pick<ResolvedPeriod, "inProgress" | "current" | "full">): GoalProgress | null {
  const goal = goalForRange(goals, which, p.full);
  if (!goal || goal.lte(0)) return null;
  const a = d(actual);
  const toDate = p.inProgress ? (goalForRange(goals, which, p.current) ?? goal) : goal;
  const pct = a.div(goal);
  const pace = p.inProgress ? toDate.div(goal) : null;
  let status: GoalStatus = "complete";
  let shortBy = Decimal.max(goal.minus(a), 0);
  if (pace) {
    const gap = pct.minus(pace);
    status = gap.lt(PACE_TOLERANCE.neg()) ? "behind" : gap.gt(PACE_TOLERANCE) ? "ahead" : "on_pace";
    shortBy = status === "behind" ? toDate.minus(a) : new Decimal(0);
  }
  return {
    actual: money2(a),
    goal: money2(goal),
    goalToDate: money2(toDate),
    pct: pct.toFixed(4),
    pace: pace ? pace.toFixed(4) : null,
    status,
    shortBy: money2(shortBy),
  };
}

function runRate(trailing12: string, goals: Goals): RunRate | null {
  if (!goals.longTerm) return null;
  const target = d(goals.longTerm.amount);
  if (target.lte(0)) return null;
  return { trailing12: money2(trailing12), target: money2(target), year: goals.longTerm.year, pct: d(trailing12).div(target).toFixed(4) };
}

function pipelineDto(raw: RawPipeline, pipelineMoney: boolean): PipelineNow {
  const out: PipelineNow = { proposalsOut: raw.proposalsOut, notQuoted: raw.notQuoted };
  if (pipelineMoney) {
    out.proposalsOutValue = money2(raw.proposalsOutValue);
    out.notQuotedEstimatedValue = money2(raw.notQuotedValue);
  }
  return out;
}

function closeRate(won: number, lost: number): string | null {
  return fixed(ratio(won, won + lost), 4);
}

function monthlyDto(raw: RawMonthly[], ctx: DtoContext): MonthlyDTO {
  const { period } = ctx;
  const from = monthKey(period.current.from);
  const to = monthKey(period.current.toInclusive);
  const find = (k: RawMonthly["k"], m: string) => raw.find((r) => r.k === k && r.m === m);
  const months = period.chartMonths.map((key) => ({
    key,
    label: formatIsoDate(`${key}-01`, { month: "short" }),
    year: Number(key.slice(0, 4)),
    inPeriod: key >= from && key <= to,
  }));
  const out: MonthlyDTO = {
    months,
    leads: period.chartMonths.map((m) => find("leads", m)?.n ?? 0),
    jobsSold: period.chartMonths.map((m) => find("sold", m)?.n ?? 0),
    jobsCompleted: period.chartMonths.map((m) => find("produced", m)?.n ?? 0),
  };
  if (ctx.money)
    out.money = {
      sales: period.chartMonths.map((m) => money2(find("sold", m)?.v)),
      produced: period.chartMonths.map((m) => money2(find("produced", m)?.v)),
      salesGoal: period.chartMonths.map((m) => fixed(goalForMonth(ctx.goals, "sales", `${m}-01`), 2)),
    };
  return out;
}

function sourcesDto(raw: RawSource[], ctx: DtoContext, available: boolean): SourceRow[] {
  const rows = new Map<string, { leads: number; leadsCompare: number; sold: number; soldValue: Decimal }>();
  const row = (key: string) => {
    let r = rows.get(key);
    if (!r) rows.set(key, (r = { leads: 0, leadsCompare: 0, sold: 0, soldValue: new Decimal(0) }));
    return r;
  };
  for (const r of raw) {
    if (r.dim === "source") {
      const s = row(r.key);
      s.leads += r.n;
      s.leadsCompare += r.nCmp;
    } else if (r.dim === "sold") {
      const s = row(r.key);
      s.sold += r.n;
      s.soldValue = s.soldValue.plus(d(r.v));
    }
  }
  const sorted = [...rows.entries()]
    .filter(([key]) => key !== OTHER_SOURCE)
    .sort(([ka, a], [kb, b]) => b.leads - a.leads || b.sold - a.sold || ka.localeCompare(kb));
  const kept = sorted.slice(0, SOURCE_LIMIT);
  const folded = [...sorted.slice(SOURCE_LIMIT), ...(rows.has(OTHER_SOURCE) ? [[OTHER_SOURCE, rows.get(OTHER_SOURCE)!] as const] : [])];
  if (folded.length)
    kept.push([
      OTHER_SOURCE,
      folded.reduce((acc, [, r]) => ({ leads: acc.leads + r.leads, leadsCompare: acc.leadsCompare + r.leadsCompare, sold: acc.sold + r.sold, soldValue: acc.soldValue.plus(r.soldValue) }), {
        leads: 0,
        leadsCompare: 0,
        sold: 0,
        soldValue: new Decimal(0),
      }),
    ]);
  return kept.map(([key, r]) => {
    const out: SourceRow = { key, leads: r.leads, leadsCompare: available ? r.leadsCompare : null, sold: r.sold };
    if (ctx.money) out.soldValue = money2(r.soldValue);
    return out;
  });
}

function channelsDto(raw: RawSource[], ctx: DtoContext, available: boolean): ChannelRow[] {
  return raw
    .filter((r) => r.dim === "channel")
    .map((r) => ({ key: r.key, label: ctx.channelLabel?.(r.key) ?? r.key, leads: r.n, leadsCompare: available ? r.nCmp : null }))
    .sort((a, b) => b.leads - a.leads || a.label.localeCompare(b.label));
}

const FUNNEL_LABELS: Record<FunnelStep["key"], string> = {
  leads: "Leads in",
  visitsBooked: "Visits booked",
  visitsCompleted: "Visits completed",
  proposalsSent: "Proposals sent",
  jobsSold: "Jobs sold",
};

function funnelDto(raw: RawPerformance): FunnelStep[] {
  const counts: [FunnelStep["key"], number][] = [
    ["leads", raw.opps.leads.cur],
    ["visitsBooked", raw.opps.visitsBooked.cur],
    ["visitsCompleted", raw.opps.visitsCompleted.cur],
    ["proposalsSent", raw.proposals.sentN.cur],
    ["jobsSold", raw.projects.soldN.cur],
  ];
  return counts.map(([key, count], i) => ({ key, label: FUNNEL_LABELS[key], count, stepRate: i === 0 ? null : fixed(ratio(count, counts[i - 1][1]), 4) }));
}

function lostDto(raw: RawLost[], ctx: DtoContext): LostReasonRow[] {
  return raw.map((r) => {
    const out: LostReasonRow = { reason: r.reason, count: r.n };
    if (ctx.money) out.quotedValue = money2(r.quoted);
    return out;
  });
}

export const UNASSIGNED = "Unassigned";

function peopleDto(raw: RawPerson[], ctx: DtoContext): PersonRow[] {
  type Acc = { userId: string | null; name: string; visits: number; proposals: number; proposalsValue: Decimal; sold: number; soldValue: Decimal; won: number; lost: number };
  const byOwner = new Map<string, Acc>();
  for (const r of raw) {
    const key = r.ownerId ?? "";
    let a = byOwner.get(key);
    if (!a) {
      a = { userId: r.ownerId, name: r.ownerId ? (r.name ?? "Former team member") : UNASSIGNED, visits: 0, proposals: 0, proposalsValue: new Decimal(0), sold: 0, soldValue: new Decimal(0), won: 0, lost: 0 };
      byOwner.set(key, a);
    }
    if (r.k === "visits") a.visits += r.n;
    else if (r.k === "proposals") {
      a.proposals += r.n;
      a.proposalsValue = a.proposalsValue.plus(d(r.v));
    } else if (r.k === "sold") {
      a.sold += r.n;
      a.soldValue = a.soldValue.plus(d(r.v));
    } else if (r.k === "won") a.won += r.n;
    else a.lost += r.n;
  }
  const accs = [...byOwner.values()].sort(
    (a, b) =>
      Number(a.userId === null) - Number(b.userId === null) ||
      (ctx.money ? b.soldValue.comparedTo(a.soldValue) : 0) ||
      b.sold - a.sold ||
      b.proposals - a.proposals ||
      b.visits - a.visits ||
      a.name.localeCompare(b.name),
  );
  return accs.map((a) => {
    const row: PersonRow = { userId: a.userId, name: a.name, visitsCompleted: a.visits, proposalsSent: a.proposals, jobsSold: a.sold, closeRate: closeRate(a.won, a.lost) };
    if (ctx.money) {
      row.proposalsValue = money2(a.proposalsValue);
      row.soldValue = money2(a.soldValue);
      const avg = ratio(a.soldValue, a.sold);
      if (avg) row.averageSale = avg.toFixed(2);
    }
    return row;
  });
}

function moneyDto(raw: RawPerformance, ctx: DtoContext, available: boolean): PerformanceMoney {
  const pm = raw.projects.money;
  const sales = pm?.sales ?? ZERO;
  const cancelled = pm?.cancelled ?? ZERO;
  const backlog = pm?.backlog ?? ZERO;
  const produced91d = pm?.produced91d ?? ZERO;
  const won = raw.opps.money?.wonValue ?? ZERO;
  const lost = raw.opps.money?.lostValue ?? ZERO;
  const soldCost = pm?.soldCost ?? ZERO;
  return {
    sales: moneyKv(sales, available),
    produced: moneyKv(pm?.produced ?? ZERO, available),
    cancelled: moneyKv(cancelled, available),
    netSales: moneyKv({ cur: d(sales.cur).minus(d(cancelled.cur)), cmp: d(sales.cmp).minus(d(cancelled.cmp)) }, available),
    backlog: moneyKv(backlog, available),
    backlogOnHold: money2(pm?.onHold),
    backlogWeeks: kv(fixed(backlogWeeks(backlog.cur, produced91d.cur), 1), fixed(backlogWeeks(backlog.cmp, produced91d.cmp), 1), available),
    averageSale: kv(fixed(ratio(sales.cur, raw.projects.soldN.cur), 2), fixed(ratio(sales.cmp, raw.projects.soldN.cmp), 2), available),
    grossMargin: kv(fixed(grossMargin(sales.cur, soldCost.cur), 4), fixed(grossMargin(sales.cmp, soldCost.cmp), 4), available),
    proposalsSentValue: moneyKv(raw.proposals.sentValue ?? ZERO, available),
    closeRateValue: kv(fixed(ratio(won.cur, d(won.cur).plus(d(lost.cur))), 4), fixed(ratio(won.cmp, d(won.cmp).plus(d(lost.cmp))), 4), available),
    goals: {
      sales: goalProgress(sales.cur, ctx.goals, "sales", ctx.period),
      produced: goalProgress(pm?.produced.cur ?? "0", ctx.goals, "produced", ctx.period),
      runRate: runRate(pm?.trailing12 ?? "0", ctx.goals),
    },
  };
}

export function buildPerformanceDTO(raw: RawPerformance, ctx: DtoContext): PerformanceDTO {
  const available = compareAvailable(ctx.period, ctx.dataStartsAt);
  const { projects: p, opps: o } = raw;
  const dto: PerformanceDTO = {
    period: periodInfo(ctx.period),
    dataStartsAt: ctx.dataStartsAt ? businessDate(ctx.dataStartsAt) : null,
    counts: {
      leads: countKv(o.leads, available),
      visitsBooked: countKv(o.visitsBooked, available),
      visitsCompleted: countKv(o.visitsCompleted, available),
      proposalsSent: countKv(raw.proposals.sentN, available),
      jobsSold: countKv(p.soldN, available),
      jobsCompleted: countKv(p.completedN, available),
      cancelledJobs: countKv(p.cancelledN, available),
      backlogJobs: countKv(p.backlogN, available),
      backlogOnHoldJobs: p.onHoldN,
      closeRate: kv(closeRate(o.won.cur, o.lost.cur), closeRate(o.won.cmp, o.lost.cmp), available),
      salesCycleMedianDays: kv(p.cycleMedian.cur, p.cycleMedian.cmp, available),
      salesCycleMeanDays: p.cycleMean.cur,
    },
    pipeline: pipelineDto(raw.pipeline, ctx.pipelineMoney),
    monthly: monthlyDto(raw.monthly, ctx),
    sources: sourcesDto(raw.sources, ctx, available),
    channels: channelsDto(raw.sources, ctx, available),
    funnel: funnelDto(raw),
    lostReasons: lostDto(raw.lost, ctx),
    people: peopleDto(raw.people, ctx),
  };
  if (ctx.money) dto.money = moneyDto(raw, ctx, available);
  return dto;
}

export function buildSnapshotDTO(raw: RawSnapshot, ctx: DtoContext): SnapshotDTO {
  const available = compareAvailable(ctx.period, ctx.dataStartsAt);
  const dto: SnapshotDTO = {
    period: periodInfo(ctx.period),
    dataStartsAt: ctx.dataStartsAt ? businessDate(ctx.dataStartsAt) : null,
    counts: {
      leads: countKv(raw.opps.leads, available),
      visitsBooked: countKv(raw.opps.visitsBooked, available),
      proposalsSent: countKv(raw.proposals.sentN, available),
      jobsSold: countKv(raw.projects.soldN, available),
    },
    pipeline: pipelineDto(raw.pipeline, ctx.pipelineMoney),
  };
  if (ctx.money) {
    const pm = raw.projects.money;
    const backlog = pm?.backlog.cur ?? "0";
    dto.money = {
      sales: moneyKv(pm?.sales ?? ZERO, available),
      produced: moneyKv(pm?.produced ?? ZERO, available),
      backlog: money2(backlog),
      backlogJobs: raw.projects.backlogN.cur,
      backlogWeeks: fixed(backlogWeeks(backlog, pm?.produced91d.cur), 1),
      salesGoal: goalProgress(pm?.sales.cur ?? "0", ctx.goals, "sales", ctx.period),
    };
  }
  return dto;
}
