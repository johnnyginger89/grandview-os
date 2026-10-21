/**
 * Plain, serializable shapes the dashboard renders from. Money and ratios are
 * strings (Decimal#toFixed), never Decimal instances or floats.
 *
 * Money fields are optional and ABSENT (not null) for roles that may not see
 * them: the server builds a different object per role, so nothing is merely hidden.
 */
import type { IsoDate } from "@/lib/calendar-date";
import type { CompareMode, PeriodPreset } from "./periods";

/** A value for the current range and the comparison range. */
export interface KpiValue {
  value: string | null;
  compare: string | null;
  /** False when the comparison range starts before the first record, so a delta would be fake growth. */
  compareAvailable: boolean;
}

export interface PeriodInfo {
  preset: PeriodPreset;
  compare: CompareMode;
  from: IsoDate;
  to: IsoDate;
  currentLabel: string;
  comparisonLabel: string;
  lastYearLabel: string;
  inProgress: boolean;
  /** "goal for October", "goal for 2026"… */
  goalName: string;
}

export interface PerformanceCounts {
  leads: KpiValue;
  visitsBooked: KpiValue;
  visitsCompleted: KpiValue;
  proposalsSent: KpiValue;
  jobsSold: KpiValue;
  jobsCompleted: KpiValue;
  cancelledJobs: KpiValue;
  backlogJobs: KpiValue;
  /** Jobs in today's backlog that are on hold. */
  backlogOnHoldJobs: number;
  /** Won ÷ decided, "0.4615". */
  closeRate: KpiValue;
  salesCycleMedianDays: KpiValue;
  salesCycleMeanDays: string | null;
}

export type GoalStatus = "ahead" | "on_pace" | "behind" | "complete";

export interface GoalProgress {
  actual: string;
  /** Goal for the whole period. */
  goal: string;
  /** The share of the goal due by today (equals goal once the period is over). */
  goalToDate: string;
  /** actual ÷ goal. */
  pct: string;
  /** goalToDate ÷ goal while in progress. */
  pace: string | null;
  status: GoalStatus;
  /** How far behind the goal to date (behind) or short of the goal (complete), else "0.00". */
  shortBy: string;
}

export interface RunRate {
  trailing12: string;
  target: string;
  year: number;
  pct: string;
}

export interface PerformanceMoney {
  sales: KpiValue;
  produced: KpiValue;
  cancelled: KpiValue;
  netSales: KpiValue;
  backlog: KpiValue;
  backlogOnHold: string;
  backlogWeeks: KpiValue;
  averageSale: KpiValue;
  grossMargin: KpiValue;
  proposalsSentValue: KpiValue;
  closeRateValue: KpiValue;
  goals: { sales: GoalProgress | null; produced: GoalProgress | null; runRate: RunRate | null };
}

export interface PipelineNow {
  proposalsOut: number;
  proposalsOutValue?: string;
  notQuoted: number;
  notQuotedEstimatedValue?: string;
}

export interface MonthPoint {
  key: string;
  /** "Oct" */
  label: string;
  year: number;
  inPeriod: boolean;
}

export interface MonthlyDTO {
  months: MonthPoint[];
  leads: number[];
  jobsSold: number[];
  jobsCompleted: number[];
  money?: { sales: string[]; produced: string[]; salesGoal: (string | null)[] };
}

export interface SourceRow {
  key: string;
  leads: number;
  leadsCompare: number | null;
  sold: number;
  soldValue?: string;
}

export interface ChannelRow {
  key: string;
  label: string;
  leads: number;
  leadsCompare: number | null;
}

export type FunnelKey = "leads" | "visitsBooked" | "visitsCompleted" | "proposalsSent" | "jobsSold";
export interface FunnelStep {
  key: FunnelKey;
  label: string;
  count: number;
  /** count ÷ the previous step's count. */
  stepRate: string | null;
}

export interface LostReasonRow {
  reason: string;
  count: number;
  quotedValue?: string;
}

export interface PersonRow {
  userId: string | null;
  name: string;
  visitsCompleted: number;
  proposalsSent: number;
  proposalsValue?: string;
  jobsSold: number;
  soldValue?: string;
  closeRate: string | null;
  averageSale?: string;
}

export interface PerformanceDTO {
  period: PeriodInfo;
  dataStartsAt: IsoDate | null;
  counts: PerformanceCounts;
  money?: PerformanceMoney;
  pipeline: PipelineNow;
  monthly: MonthlyDTO;
  sources: SourceRow[];
  channels: ChannelRow[];
  funnel: FunnelStep[];
  lostReasons: LostReasonRow[];
  people: PersonRow[];
}

/** The home page's "This month" strip. */
export interface SnapshotDTO {
  period: PeriodInfo;
  dataStartsAt: IsoDate | null;
  counts: { leads: KpiValue; visitsBooked: KpiValue; proposalsSent: KpiValue; jobsSold: KpiValue };
  money?: {
    sales: KpiValue;
    produced: KpiValue;
    backlog: string;
    backlogJobs: number;
    backlogWeeks: string | null;
    salesGoal: GoalProgress | null;
  };
  pipeline: PipelineNow;
}
