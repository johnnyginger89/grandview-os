import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import type { Role } from "@/db/schema/auth";
import { can } from "@/lib/authz/permissions";
import {
  buildPerformanceDTO,
  buildSnapshotDTO,
  type Pair,
  type RawLost,
  type RawMonthly,
  type RawOpps,
  type RawPerson,
  type RawPipeline,
  type RawProjects,
  type RawProposals,
  type RawSource,
} from "@/lib/reporting/dto";
import type { Goals } from "@/lib/reporting/goals";
import { resolvePeriod, toRange, trailing12, type ResolvedPeriod } from "@/lib/reporting/periods";
import type { PerformanceDTO, SnapshotDTO } from "@/lib/reporting/types";
import { BUSINESS_TZ } from "@/lib/time";
import { getGoals } from "./goals";
import { channelLabel } from "./leads";

/*
 * Company performance numbers. Callers check dashboard.view first.
 *
 * Never cache these functions (no unstable_cache or "use cache"): the result
 * depends on the viewer's role. Without `money`, the SQL doesn't read
 * contract_price, estimated_cost or proposal totals at all, and the DTO has no
 * money keys, so nothing is merely hidden in the page.
 *
 * Range bounds are bound as timestamptz parameters and the zone is explicit, so
 * no query depends on the session TimeZone (the transaction pooler drops it).
 */

export interface PerformanceAccess {
  /** financials.read: company money. */
  money: boolean;
  /** estimates.read: open pipeline value. */
  pipelineMoney: boolean;
}

export function accessFor(role: Role): PerformanceAccess {
  return { money: can(role, "financials.read"), pipelineMoney: can(role, "estimates.read") };
}

interface Bounds {
  start: Date;
  end: Date;
}
interface QueryCtx {
  p: ResolvedPeriod;
  money: boolean;
  pipelineMoney: boolean;
  excluded: string[];
  now: Date;
}
type Row = Record<string, unknown>;

const DAY_MS = 86_400_000;
const at = (t: Date) => sql`${t.toISOString()}::timestamptz`;
const inR = (col: SQL, r: Bounds) => sql`(${col} >= ${at(r.start)} and ${col} < ${at(r.end)})`;
const later = (a: Date, b: Date) => (a > b ? a : b);
const earlier = (a: Date, b: Date) => (a < b ? a : b);
/** Leads lost with a reason the owner marked as junk. */
const isExcluded = (excluded: string[]) => sql`(coalesce(o.lost_reason, '') = any(${sql.param(excluded)}::text[]))`;
const list = (cols: SQL[]) => sql.join(cols, sql`, `);

async function rows(q: SQL): Promise<Row[]> {
  return (await db.execute<Row>(q)).rows;
}

const int = (r: Row, k: string) => Number(r[k] ?? 0);
const text = (r: Row, k: string) => (r[k] === null || r[k] === undefined ? null : String(r[k]));
const amount = (r: Row, k: string) => text(r, k) ?? "0";
const pair = <T>(get: (r: Row, k: string) => T, r: Row, k: string): Pair<T> => ({ cur: get(r, `${k}_cur`), cmp: get(r, `${k}_cmp`) });

/** For each pair key, one column per range: `<key>_cur` and `<key>_cmp`. */
function both(c: QueryCtx, key: string, col: (r: Bounds) => SQL): SQL[] {
  return [sql`${col(c.p.current)} as ${sql.identifier(`${key}_cur`)}`, sql`${col(c.p.comparison)} as ${sql.identifier(`${key}_cmp`)}`];
}

/**
 * One row per estimate that has been sent: first send, latest sent price (only
 * when `priced`) and whether a proposal is still open.
 */
function propCte(priced: boolean, now: Date): SQL {
  const price = sql`case when er.totals->>'price' ~ '^-?[0-9]+([.][0-9]+)?$' then (er.totals->>'price')::numeric end`;
  return sql`prop as (
    select pr.estimate_id,
           min(pr.sent_at) as first_sent_at,
           ${priced ? sql`(array_agg(${price} order by pr.sent_at desc, pr.revision desc))[1]` : sql`null::numeric`} as latest_price,
           bool_or(pr.status in ('sent', 'viewed') and (pr.expires_at is null or pr.expires_at > ${at(now)})) as is_open
      from proposals pr
      ${priced ? sql`left join estimate_revisions er on er.estimate_id = pr.estimate_id and er.revision = pr.revision` : sql``}
     group by pr.estimate_id
  )`;
}

/** Quoted value per opportunity: the latest proposal price of each of its estimates. */
function oppQuoteCte(priced: boolean): SQL {
  return sql`opp_quote as (
    select e.opportunity_id, ${priced ? sql`sum(prop.latest_price)` : sql`null::numeric`} as quoted
      from estimates e join prop on prop.estimate_id = e.id
     where e.opportunity_id is not null
     group by e.opportunity_id
  )`;
}

// Q1: sales, produced, cancelled, backlog, sales cycle, margin.
async function projectsSummary(c: QueryCtx): Promise<RawProjects> {
  const { current, comparison } = c.p;
  const l12m = toRange(trailing12(c.p.today), 0);
  const asOf = { cur: c.p.asOf, cmp: earlier(comparison.end, c.now) };
  const sold = (r: Bounds) => inR(sql`p.sold_at`, r);
  const done = (r: Bounds) => inR(sql`p.completed_at`, r);
  const cancelled = (r: Bounds) => inR(sql`p.cancelled_at`, r);
  const backlog = (t: Date) =>
    sql`(p.sold_at < ${at(t)} and (p.completed_at is null or p.completed_at >= ${at(t)}) and (p.cancelled_at is null or p.cancelled_at >= ${at(t)}))`;
  const produced91d = (t: Date) => inR(sql`p.completed_at`, { start: new Date(t.getTime() - 91 * DAY_MS), end: t });
  const cycleDays = sql`extract(epoch from (p.sold_at - o.created_at)) / 86400.0`;
  const sum = (where: SQL) => sql`coalesce(sum(p.contract_price) filter (where ${where}), 0)::text`;

  const cols: SQL[] = [
    ...both(c, "sold_n", (r) => sql`count(*) filter (where ${sold(r)})::int`),
    ...both(c, "completed_n", (r) => sql`count(*) filter (where ${done(r)})::int`),
    ...both(c, "cancelled_n", (r) => sql`count(*) filter (where ${cancelled(r)})::int`),
    sql`count(*) filter (where ${backlog(asOf.cur)})::int as backlog_n_cur`,
    sql`count(*) filter (where ${backlog(asOf.cmp)})::int as backlog_n_cmp`,
    sql`count(*) filter (where ${backlog(asOf.cur)} and p.status = 'on_hold')::int as on_hold_n`,
    ...both(c, "cycle_median", (r) => sql`round((percentile_cont(0.5) within group (order by ${cycleDays}) filter (where ${sold(r)} and o.created_at is not null))::numeric, 1)::text`),
    ...both(c, "cycle_mean", (r) => sql`round((avg(${cycleDays}) filter (where ${sold(r)} and o.created_at is not null))::numeric, 1)::text`),
  ];
  if (c.money)
    cols.push(
      ...both(c, "sales", (r) => sum(sold(r))),
      ...both(c, "sold_cost", (r) => sql`coalesce(sum(p.estimated_cost) filter (where ${sold(r)}), 0)::text`),
      ...both(c, "produced", (r) => sum(done(r))),
      ...both(c, "cancelled", (r) => sum(cancelled(r))),
      sql`${sum(backlog(asOf.cur))} as backlog_cur`,
      sql`${sum(backlog(asOf.cmp))} as backlog_cmp`,
      sql`${sum(sql`${backlog(asOf.cur)} and p.status = 'on_hold'`)} as on_hold`,
      sql`${sum(produced91d(asOf.cur))} as produced_91d_cur`,
      sql`${sum(produced91d(asOf.cmp))} as produced_91d_cmp`,
      sql`${sum(sold(l12m))} as trailing_12`,
    );

  const [r] = await rows(sql`select ${list(cols)}
      from projects p
      left join opportunities o on o.id = p.opportunity_id
     where p.sold_at < ${at(later(current.end, l12m.end))}`);
  return {
    soldN: pair(int, r, "sold_n"),
    completedN: pair(int, r, "completed_n"),
    cancelledN: pair(int, r, "cancelled_n"),
    backlogN: pair(int, r, "backlog_n"),
    onHoldN: int(r, "on_hold_n"),
    cycleMedian: pair(text, r, "cycle_median"),
    cycleMean: pair(text, r, "cycle_mean"),
    money: c.money
      ? {
          sales: pair(amount, r, "sales"),
          soldCost: pair(amount, r, "sold_cost"),
          produced: pair(amount, r, "produced"),
          cancelled: pair(amount, r, "cancelled"),
          backlog: pair(amount, r, "backlog"),
          onHold: amount(r, "on_hold"),
          produced91d: pair(amount, r, "produced_91d"),
          trailing12: amount(r, "trailing_12"),
        }
      : undefined,
  };
}

// Q2: monthly series over the 12-month chart window, bucketed by Vancouver month.
async function monthlySeries(c: QueryCtx): Promise<RawMonthly[]> {
  const w = c.p.chartWindow;
  const value = c.money ? sql`sum(p.contract_price)::text` : sql`null::text`;
  // Same correction as businessZone(): BC stays on UTC−7 from 2026-11-01 whatever the database's zone data says.
  const local = (col: SQL) => sql`(case when ${col} >= '2026-11-01T09:00:00Z'::timestamptz then ${col} at time zone 'Etc/GMT+7' else ${col} at time zone ${BUSINESS_TZ} end)`;
  const month = (col: SQL) => sql`to_char(${local(col)}, 'YYYY-MM')`;
  const out = await rows(sql`
    select 'sold' as k, ${month(sql`p.sold_at`)} as m, count(*)::int as n, ${value} as v
      from projects p where ${inR(sql`p.sold_at`, w)} group by 2
    union all
    select 'produced', ${month(sql`p.completed_at`)}, count(*)::int, ${value}
      from projects p where ${inR(sql`p.completed_at`, w)} group by 2
    union all
    select 'leads', ${month(sql`o.created_at`)}, count(*)::int, null::text
      from opportunities o where ${inR(sql`o.created_at`, w)} and not ${isExcluded(c.excluded)} group by 2`);
  return out.map((r) => ({ k: r.k as RawMonthly["k"], m: String(r.m), n: int(r, "n"), v: text(r, "v") }));
}

// Q3: leads, visits and close rate.
async function oppsSummary(c: QueryCtx): Promise<RawOpps> {
  const excluded = isExcluded(c.excluded);
  const won = (r: Bounds) => sql`(q.opportunity_id is not null and ${inR(sql`o.closed_at`, r)} and s.kind = 'won')`;
  const lost = (r: Bounds) => sql`(q.opportunity_id is not null and ${inR(sql`o.closed_at`, r)} and s.kind = 'lost' and not ${excluded})`;
  const cols: SQL[] = [
    ...both(c, "leads", (r) => sql`count(*) filter (where ${inR(sql`o.created_at`, r)} and not ${excluded})::int`),
    ...both(c, "visits_booked", (r) => sql`count(*) filter (where ${inR(sql`o.visit_booked_at`, r)})::int`),
    ...both(c, "visits_completed", (r) => sql`count(*) filter (where ${inR(sql`o.visit_completed_at`, r)})::int`),
    ...both(c, "won", (r) => sql`count(*) filter (where ${won(r)})::int`),
    ...both(c, "lost", (r) => sql`count(*) filter (where ${lost(r)})::int`),
  ];
  if (c.money)
    cols.push(
      ...both(c, "won_value", (r) => sql`coalesce(sum(coalesce(w.won_value, q.quoted)) filter (where ${won(r)}), 0)::text`),
      ...both(c, "lost_value", (r) => sql`coalesce(sum(q.quoted) filter (where ${lost(r)}), 0)::text`),
    );
  const ctes = [propCte(c.money, c.now), oppQuoteCte(c.money)];
  if (c.money) ctes.push(sql`opp_won as (select opportunity_id, sum(contract_price) as won_value from projects where opportunity_id is not null group by 1)`);
  const [r] = await rows(sql`with ${list(ctes)}
    select ${list(cols)}
      from opportunities o
      join pipeline_stages s on s.id = o.stage_id
      left join opp_quote q on q.opportunity_id = o.id
      ${c.money ? sql`left join opp_won w on w.opportunity_id = o.id` : sql``}`);
  return {
    leads: pair(int, r, "leads"),
    visitsBooked: pair(int, r, "visits_booked"),
    visitsCompleted: pair(int, r, "visits_completed"),
    won: pair(int, r, "won"),
    lost: pair(int, r, "lost"),
    money: c.money ? { wonValue: pair(amount, r, "won_value"), lostValue: pair(amount, r, "lost_value") } : undefined,
  };
}

// Q4: proposals sent (first send per estimate).
async function proposalsSummary(c: QueryCtx): Promise<RawProposals> {
  const first = (r: Bounds) => inR(sql`first_sent_at`, r);
  const cols: SQL[] = [...both(c, "sent", (r) => sql`count(*) filter (where ${first(r)})::int`)];
  if (c.money) cols.push(...both(c, "sent_value", (r) => sql`coalesce(sum(latest_price) filter (where ${first(r)}), 0)::text`));
  const [r] = await rows(sql`with ${propCte(c.money, c.now)} select ${list(cols)} from prop`);
  return { sentN: pair(int, r, "sent"), sentValue: c.money ? pair(amount, r, "sent_value") : undefined };
}

// Q5: leads by source and channel (with the comparison count), and jobs sold by source.
async function sourceRows(c: QueryCtx): Promise<RawSource[]> {
  const { current, comparison } = c.p;
  const lead = (r: Bounds) => inR(sql`o.created_at`, r);
  const excluded = isExcluded(c.excluded);
  const source = (alias: SQL) => sql`coalesce(nullif(trim(${alias}), ''), 'Not recorded')`;
  const counts = sql`count(*) filter (where ${lead(current)})::int as n, count(*) filter (where ${lead(comparison)})::int as n_cmp`;
  const scope = sql`(${lead(current)} or ${lead(comparison)}) and not ${excluded}`;
  const out = await rows(sql`
    select 'source' as dim, ${source(sql`o.source`)} as key, ${counts}, null::text as v
      from opportunities o where ${scope} group by 2
    union all
    select 'channel', coalesce(o.channel, 'manual'), ${counts}, null::text
      from opportunities o where ${scope} group by 2
    union all
    select 'sold', ${source(sql`o.source`)}, count(*)::int, 0, ${c.money ? sql`sum(p.contract_price)::text` : sql`null::text`}
      from projects p left join opportunities o on o.id = p.opportunity_id
     where ${inR(sql`p.sold_at`, current)} group by 2`);
  return out.map((r) => ({ dim: r.dim as RawSource["dim"], key: String(r.key), n: int(r, "n"), nCmp: int(r, "n_cmp"), v: text(r, "v") }));
}

// Q6: lost reasons in the current range.
async function lostReasons(c: QueryCtx): Promise<RawLost[]> {
  const out = await rows(sql`${c.money ? sql`with ${list([propCte(true, c.now), oppQuoteCte(true)])}` : sql``}
    select coalesce(nullif(trim(o.lost_reason), ''), 'Not recorded') as reason, count(*)::int as n,
           ${c.money ? sql`coalesce(sum(q.quoted), 0)::text` : sql`null::text`} as quoted
      from opportunities o
      join pipeline_stages s on s.id = o.stage_id and s.kind = 'lost'
      ${c.money ? sql`left join opp_quote q on q.opportunity_id = o.id` : sql``}
     where ${inR(sql`o.closed_at`, c.p.current)}
     group by 1
     order by n desc, reason
     limit 12`);
  return out.map((r) => ({ reason: String(r.reason), n: int(r, "n"), quoted: text(r, "quoted") }));
}

// Q7: per salesperson. A lead's owner is its estimator, else whoever created its first estimate.
async function peopleRows(c: QueryCtx): Promise<RawPerson[]> {
  const cur = c.p.current;
  const out = await rows(sql`with first_est as (
      select distinct on (e.opportunity_id) e.opportunity_id, e.estimator_id
        from estimates e where e.opportunity_id is not null
       order by e.opportunity_id, e.created_at
    ), opp_owner as (
      select o.id as opportunity_id, coalesce(o.estimator_id, fe.estimator_id) as owner_id
        from opportunities o left join first_est fe on fe.opportunity_id = o.id
    ), ${propCte(c.money, c.now)}, m as (
      select oo.owner_id, 'visits' as k, count(*)::int as n, null::numeric as v
        from opportunities o join opp_owner oo on oo.opportunity_id = o.id
       where ${inR(sql`o.visit_completed_at`, cur)} group by 1
      union all
      select coalesce(oo.owner_id, e.estimator_id), 'proposals', count(*)::int, ${c.money ? sql`sum(prop.latest_price)` : sql`null::numeric`}
        from prop join estimates e on e.id = prop.estimate_id
        left join opp_owner oo on oo.opportunity_id = e.opportunity_id
       where ${inR(sql`prop.first_sent_at`, cur)} group by 1
      union all
      select coalesce(oo.owner_id, e.estimator_id), 'sold', count(*)::int, ${c.money ? sql`sum(p.contract_price)` : sql`null::numeric`}
        from projects p
        left join estimates e on e.id = p.estimate_id
        left join opp_owner oo on oo.opportunity_id = p.opportunity_id
       where ${inR(sql`p.sold_at`, cur)} group by 1
      union all
      select oo.owner_id, case when s.kind = 'won' then 'won' else 'lost' end, count(*)::int, null::numeric
        from opportunities o
        join pipeline_stages s on s.id = o.stage_id
        join opp_owner oo on oo.opportunity_id = o.id
       where ${inR(sql`o.closed_at`, cur)} and s.kind in ('won', 'lost')
         and exists (select 1 from estimates e2 join prop p2 on p2.estimate_id = e2.id where e2.opportunity_id = o.id)
         and not (s.kind = 'lost' and ${isExcluded(c.excluded)})
       group by 1, 2
    )
    select m.owner_id, u.name, m.k, m.n, m.v::text as v from m left join "user" u on u.id = m.owner_id`);
  return out.map((r) => ({ ownerId: text(r, "owner_id"), name: text(r, "name"), k: r.k as RawPerson["k"], n: int(r, "n"), v: text(r, "v") }));
}

// Q8: open pipeline right now (not period-filtered). Estimates without a lead count as open.
async function pipelineNow(c: QueryCtx): Promise<RawPipeline> {
  const v = c.pipelineMoney;
  const [r] = await rows(sql`with ${propCte(v, c.now)}, open_est as (
      select e.opportunity_id, prop.latest_price
        from prop
        join estimates e on e.id = prop.estimate_id
        left join opportunities o on o.id = e.opportunity_id
        left join pipeline_stages s on s.id = o.stage_id
       where prop.is_open and e.status <> 'accepted' and (e.opportunity_id is null or s.kind = 'open')
    )
    select oe.n as proposals_out, oe.v as proposals_out_value, nq.n as not_quoted, nq.v as not_quoted_value
      from (select count(*)::int as n, ${v ? sql`coalesce(sum(latest_price), 0)::text` : sql`null::text`} as v from open_est) oe,
           (select count(*)::int as n, ${v ? sql`coalesce(sum(o.estimated_value), 0)::text` : sql`null::text`} as v
              from opportunities o
              join pipeline_stages s on s.id = o.stage_id and s.kind = 'open'
             where not exists (select 1 from open_est x where x.opportunity_id = o.id)) nq`);
  return {
    proposalsOut: int(r, "proposals_out"),
    proposalsOutValue: v ? text(r, "proposals_out_value") : null,
    notQuoted: int(r, "not_quoted"),
    notQuotedValue: v ? text(r, "not_quoted_value") : null,
  };
}

// Q9: when records start, so comparisons before that show a dash.
async function dataStart(): Promise<Date | null> {
  const [r] = await rows(sql`select least((select min(created_at) from opportunities), (select min(sold_at) from projects)) as start`);
  const v = r?.start;
  if (v === null || v === undefined) return null;
  const t = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(t.getTime()) ? null : t;
}

function queryCtx(p: ResolvedPeriod, access: PerformanceAccess, goals: Goals, now: Date): QueryCtx {
  return { p, money: access.money, pipelineMoney: access.pipelineMoney, excluded: goals.excludedLostReasons, now };
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Everything on /performance for one period, shaped for the viewer's role. */
export async function getPerformance(period: ResolvedPeriod, access: PerformanceAccess, opts: { goals?: Goals; now?: Date } = {}): Promise<PerformanceDTO> {
  const goals = opts.goals ?? (await getGoals());
  const c = queryCtx(period, access, goals, opts.now ?? new Date());
  const [projects, monthly, opps, proposals, sources, lost, people, pipeline, dataStartsAt] = await Promise.all([
    projectsSummary(c),
    monthlySeries(c),
    oppsSummary(c),
    proposalsSummary(c),
    sourceRows(c),
    lostReasons(c),
    peopleRows(c),
    pipelineNow(c),
    dataStart(),
  ]);
  return buildPerformanceDTO(
    { projects, monthly, opps, proposals, sources, lost, people, pipeline },
    { ...access, period, goals, dataStartsAt, channelLabel: (k) => titleCase(channelLabel(k === "manual" ? null : k)) },
  );
}

/** The home page's "This month" strip, plus the open pipeline for "Proposals out". */
export async function getMonthSnapshot(now: Date, access: PerformanceAccess): Promise<SnapshotDTO> {
  const goals = await getGoals();
  const { period } = resolvePeriod({ preset: "this_month", compare: "prior" }, now, { fiscalYearStartMonth: goals.fiscalYearStartMonth });
  const c = queryCtx(period, access, goals, now);
  const [projects, opps, proposals, pipeline, dataStartsAt] = await Promise.all([projectsSummary(c), oppsSummary(c), proposalsSummary(c), pipelineNow(c), dataStart()]);
  return buildSnapshotDTO({ projects, opps, proposals, pipeline }, { ...access, period, goals, dataStartsAt });
}
