import "server-only";
import { count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, projects, properties, type ProjectStatus } from "@/db/schema";
import { loadPage, type Paged } from "@/lib/paging";

// Never cache: whether the contract total is included depends on the viewer's role.

export interface ProjectListRow {
  id: string;
  number: number;
  /** "Customer – Job title". */
  name: string;
  status: ProjectStatus;
  customer: string;
  city: string | null;
  startDate: Date | null;
  /** Only when the viewer may see money. */
  contractTotal: string | null;
}

/** The Jobs page: every sold job, newest first. */
export async function listProjects(opts: { page?: number; includeMoney: boolean }): Promise<Paged<ProjectListRow>> {
  return loadPage(
    opts.page ?? 1,
    async () => (await db.select({ n: count() }).from(projects).innerJoin(customers, eq(customers.id, projects.customerId)))[0]?.n ?? 0,
    async (limit, offset) => {
      const rows = await db
        .select({
          id: projects.id,
          number: projects.number,
          name: projects.name,
          status: projects.status,
          customer: customers.displayName,
          city: properties.city,
          startDate: projects.startDate,
          contractTotal: projects.contractTotal,
        })
        .from(projects)
        .innerJoin(customers, eq(customers.id, projects.customerId))
        .leftJoin(properties, eq(properties.id, projects.propertyId))
        .orderBy(desc(projects.createdAt), desc(projects.number))
        .limit(limit)
        .offset(offset);
      return rows.map((r) => ({ ...r, contractTotal: opts.includeMoney ? r.contractTotal : null }));
    },
  );
}
