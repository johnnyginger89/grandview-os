import { describe, expect, it } from "vitest";
import { databaseUrl, poolConfig } from "./connection";

describe("database connection", () => {
  it("moves Supabase session-pooler URLs to transaction mode and drops sslmode", () => {
    const u = databaseUrl("postgresql://postgres.ref:pw@aws-0-ca-central-1.pooler.supabase.com:5432/postgres?sslmode=require");
    expect(u).toBe("postgresql://postgres.ref:pw@aws-0-ca-central-1.pooler.supabase.com:6543/postgres");
  });
  it("leaves other URLs alone", () => {
    expect(databaseUrl("postgres://postgres@localhost:5432/grandview_dev")).toBe("postgres://postgres@localhost:5432/grandview_dev");
    expect(databaseUrl("postgresql://u:p@aws-0-ca-central-1.pooler.supabase.com:6543/postgres")).toContain(":6543/");
  });
  it("uses SSL for remote databases only", () => {
    expect(poolConfig("postgres://postgres@localhost:5432/x").ssl).toBe(false);
    expect(poolConfig("postgresql://u:p@aws-0-ca-central-1.pooler.supabase.com:6543/postgres").ssl).toEqual({ rejectUnauthorized: false });
  });
});
