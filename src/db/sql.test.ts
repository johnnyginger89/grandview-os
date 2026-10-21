import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";
import { outer } from "./sql";

const db = drizzle.mock({ schema, casing: "snake_case" });
const { crews, crewMembers, customers, properties } = schema;

describe("outer", () => {
  it("names the outer column in full inside a single-table subquery", () => {
    const bare = db.select({ n: sql`(select count(*) from ${crewMembers} where ${crewMembers.crewId} = ${crews.id})` }).from(crews).toSQL().sql;
    // The trap this guards against: "id" here means crew_members.id.
    expect(bare).toContain('where "crew_id" = "id"');
    const fixed = db.select({ n: sql`(select count(*) from ${crewMembers} where ${crewMembers.crewId} = ${outer(crews.id)})` }).from(crews).toSQL().sql;
    expect(fixed).toContain('where "crew_id" = "crews"."id"');
  });

  it("uses the database name of camel-case columns", () => {
    const q = db.select({ c: sql`(select 1 from ${properties} where ${properties.customerId} = ${outer(customers.id)})` }).from(customers).toSQL().sql;
    expect(q).toContain('"customer_id" = "customers"."id"');
    expect(db.select({ x: outer(properties.customerId) }).from(properties).toSQL().sql).toContain('"properties"."customer_id"');
  });
});
