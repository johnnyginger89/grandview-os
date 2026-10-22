import "server-only";
import { and, count, desc, eq, ilike, max, ne, or, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import { customers, estimates, proposals, type EstimateStatus } from "@/db/schema";
import { margin } from "@/lib/money";
import { loadPage, type Paged } from "@/lib/paging";
import { likePattern } from "@/lib/search/query";

// Never cache: the costing figures depend on the viewer's role.

export interface EstimateListRow {
  id: string;
  number: number;
  title: string;
  status: EstimateStatus;
  customer: string;
  totalWithTax: string;
  /** When it was sent, or else created: the list's order and month. */
  listedAt: Date;
  /** First time the customer opened any live proposal for it. */
  firstViewedAt: Date | null;
  viewCount: number;
  /** Margin (a fraction) and hours, only for roles with estimates.costing. */
  costing: { margin: string; hours: string } | null;
}

/** The Estimates page: most recently sent or created first, by status and customer, title or number. */
export async function listEstimates(opts: { status?: EstimateStatus | ""; q?: string; page?: number; costing: boolean }): Promise<Paged<EstimateListRow>> {
  const q = (opts.q ?? "").trim().slice(0, 100);
  const number = q.replace(/^est-?/i, "");
  const where = and(
    opts.status ? eq(estimates.status, opts.status) : undefined,
    q
      ? or(
          ilike(customers.displayName, likePattern(q)),
          ilike(estimates.title, likePattern(q)),
          /^\d+$/.test(number) ? sql`${estimates.number}::text like ${`%${number}%`}` : undefined,
        )
      : undefined,
  );
  // How often the customer opened any live proposal for each estimate.
  const views = db
    .select({ estimateId: proposals.estimateId, firstViewedAt: max(proposals.firstViewedAt).as("first_viewed_at"), viewCount: sum(proposals.viewCount).as("view_count") })
    .from(proposals)
    .where(ne(proposals.status, "withdrawn"))
    .groupBy(proposals.estimateId)
    .as("views");
  const listedAt = sql`coalesce(${estimates.sentAt}, ${estimates.createdAt})`;

  return loadPage(
    opts.page ?? 1,
    async () => (await db.select({ n: count() }).from(estimates).innerJoin(customers, eq(customers.id, estimates.customerId)).where(where))[0]?.n ?? 0,
    async (limit, offset) => {
      const rows = await db
        .select({
          id: estimates.id,
          number: estimates.number,
          title: estimates.title,
          status: estimates.status,
          customer: customers.displayName,
          totalWithTax: estimates.totalWithTax,
          totalPrice: estimates.totalPrice,
          totalCost: estimates.totalCost,
          totalHours: estimates.totalHours,
          sentAt: estimates.sentAt,
          createdAt: estimates.createdAt,
          firstViewedAt: views.firstViewedAt,
          viewCount: views.viewCount,
        })
        .from(estimates)
        .innerJoin(customers, eq(customers.id, estimates.customerId))
        .leftJoin(views, eq(views.estimateId, estimates.id))
        .where(where)
        .orderBy(desc(listedAt), desc(estimates.number))
        .limit(limit)
        .offset(offset);
      return rows.map((r) => ({
        id: r.id,
        number: r.number,
        title: r.title,
        status: r.status,
        customer: r.customer,
        totalWithTax: r.totalWithTax,
        listedAt: r.sentAt ?? r.createdAt,
        firstViewedAt: r.firstViewedAt,
        viewCount: Number(r.viewCount ?? 0),
        costing: opts.costing ? { margin: margin(r.totalPrice, r.totalCost).toFixed(4), hours: r.totalHours } : null,
      }));
    },
  );
}
