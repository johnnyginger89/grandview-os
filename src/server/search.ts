import "server-only";
import { and, desc, eq, ilike, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from "@/app/(app)/projects/status";
import { STATUS_TONE as ESTIMATE_STATUS_TONE } from "@/app/(app)/estimates/status";
import type { Tone } from "@/components/ui";
import { db } from "@/db";
import { contacts, customers, estimates, opportunities, pipelineStages, projects, properties, workOrders } from "@/db/schema";
import { can } from "@/lib/authz/permissions";
import { likePattern, parseSearchQuery, type NumberKind, type ParsedQuery } from "@/lib/search/query";
import type { SearchHit, SearchKind, SearchResult } from "@/lib/search/types";
import { STATUS_LABEL as WORK_ORDER_STATUS_LABEL } from "@/lib/work-orders/types";
import { getProposalTemplate } from "@/server/settings";

// Never cache: what comes back depends on the viewer's role. No money in any result.

export type { SearchGroup, SearchHit, SearchKind, SearchResult } from "@/lib/search/types";

const GROUP_LABEL: Record<SearchKind, string> = {
  customer: "Customers",
  job: "Sold jobs",
  estimate: "Estimates",
  lead: "Leads",
  work_order: "Work orders",
};
const DEFAULT_ORDER: SearchKind[] = ["customer", "job", "estimate", "lead", "work_order"];
const NUMBER_FIRST: Record<NumberKind, SearchKind[]> = {
  job: ["job", "work_order", "estimate", "customer", "lead"],
  estimate: ["estimate", "job", "customer", "lead", "work_order"],
  work_order: ["work_order", "job", "estimate", "customer", "lead"],
  any: ["job", "estimate", "work_order", "customer", "lead"],
};

/** Which kinds of thing this role may find. Field roles find nothing: they only see My Jobs. */
export function searchKindsFor(role: string): SearchKind[] {
  return DEFAULT_ORDER.filter((k) =>
    k === "customer" ? can(role, "customers.read")
    : k === "lead" ? can(role, "pipeline.read")
    : k === "estimate" ? can(role, "estimates.read")
    : can(role, "projects.read_all"),
  );
}

export function canSearch(role: string): boolean {
  return searchKindsFor(role).length > 0;
}

const status = (label: string, tone: Tone) => ({ label, tone });
const digitsOf = (col: unknown) => sql`regexp_replace(coalesce(${col}, ''), '\\D', '', 'g')`;
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

/** Every word must match one of the columns; a phone number may match instead. */
function everyWord(q: ParsedQuery, columns: (p: string) => (SQL | undefined)[], phone?: (digits: string) => SQL): SQL | undefined {
  const words = and(...q.tokens.map((t) => or(...columns(likePattern(t)))));
  return q.phoneDigits && phone ? or(words, phone(q.phoneDigits)) : words;
}

const numberWanted = (q: ParsedQuery, kind: NumberKind) => (q.number && (q.number.kind === kind || q.number.kind === "any") ? q.number.value : null);
const explicitNumber = (q: ParsedQuery, kind: NumberKind) => (q.number && q.number.kind === kind ? q.number.value : null);

async function findCustomers(q: ParsedQuery, limit: number): Promise<SearchHit[]> {
  const address = sql<string | null>`(
    select concat_ws(', ', nullif(${properties.street}, ''), nullif(${properties.city}, ''))
    from ${properties} where ${properties.customerId} = ${customers.id}
    order by ${properties.createdAt} limit 1)`;
  const rows = await db
    .select({ id: customers.id, name: customers.displayName, type: customers.type, email: customers.email, phone: customers.phone, address })
    .from(customers)
    .where(
      and(
        isNull(customers.archivedAt),
        everyWord(
          q,
          (p) => [
            ilike(customers.displayName, p),
            ilike(customers.email, p),
            sql`exists (select 1 from ${properties} where ${properties.customerId} = ${customers.id}
              and (${properties.street} ilike ${p} or ${properties.city} ilike ${p} or ${properties.postalCode} ilike ${p} or ${properties.unit} ilike ${p} or ${properties.label} ilike ${p}))`,
            sql`exists (select 1 from ${contacts} where ${contacts.customerId} = ${customers.id}
              and (concat_ws(' ', ${contacts.firstName}, ${contacts.lastName}) ilike ${p} or ${contacts.email} ilike ${p}))`,
          ],
          (d) => sql`(${digitsOf(customers.phone)} like ${`%${d}%`} or exists (select 1 from ${contacts} where ${contacts.customerId} = ${customers.id}
            and (${digitsOf(contacts.phone)} like ${`%${d}%`} or ${digitsOf(contacts.phone2)} like ${`%${d}%`})))`,
        ),
      ),
    )
    .orderBy(desc(sql`${customers.displayName} ilike ${`${q.tokens[0].replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`), desc(customers.updatedAt))
    .limit(limit);
  return rows.map((r) => ({
    kind: "customer" as const,
    id: r.id,
    title: r.name,
    detail: [r.address, r.phone ?? r.email].filter(Boolean).join(" · "),
    status: r.type === "residential" ? null : status(capitalise(r.type), r.type === "strata" ? "info" : "brand"),
    href: `/customers/${r.id}`,
  }));
}

async function findJobs(q: ParsedQuery, limit: number): Promise<SearchHit[]> {
  const n = numberWanted(q, "job");
  const exact = explicitNumber(q, "job");
  const rows = await db
    .select({ id: projects.id, number: projects.number, name: projects.name, status: projects.status, street: properties.street, city: properties.city })
    .from(projects)
    .innerJoin(customers, eq(customers.id, projects.customerId))
    .leftJoin(properties, eq(properties.id, projects.propertyId))
    .where(
      exact !== null
        ? eq(projects.number, exact)
        : or(
            n !== null ? eq(projects.number, n) : undefined,
            everyWord(q, (p) => [ilike(projects.name, p), ilike(customers.displayName, p), ilike(properties.street, p), ilike(properties.city, p), ilike(properties.postalCode, p)], (d) => sql`${digitsOf(customers.phone)} like ${`%${d}%`}`),
          ),
    )
    .orderBy(desc(sql`${projects.number} = ${n ?? -1}`), desc(projects.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    kind: "job" as const,
    id: r.id,
    title: `#${r.number} ${r.name}`,
    detail: [r.street, r.city].filter(Boolean).join(", "),
    status: status(PROJECT_STATUS_LABEL[r.status], PROJECT_STATUS_TONE[r.status]),
    href: `/projects/${r.id}`,
  }));
}

async function findEstimates(q: ParsedQuery, limit: number, opts: { prefix: string; hideAccepted: boolean }): Promise<SearchHit[]> {
  const n = numberWanted(q, "estimate");
  const exact = explicitNumber(q, "estimate");
  const rows = await db
    .select({ id: estimates.id, number: estimates.number, title: estimates.title, status: estimates.status, customer: customers.displayName, city: properties.city })
    .from(estimates)
    .innerJoin(customers, eq(customers.id, estimates.customerId))
    .leftJoin(properties, eq(properties.id, estimates.propertyId))
    .where(
      and(
        ne(estimates.status, "archived"),
        // A signed estimate is found through its job, so it isn't listed twice.
        opts.hideAccepted && exact === null ? ne(estimates.status, "accepted") : undefined,
        exact !== null
          ? eq(estimates.number, exact)
          : or(
              n !== null ? eq(estimates.number, n) : undefined,
              everyWord(q, (p) => [ilike(estimates.title, p), ilike(customers.displayName, p), ilike(properties.street, p), ilike(properties.city, p)], (d) => sql`${digitsOf(customers.phone)} like ${`%${d}%`}`),
            ),
      ),
    )
    .orderBy(desc(sql`${estimates.number} = ${n ?? -1}`), desc(sql`coalesce(${estimates.sentAt}, ${estimates.createdAt})`))
    .limit(limit);
  return rows.map((r) => ({
    kind: "estimate" as const,
    id: r.id,
    title: r.customer,
    detail: [r.title, `${opts.prefix}${r.number}`, r.city].filter(Boolean).join(" · "),
    status: status(capitalise(r.status), ESTIMATE_STATUS_TONE[r.status] ?? "neutral"),
    href: `/estimates/${r.id}`,
  }));
}

async function findLeads(q: ParsedQuery, limit: number, opts: { hideWon: boolean }): Promise<SearchHit[]> {
  const rows = await db
    .select({ id: opportunities.id, title: opportunities.title, customer: customers.displayName, stage: pipelineStages.name, kind: pipelineStages.kind, city: properties.city })
    .from(opportunities)
    .innerJoin(customers, eq(customers.id, opportunities.customerId))
    .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .leftJoin(properties, eq(properties.id, opportunities.propertyId))
    .where(
      and(
        // A won lead became a sold job, which is listed instead.
        opts.hideWon ? ne(pipelineStages.kind, "won") : undefined,
        everyWord(
          q,
          (p) => [ilike(opportunities.title, p), ilike(customers.displayName, p), ilike(customers.email, p), ilike(properties.street, p), ilike(properties.city, p)],
          (d) => sql`${digitsOf(customers.phone)} like ${`%${d}%`}`,
        ),
      ),
    )
    .orderBy(desc(sql`${pipelineStages.kind} = 'open'`), desc(opportunities.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    kind: "lead" as const,
    id: r.id,
    title: r.customer,
    detail: [r.title, r.city].filter(Boolean).join(" · "),
    status: status(r.stage, r.kind === "won" ? "success" : r.kind === "lost" ? "neutral" : "brand"),
    href: `/leads/${r.id}`,
  }));
}

async function findWorkOrders(q: ParsedQuery, limit: number): Promise<SearchHit[]> {
  const n = numberWanted(q, "work_order");
  const exact = explicitNumber(q, "work_order");
  const rows = await db
    .select({ id: workOrders.id, number: workOrders.number, title: workOrders.title, status: workOrders.status, projectId: projects.id, projectNumber: projects.number })
    .from(workOrders)
    .innerJoin(projects, eq(projects.id, workOrders.projectId))
    .where(exact !== null ? eq(workOrders.number, exact) : or(n !== null ? eq(workOrders.number, n) : undefined, everyWord(q, (p) => [ilike(workOrders.title, p)])))
    .orderBy(desc(sql`${workOrders.number} = ${n ?? -1}`), desc(workOrders.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    kind: "work_order" as const,
    id: r.id,
    title: `WO-${r.number} ${r.title}`,
    detail: `Job #${r.projectNumber}`,
    status: status(WORK_ORDER_STATUS_LABEL[r.status], r.status === "issued" ? "success" : r.status === "cancelled" ? "danger" : "neutral"),
    href: `/projects/${r.projectId}#work-orders`,
  }));
}

/**
 * One search across customers, addresses, sold jobs, estimates, leads and work orders,
 * limited to what the viewer's role may open.
 */
export async function globalSearch(user: { role: string }, raw: string, opts: { perGroup?: number } = {}): Promise<SearchResult> {
  const kinds = searchKindsFor(user.role);
  const perGroup = Math.min(Math.max(opts.perGroup ?? 5, 1), 50);
  const prefix = kinds.includes("estimate") ? (await getProposalTemplate()).estimateDocument.numberPrefix : "";
  const q = parseSearchQuery(raw, { estimatePrefix: prefix });
  if (!q || !kinds.length) return { query: q?.text ?? raw.trim(), groups: [] };

  const seesJobs = kinds.includes("job");
  const limit = perGroup + 1;
  const run: Record<SearchKind, () => Promise<SearchHit[]>> = {
    customer: () => findCustomers(q, limit),
    job: () => findJobs(q, limit),
    estimate: () => findEstimates(q, limit, { prefix, hideAccepted: seesJobs }),
    lead: () => findLeads(q, limit, { hideWon: seesJobs }),
    work_order: () => findWorkOrders(q, limit),
  };
  const order = (q.number ? NUMBER_FIRST[q.number.kind] : DEFAULT_ORDER).filter((k) => kinds.includes(k));
  const found = await Promise.all(order.map((k) => run[k]()));
  return {
    query: q.text,
    groups: order
      .map((kind, i) => ({ kind, label: GROUP_LABEL[kind], hits: found[i].slice(0, perGroup), more: found[i].length > perGroup }))
      .filter((g) => g.hits.length > 0),
  };
}
