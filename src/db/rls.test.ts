/**
 * Supabase exposes the public schema through its Data API. 0002 enabled RLS on every
 * table that existed then; every table created later must enable it in its own migration.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DRIZZLE = fileURLToPath(new URL("../../drizzle", import.meta.url));
const journal = JSON.parse(readFileSync(path.join(DRIZZLE, "meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
/** Migrations 0000–0001 predate 0002's blanket lock-down. */
const RLS_FROM_IDX = 3;

const stripSqlComments = (sql: string) => sql.replace(/--(?!> statement-breakpoint).*$/gm, "");
const tableName = (raw: string) => raw.replace(/"/g, "").replace(/^public\./, "");

function tablesMissingRls(sql: string): string[] {
  const body = stripSqlComments(sql);
  const created = [...body.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?((?:"?public"?\.)?"?[\w]+"?)/gi)].map((m) => tableName(m[1]));
  const secured = new Set(
    [...body.matchAll(/\balter\s+table\s+(?:only\s+)?((?:"?public"?\.)?"?[\w]+"?)\s+enable\s+row\s+level\s+security/gi)].map((m) => tableName(m[1])),
  );
  return created.filter((t) => !secured.has(t));
}

describe("row level security on new tables", () => {
  it("detects a table without RLS (self-test)", () => {
    expect(tablesMissingRls(`CREATE TABLE "a" ("id" uuid);\nALTER TABLE "a" ENABLE ROW LEVEL SECURITY;`)).toEqual([]);
    expect(tablesMissingRls(`CREATE TABLE IF NOT EXISTS "public"."b" ("id" uuid);`)).toEqual(["b"]);
    expect(tablesMissingRls(`CREATE TABLE "c" ("id" uuid);\n-- ALTER TABLE "c" ENABLE ROW LEVEL SECURITY;`)).toEqual(["c"]);
    expect(tablesMissingRls(`CREATE TABLE "d" ("id" uuid);\nALTER TABLE "e" ENABLE ROW LEVEL SECURITY;`)).toEqual(["d"]);
  });

  it(`every table created from migration ${String(RLS_FROM_IDX).padStart(4, "0")} on enables RLS in the same migration`, () => {
    const checked = journal.entries.filter((e) => e.idx >= RLS_FROM_IDX);
    expect(checked.length).toBeGreaterThan(0);
    const missing = checked.flatMap((e) => tablesMissingRls(readFileSync(path.join(DRIZZLE, `${e.tag}.sql`), "utf8")).map((t) => `${e.tag}: ${t}`));
    expect(missing, 'Append ALTER TABLE "<t>" ENABLE ROW LEVEL SECURITY; for each new table').toEqual([]);
  });

  it("the guard sees the tables it should", () => {
    const sql = readFileSync(path.join(DRIZZLE, `${journal.entries[3].tag}.sql`), "utf8");
    expect(stripSqlComments(sql)).toMatch(/CREATE TABLE "projects"/);
    expect(tablesMissingRls(sql.replace(/ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;/, ""))).toEqual(["projects"]);
  });
});
