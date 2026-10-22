import "server-only";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { outer } from "@/db/sql";
import { CUSTOMER_TYPES, customers, properties } from "@/db/schema";
import { loadPage, type Paged } from "@/lib/paging";
import { parseSearchQuery, type ParsedQuery } from "@/lib/search/query";
import { reachColumn } from "./customer-columns";
import { customerMatches } from "./search";

export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export interface CustomerListRow {
  id: string;
  name: string;
  type: CustomerType;
  email: string | null;
  phone: string | null;
  tags: string[];
  /** City of their first property. */
  city: string | null;
  createdAt: Date;
}

/** The search box waits for two letters; a one-letter search on the list still filters it. */
function listQuery(raw: string): ParsedQuery | null {
  const text = raw.trim();
  return parseSearchQuery(text) ?? (text ? { text, tokens: [text], number: null, phoneDigits: null } : null);
}

/** The Customers page, newest first, searched like the top search box (names, addresses, contacts, phone numbers). */
export async function listCustomers(opts: { q?: string; type?: CustomerType | ""; page?: number }): Promise<Paged<CustomerListRow>> {
  const q = listQuery(opts.q ?? "");
  const where = and(isNull(customers.archivedAt), opts.type ? eq(customers.type, opts.type) : undefined, q ? customerMatches(q) : undefined);
  const city = sql<string | null>`(select ${properties.city} from ${properties} where ${properties.customerId} = ${outer(customers.id)} order by ${properties.createdAt} limit 1)`;
  return loadPage(
    opts.page ?? 1,
    async () => (await db.select({ n: count() }).from(customers).where(where))[0]?.n ?? 0,
    (limit, offset) =>
      db
        .select({ id: customers.id, name: customers.displayName, type: customers.type, email: reachColumn("email"), phone: reachColumn("phone"), tags: customers.tags, city, createdAt: customers.createdAt })
        .from(customers)
        .where(where)
        // Imports add many customers in one go with the same created time; the id keeps pages from overlapping.
        .orderBy(desc(customers.createdAt), desc(customers.id))
        .limit(limit)
        .offset(offset),
  );
}
