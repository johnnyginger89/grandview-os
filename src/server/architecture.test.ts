/**
 * Architecture rules checked against the source tree. Later batches append rules here.
 * Each rule has a small self-test so a broken detector can't pass silently.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { CHECKSUMS_FILE, migrationChecksum } from "../db/migration-checksums";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const posix = (p: string) => p.split(path.sep).join("/");

interface Source {
  file: string;
  text: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const SOURCES: Source[] = walk(path.join(ROOT, "src")).map((abs) => ({ file: posix(path.relative(ROOT, abs)), text: readFileSync(abs, "utf8") }));

function ast(s: Source): ts.SourceFile {
  return ts.createSourceFile(s.file, s.text, ts.ScriptTarget.Latest, true, s.file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function visit(node: ts.Node, fn: (n: ts.Node) => void) {
  fn(node);
  node.forEachChild((c) => visit(c, fn));
}

const at = (sf: ts.SourceFile, n: ts.Node) => `${sf.fileName}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;

function methodCall(n: ts.Node, name: string): ts.CallExpression | null {
  return ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === name ? n : null;
}

function hasDirective(sf: ts.SourceFile, directive: string): boolean {
  const first = sf.statements[0];
  return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === directive;
}

/** Text of string and template literals, with "${}" for interpolations. */
function literalText(n: ts.Node): string | null {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map((s) => "${}" + s.literal.text).join("");
  return null;
}

// ---------------------------------------------------------------------------
// Rule: src/server/project-status.ts is the only writer of projects.status.
// ---------------------------------------------------------------------------

const STATUS_WRITER = "src/server/project-status.ts";
const RAW_STATUS_UPDATE = /\bupdate\s+"?projects"?\s+(?:as\s+)?(?:\w+\s+)?set\b(?:(?!\bwhere\b)[\s\S])*?"?\bstatus"?\s*=/i;
const RAW_PROJECT_INSERT = /\binsert\s+into\s+"?projects"?\s*\(/i;

const isProjectsTable = (e: ts.Expression | undefined) =>
  !!e && ((ts.isIdentifier(e) && e.text === "projects") || (ts.isPropertyAccessExpression(e) && e.name.text === "projects"));

function statusWriteViolations(s: Source): string[] {
  const sf = ast(s);
  const out = new Set<string>();
  visit(sf, (n) => {
    const insert = methodCall(n, "insert");
    if (insert && isProjectsTable(insert.arguments[0])) out.add(`${at(sf, n)} inserts projects (use createSoldProject)`);
    const set = methodCall(n, "set");
    const update = set && ts.isPropertyAccessExpression(set.expression) ? methodCall(set.expression.expression, "update") : null;
    if (set && update && isProjectsTable(update.arguments[0])) {
      const arg = set.arguments[0];
      if (!arg || !ts.isObjectLiteralExpression(arg)) out.add(`${at(sf, n)} updates projects with a non-literal .set() (write an object literal so the status rule can be checked)`);
      else
        for (const p of arg.properties) {
          if (ts.isSpreadAssignment(p)) out.add(`${at(sf, n)} spreads into projects .set() (list the columns)`);
          else if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === "status") out.add(`${at(sf, n)} sets projects.status`);
        }
    }
    const text = literalText(n);
    if (text && RAW_STATUS_UPDATE.test(text)) out.add(`${at(sf, n)} sets projects.status in SQL`);
    if (text && RAW_PROJECT_INSERT.test(text)) out.add(`${at(sf, n)} inserts projects in SQL`);
  });
  return [...out];
}

describe("projects.status has a single writer", () => {
  it("detects status writes (self-test)", () => {
    const check = (text: string) => statusWriteViolations({ file: "x.ts", text });
    for (const bad of [
      `db.update(projects).set({ status: "complete" })`,
      `tx.update(schema.projects).set({ "status": to, updatedAt })`,
      `tx.update(projects).set({ status }).where(eq(projects.id, id))`,
      `tx.update(projects).set({ ...patch, updatedAt: now })`,
      `tx.update(projects).set(patch)`,
      `db.insert(projects).values(v)`,
      "db.execute(sql`update projects set status = ${s} where id = ${id}`)",
      "db.execute(sql`UPDATE \"projects\" p SET \"updated_at\" = now(), \"status\" = 'complete'`)",
      `const q = "insert into projects (name) values ($1)"`,
    ])
      expect(check(bad), bad).not.toEqual([]);
    for (const ok of [
      `db.update(projects).set({ startDate, endDate, updatedAt: now })`,
      `db.update(estimates).set({ status: "sent" })`,
      `db.insert(projectStatusEvents).values({ toStatus: "complete" })`,
      `await changeProjectStatus(id, "scheduled", { actorId }, tx)`,
      "db.execute(sql`update \"projects\" set \"completed_at\" = now() where \"status\" = 'complete'`)",
      "db.execute(sql`select status from projects where status = ${s}`)",
    ])
      expect(check(ok), ok).toEqual([]);
  });

  it("only project-status.ts writes projects.status or inserts projects", () => {
    expect(SOURCES.some((s) => s.file === STATUS_WRITER)).toBe(true);
    const violations = SOURCES.filter((s) => s.file !== STATUS_WRITER).flatMap(statusWriteViolations);
    expect(violations, "Change project status through changeProjectStatus / createSoldProject in src/server/project-status.ts").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule: permission-dependent dashboard and list code is never cached.
// The numbers depend on the viewer's role, so a shared cache would leak them.
// ---------------------------------------------------------------------------

const UNCACHED = [
  "src/server/search.ts",
  "src/app/api/search/",
  "src/app/(app)/search/",
  "src/app/(app)/layout.tsx",
  "src/server/dashboard.ts",
  "src/server/jobs-today.ts",
  "src/server/goals.ts",
  "src/server/pipeline-list.ts",
  "src/server/project-status.ts",
  "src/lib/reporting/",
  "src/components/reporting/",
  "src/app/(app)/performance/",
  "src/app/(app)/month-snapshot.tsx",
  "src/app/(app)/page.tsx",
  "src/app/(app)/home-tiles.tsx",
  "src/app/(app)/leads/",
  "src/app/(app)/projects/",
  "src/app/(app)/settings/",
  "src/server/schedule.ts",
  "src/server/my-jobs.ts",
  "src/server/crews.ts",
  "src/server/readiness.ts",
  "src/server/start-notices.ts",
  "src/app/(app)/schedule/",
  "src/app/(app)/my-jobs/",
  "src/components/schedule/",
  "src/server/work-orders.ts",
  "src/components/work-order/",
  "src/app/share/wo/",
  "src/app/(preview)/projects/",
];
const CACHE_APIS = new Set(["unstable_cache", "cacheLife", "cacheTag", "unstable_cacheLife", "unstable_cacheTag"]);

function cacheViolations(s: Source): string[] {
  const sf = ast(s);
  const out = new Set<string>();
  visit(sf, (n) => {
    if (ts.isExpressionStatement(n) && ts.isStringLiteral(n.expression) && /^use cache\b/.test(n.expression.text)) out.add(`${at(sf, n)} "${n.expression.text}"`);
    if (ts.isIdentifier(n) && CACHE_APIS.has(n.text)) out.add(`${at(sf, n)} ${n.text}`);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const v = n.initializer;
      if (n.name.text === "dynamic" && ts.isStringLiteral(v) && v.text === "force-static") out.add(`${at(sf, n)} dynamic = "force-static"`);
      if (n.name.text === "revalidate" && ts.isNumericLiteral(v) && Number(v.text) > 0) out.add(`${at(sf, n)} revalidate = ${v.text}`);
    }
  });
  return [...out];
}

describe("dashboard and list data is never cached", () => {
  it("detects caching (self-test)", () => {
    const check = (text: string) => cacheViolations({ file: "x.ts", text });
    expect(check(`"use cache";\nexport async function f() {}`)).not.toEqual([]);
    expect(check(`export async function f() { "use cache: private"; return 1; }`)).not.toEqual([]);
    expect(check(`import { unstable_cache } from "next/cache";`)).not.toEqual([]);
    expect(check(`export const dynamic = "force-static";`)).not.toEqual([]);
    expect(check(`export const revalidate = 60;`)).not.toEqual([]);
    expect(check(`// Never wrap these in unstable_cache or "use cache".\nexport const revalidate = 0;`)).toEqual([]);
  });

  it("finds no cache APIs in permission-dependent code", () => {
    const files = SOURCES.filter((s) => UNCACHED.some((p) => (p.endsWith("/") ? s.file.startsWith(p) : s.file === p)));
    expect(files.length).toBeGreaterThan(3);
    expect(files.flatMap(cacheViolations)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule (feasibility review F10): client forms don't use a bare form action.
// React 19 resets uncontrolled forms after a form action, wiping what the user
// typed when validation fails. Use onSubmit={submitWith(dispatch)} instead.
// ---------------------------------------------------------------------------

/** Existing uses, allowed until those forms are reworked. Don't raise these numbers. */
const FORM_ACTION_BASELINE: Record<string, number> = {
  "src/app/(app)/rates/rates-client.tsx": 2,
  "src/app/(app)/settings/settings-client.tsx": 1,
};

function formActionCount(s: Source): number {
  const sf = ast(s);
  if (!hasDirective(sf, "use client")) return 0;
  let count = 0;
  visit(sf, (n) => {
    if (!ts.isJsxAttribute(n) || !ts.isIdentifier(n.name)) return;
    const el = n.parent.parent;
    const tag = ts.isJsxOpeningElement(el) || ts.isJsxSelfClosingElement(el) ? el.tagName.getText(sf) : "";
    if ((n.name.text === "action" && tag === "form") || n.name.text === "formAction") count++;
  });
  return count;
}

describe("client forms keep what the user typed", () => {
  it("detects bare form actions (self-test)", () => {
    const count = (text: string) => formActionCount({ file: "x.tsx", text });
    expect(count(`"use client";\nexport const F = () => <form action={save}><input name="a" /></form>;`)).toBe(1);
    expect(count(`"use client";\nexport const F = () => <form><button formAction={save}>Go</button></form>;`)).toBe(1);
    expect(count(`"use client";\nexport const F = () => <form onSubmit={submitWith(save)}><input name="a" /></form>;`)).toBe(0);
    expect(count(`export const F = () => <form action={save}></form>;`)).toBe(0);
  });

  it("new client forms use submitWith or controlled inputs", () => {
    const over = SOURCES.filter((s) => s.file.endsWith(".tsx"))
      .map((s) => ({ file: s.file, count: formActionCount(s), allowed: FORM_ACTION_BASELINE[s.file] ?? 0 }))
      .filter((r) => r.count > r.allowed);
    expect(over, "Use onSubmit={submitWith(dispatch)} (src/components/submit.ts) instead of <form action> in client components").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule (security review M3): server actions validate every argument with zod.
// They can be called by direct POST with any values, whatever the TypeScript
// types say. FormData arguments must be parsed by a schema somewhere in the body.
// ---------------------------------------------------------------------------

/**
 * Existing actions that hand an argument to a service unparsed (most services parse
 * it themselves). Allowed until reworked; don't add to this list.
 */
const UNPARSED_ARG_BASELINE = new Set<string>([
  "src/app/(app)/customers/actions.ts#createCustomerAction(f)",
  "src/app/(app)/estimates/actions.ts#createEstimateAction(f)",
  "src/app/(app)/estimates/actions.ts#saveEstimateAction(doc)",
  "src/app/(app)/estimates/actions.ts#createRevisionAction(reason)",
  "src/app/(app)/estimates/actions.ts#sendProposalAction(input)",
  "src/app/(app)/estimates/actions.ts#withdrawProposalAction(estimateId)",
  "src/app/(app)/leads/actions.ts#createLeadAction(form)",
  "src/app/(app)/leads/actions.ts#moveStageAction(lostReason)",
  "src/app/(app)/rates/actions.ts#saveRateAction(input)",
  "src/app/(app)/rates/actions.ts#setRateActiveAction(active)",
  "src/app/(app)/rates/actions.ts#saveMaterialAction(id)",
  "src/app/(app)/rates/actions.ts#saveMaterialAction(values)",
  "src/app/(app)/rates/actions.ts#saveFactorAction(id)",
  "src/app/(app)/rates/actions.ts#saveFactorAction(values)",
  "src/app/(app)/settings/actions.ts#createUserAction(f)",
  "src/app/(app)/settings/import/actions.ts#uploadImportAction(form)",
  "src/app/(app)/settings/import/actions.ts#saveMappingAction(batchId)",
  "src/app/(app)/settings/import/actions.ts#saveMappingAction(mapping)",
  "src/app/(app)/settings/import/actions.ts#runImportAction(batchId)",
  "src/app/(app)/settings/import/actions.ts#rollbackImportAction(batchId)",
  "src/app/(app)/settings/import/actions.ts#deleteImportAction(batchId)",
  "src/app/(app)/settings/proposals/actions.ts#saveProposalTemplateSectionAction(value)",
  "src/app/(app)/settings/proposals/media-actions.ts#startUploadAction(input)",
  "src/app/(app)/settings/proposals/media-actions.ts#uploadChunkAction(index)",
  "src/app/(app)/settings/proposals/media-actions.ts#updateDocumentAction(input)",
  "src/app/(preview)/actions.ts#previewDraftTotalsAction(selectedIds)",
  "src/app/(preview)/actions.ts#previewSampleTotalsAction(jobType)",
  "src/app/(preview)/actions.ts#previewSampleTotalsAction(selectedIds)",
  "src/app/setup/actions.ts#setupAction(f)",
  "src/app/share/p/[token]/actions.ts#previewTotalsAction(token)",
  "src/app/share/p/[token]/actions.ts#previewTotalsAction(selectedIds)",
  "src/app/share/p/[token]/actions.ts#acceptAction(token)",
  "src/app/share/p/[token]/actions.ts#acceptAction(input)",
  "src/app/share/p/[token]/actions.ts#declineAction(token)",
  "src/app/share/p/[token]/actions.ts#declineAction(reason)",
]);

const PARSE_METHODS = new Set(["parse", "safeParse", "parseAsync", "safeParseAsync"]);

function exportedFunctions(sf: ts.SourceFile): { name: string; fn: ts.FunctionLikeDeclaration }[] {
  const out: { name: string; fn: ts.FunctionLikeDeclaration }[] = [];
  for (const st of sf.statements) {
    const exported = ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(st) && st.name) out.push({ name: st.name.text, fn: st });
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)))
          out.push({ name: d.name.text, fn: d.initializer });
  }
  return out;
}

function unparsedArgs(s: Source): string[] {
  const sf = ast(s);
  if (!hasDirective(sf, "use server")) return [];
  const out: string[] = [];
  for (const { name, fn } of exportedFunctions(sf)) {
    const parsed = new Set<string>();
    let anyParse = false;
    if (fn.body)
      visit(fn.body, (n) => {
        if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || !PARSE_METHODS.has(n.expression.name.text)) return;
        anyParse = true;
        for (const a of n.arguments) visit(a, (x) => ts.isIdentifier(x) && parsed.add(x.text));
      });
    for (const p of fn.parameters) {
      const key = `${s.file}#${name}`;
      if (!ts.isIdentifier(p.name)) {
        out.push(`${key}(destructured) — take a named argument and parse it`);
        continue;
      }
      const arg = p.name.text;
      if (arg.startsWith("_")) continue;
      const isFormData = p.type?.getText(sf) === "FormData";
      if (isFormData ? anyParse : parsed.has(arg)) continue;
      out.push(`${key}(${arg})`);
    }
  }
  return out;
}

describe("server actions validate their arguments", () => {
  it("detects unparsed arguments (self-test)", () => {
    const check = (text: string) => unparsedArgs({ file: "a.ts", text: `"use server";\n${text}` });
    expect(check(`export async function a(id: string) { await svc(id); }`)).toEqual(["a.ts#a(id)"]);
    expect(check(`export async function a(id: string, input: unknown) { const v = schema.parse({ id, ...(input as object) }); }`)).toEqual([]);
    expect(check(`export async function a(_: unknown, f: FormData) { const v = schema.safeParse(Object.fromEntries(f)); }`)).toEqual([]);
    expect(check(`export async function a(_: unknown, f: FormData) { await svc(f.get("x")); }`)).toEqual(["a.ts#a(f)"]);
    expect(check(`export const a = async (key: string) => { z.enum(["x"]).parse(key); };`)).toEqual([]);
    expect(unparsedArgs({ file: "b.ts", text: `export async function a(id: string) { await svc(id); }` })).toEqual([]);
  });

  it("every exported server action parses each argument", () => {
    const found = SOURCES.flatMap(unparsedArgs);
    expect(found.filter((v) => !UNPARSED_ARG_BASELINE.has(v)), "Validate server action arguments with zod inside the action").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rules (feasibility review F12): migrations stay additive and in order.
// drizzle's migrator skips any migration whose journal `when` is not newer than
// the last one applied, so an out-of-order entry would silently never run.
// ---------------------------------------------------------------------------

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}
const DRIZZLE = path.join(ROOT, "drizzle");
const journal = JSON.parse(readFileSync(path.join(DRIZZLE, "meta/_journal.json"), "utf8")) as { entries: JournalEntry[] };
/** 0001 changed a column type before this rule existed; the rule applies from 0006 on. */
const ADDITIVE_FROM_IDX = 6;

const stripSqlComments = (sql: string) => sql.replace(/--(?!> statement-breakpoint).*$/gm, "");

const DESTRUCTIVE: [RegExp, string][] = [
  [/\bdrop\s+table\b/i, "DROP TABLE"],
  [/\bdrop\s+column\b/i, "DROP COLUMN"],
  [/\brename\s+(column\s+|constraint\s+)?[\w"]+\s+to\b|\brename\s+to\b/i, "RENAME"],
  [/\balter\s+column\s+[\w"]+\s+(set\s+data\s+)?type\b/i, "ALTER COLUMN … TYPE"],
  [/\balter\s+column\s+[\w"]+\s+set\s+not\s+null\b/i, "SET NOT NULL on an existing column"],
  [/\btruncate\b/i, "TRUNCATE"],
  [/\bdelete\s+from\b/i, "DELETE FROM"],
];

/** Data backfills (0006 has one) predate the review rule. */
const DATA_CHANGE_FROM_IDX = 14;

function unreviewedDataChange(sql: string): boolean {
  if (/^--\s*reviewed backfill:/im.test(sql)) return false;
  return /(^|;)\s*update\s+"?\w+"?\s+set\b/im.test(stripSqlComments(sql));
}

function destructiveStatements(sql: string): string[] {
  const body = stripSqlComments(sql);
  const found = DESTRUCTIVE.filter(([re]) => re.test(body)).map(([, what]) => what);
  // A NOT NULL column without a default can't be added to a table that has rows.
  for (const m of body.matchAll(/\badd\s+column\s+("?[\w]+"?)([^;]*)/gi))
    if (/\bnot\s+null\b/i.test(m[2]) && !/\bdefault\b/i.test(m[2]) && !/\bgenerated\b/i.test(m[2])) found.push(`ADD COLUMN ${m[1]} NOT NULL without DEFAULT`);
  // Live code may rely on a unique index or constraint (e.g. an ON CONFLICT target); replacing one in the same migration is fine.
  for (const m of body.matchAll(/\bdrop\s+(constraint|index)\s+(?:if\s+exists\s+)?"?([\w.]+)"?/gi)) {
    const readded = new RegExp(`\\b(add\\s+constraint|create\\s+(unique\\s+)?index(\\s+concurrently)?(\\s+if\\s+not\\s+exists)?)\\s+"?${m[2]}"?(\\s|$)`, "i");
    if (!readded.test(body)) found.push(`DROP ${m[1].toUpperCase()} ${m[2]}`);
  }
  return found;
}

describe("migrations", () => {
  it("journal entries are numbered in order and `when` strictly increases", () => {
    const entries = journal.entries;
    expect(entries.length).toBeGreaterThan(ADDITIVE_FROM_IDX);
    entries.forEach((e, i) => {
      expect(e.idx, e.tag).toBe(i);
      expect(e.tag.startsWith(String(i).padStart(4, "0") + "_"), e.tag).toBe(true);
      if (i > 0) expect(e.when, `${e.tag} must be newer than ${entries[i - 1].tag}; regenerate it with pnpm db:generate`).toBeGreaterThan(entries[i - 1].when);
    });
  });

  it("every migration file is in the journal and has a snapshot", () => {
    const files = readdirSync(DRIZZLE).filter((f) => f.endsWith(".sql")).sort();
    expect(files).toEqual(journal.entries.map((e) => `${e.tag}.sql`));
    for (const e of journal.entries) expect(existsSync(path.join(DRIZZLE, "meta", `${String(e.idx).padStart(4, "0")}_snapshot.json`)), e.tag).toBe(true);
  });

  it("detects destructive DDL (self-test)", () => {
    expect(destructiveStatements(`ALTER TABLE "x" DROP COLUMN "y";`)).toEqual(["DROP COLUMN"]);
    expect(destructiveStatements(`ALTER TABLE "rate_limit" ALTER COLUMN "last_request" SET DATA TYPE bigint;`)).toEqual(["ALTER COLUMN … TYPE"]);
    expect(destructiveStatements(`ALTER TABLE "x" RENAME COLUMN "a" TO "b";`)).toEqual(["RENAME"]);
    expect(destructiveStatements(`ALTER TABLE "x" ADD COLUMN "a" text NOT NULL;`)).toEqual([`ADD COLUMN "a" NOT NULL without DEFAULT`]);
    expect(destructiveStatements(`ALTER TABLE "x" ADD COLUMN "a" timestamp with time zone DEFAULT now() NOT NULL;`)).toEqual([]);
    expect(destructiveStatements(`-- we never DROP TABLE here\nCREATE INDEX "i" ON "x" ("a");`)).toEqual([]);
    expect(destructiveStatements(`ALTER TABLE "x" DROP CONSTRAINT "x_a_unique";`)).toEqual(["DROP CONSTRAINT x_a_unique"]);
    expect(destructiveStatements(`DROP INDEX "x_a_idx";`)).toEqual(["DROP INDEX x_a_idx"]);
    expect(destructiveStatements(`ALTER TABLE "x" DROP CONSTRAINT "kind_chk";\nALTER TABLE "x" ADD CONSTRAINT "kind_chk" CHECK ("x"."kind" IN ('a','b'));`)).toEqual([]);
  });

  it(`migrations from ${String(ADDITIVE_FROM_IDX).padStart(4, "0")} on are additive only`, () => {
    const bad = journal.entries
      .filter((e) => e.idx >= ADDITIVE_FROM_IDX)
      .flatMap((e) => destructiveStatements(readFileSync(path.join(DRIZZLE, `${e.tag}.sql`), "utf8")).map((what) => `${e.tag}: ${what}`));
    expect(bad, "Migrations run before the new code is live: add tables, nullable or defaulted columns and indexes only").toEqual([]);
  });

  it("detects unreviewed data changes (self-test)", () => {
    expect(unreviewedDataChange(`UPDATE "estimates" SET "x" = 1;`)).toBe(true);
    expect(unreviewedDataChange(`-- reviewed backfill: fills the new column from the old one\nUPDATE "estimates" SET "x" = 1;`)).toBe(false);
    expect(unreviewedDataChange(`ALTER TABLE "x" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;`)).toBe(false);
    expect(unreviewedDataChange(`CREATE TRIGGER t BEFORE UPDATE ON "x" FOR EACH ROW EXECUTE FUNCTION f();`)).toBe(false);
  });

  it(`migrations from ${String(DATA_CHANGE_FROM_IDX).padStart(4, "0")} on only change live data with a reviewed-backfill note`, () => {
    const bad = journal.entries.filter((e) => e.idx >= DATA_CHANGE_FROM_IDX && unreviewedDataChange(readFileSync(path.join(DRIZZLE, `${e.tag}.sql`), "utf8"))).map((e) => e.tag);
    expect(bad, 'An UPDATE runs against the live database during the build. Add a "-- reviewed backfill: <why it is safe>" line once it has been checked').toEqual([]);
  });

  it("migrations never change after they are created", () => {
    const recorded = JSON.parse(readFileSync(path.join(DRIZZLE, CHECKSUMS_FILE), "utf8")) as Record<string, string>;
    const missing = journal.entries.filter((e) => !recorded[e.tag]).map((e) => e.tag);
    expect(missing, "Record the new migration's checksum: pnpm db:checksums (pnpm db:generate does it for you)").toEqual([]);
    const changed = journal.entries.filter((e) => recorded[e.tag] !== migrationChecksum(readFileSync(path.join(DRIZZLE, `${e.tag}.sql`), "utf8"))).map((e) => e.tag);
    expect(
      changed,
      `Production may already have run these, so edits would never reach it. Undo the edit and add a new migration. (Only if it was never deployed: delete its line from drizzle/${CHECKSUMS_FILE} and run pnpm db:checksums.)`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule: src/server/schedule.ts is the only writer of schedule_entries, so every
// booking change keeps project dates and status in step and reaches the sync hook.
// ---------------------------------------------------------------------------

const SCHEDULE_WRITER = "src/server/schedule.ts";
const RAW_SCHEDULE_WRITE = /\b(?:insert\s+into|update|delete\s+from)\s+"?schedule_entries"?(?=[\s"(]|$)/i;

const isScheduleTable = (e: ts.Expression | undefined) =>
  !!e && ((ts.isIdentifier(e) && e.text === "scheduleEntries") || (ts.isPropertyAccessExpression(e) && e.name.text === "scheduleEntries"));

function scheduleWriteViolations(s: Source): string[] {
  const sf = ast(s);
  const out = new Set<string>();
  visit(sf, (n) => {
    for (const op of ["insert", "update", "delete"]) {
      const call = methodCall(n, op);
      if (call && isScheduleTable(call.arguments[0])) out.add(`${at(sf, n)} ${op}(scheduleEntries)`);
    }
    const text = literalText(n);
    if (text && RAW_SCHEDULE_WRITE.test(text)) out.add(`${at(sf, n)} writes schedule_entries in SQL`);
  });
  return [...out];
}

describe("schedule_entries has a single writer", () => {
  it("detects schedule writes (self-test)", () => {
    const check = (text: string) => scheduleWriteViolations({ file: "x.ts", text });
    for (const bad of [
      `db.insert(scheduleEntries).values(v)`,
      `tx.update(schema.scheduleEntries).set({ startDate })`,
      `await tx.delete(scheduleEntries).where(eq(scheduleEntries.id, id))`,
      "db.execute(sql`update schedule_entries set deleted_at = now()`)",
      "db.execute(sql`DELETE FROM \"schedule_entries\" WHERE id = ${id}`)",
      `const q = "insert into schedule_entries (project_id) values ($1)"`,
    ])
      expect(check(bad), bad).not.toEqual([]);
    for (const ok of [
      `db.select().from(scheduleEntries)`,
      `db.insert(projectScheduling).values(v)`,
      `await createEntry(input, user)`,
      "db.execute(sql`select * from schedule_entries where deleted_at is null`)",
    ])
      expect(check(ok), ok).toEqual([]);
  });

  it("only schedule.ts inserts, updates or deletes schedule_entries", () => {
    expect(SOURCES.some((s) => s.file === SCHEDULE_WRITER)).toBe(true);
    const violations = SOURCES.filter((s) => s.file !== SCHEDULE_WRITER).flatMap(scheduleWriteViolations);
    expect(violations, "Change bookings through createEntry / updateEntry / deleteEntry / splitEntry in src/server/schedule.ts").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule (CLAUDE.md rule 2, spec-schedule §6, spec-work-orders §4): crew-facing
// projections never name money or hour fields, so nothing can leak by accident.
// Since Oct 2026 the owner wants crews to see estimated labour hours on work
// orders: those come only from the signed estimate's lines through
// src/lib/estimating/crew-quantities.ts, never from these project or booking columns.
// ---------------------------------------------------------------------------

const CREW_FACING = [
  "src/server/my-jobs.ts",
  "src/server/work-order-view.ts",
  // The whole work-order service, token path included: it never names a money or hours column.
  "src/server/work-orders.ts",
  "src/app/(app)/my-jobs/",
  "src/components/work-order/",
  "src/app/share/wo/",
  "src/app/(preview)/projects/[id]/work-orders/",
  // Crews read job chat and fill in colour forms too.
  "src/server/job-chat.ts",
  "src/server/colour-selections.ts",
];
const MONEY_OR_HOURS = [
  "contractPrice", "contractTotal", "depositRequired", "estimatedCost", "estimatedHours", "plannedHours",
  "totalPrice", "totalCost", "totalHours", "totalWithTax", "laborCostPerHour", "billingRatePerHour", "pricePerGallon",
  "contract_price", "contract_total", "deposit_required", "estimated_cost", "estimated_hours", "planned_hours",
];
const MONEY_OR_HOURS_RE = new RegExp(`\\b(${MONEY_OR_HOURS.join("|")})\\b`, "g");

const inPaths = (file: string, paths: string[]) => paths.some((p) => (p.endsWith("/") ? file.startsWith(p) : file === p));

describe("crew-facing code never names money or hours", () => {
  it("detects forbidden identifiers (self-test)", () => {
    expect("select { contractPrice: projects.contractPrice }".match(MONEY_OR_HOURS_RE)).not.toBeNull();
    expect("row.planned_hours".match(MONEY_OR_HOURS_RE)).not.toBeNull();
    expect("crewNotes, workingDays, quantity".match(MONEY_OR_HOURS_RE)).toBeNull();
  });

  it("my-jobs and work-order code has none", () => {
    const files = SOURCES.filter((s) => inPaths(s.file, CREW_FACING));
    expect(files.map((f) => f.file)).toEqual(expect.arrayContaining(["src/server/my-jobs.ts", "src/server/work-order-view.ts", "src/server/work-orders.ts", "src/app/share/wo/[token]/page.tsx"]));
    const found = files.flatMap((f) => [...new Set(f.text.match(MONEY_OR_HOURS_RE) ?? [])].map((id) => `${f.file}: ${id}`));
    expect(found, "Crew views are built from whitelisted fields only (no money, no hours)").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule (spec-schedule §1.13): booking days are calendar days stored as `date`.
// formatDate() treats "2026-10-26" as UTC midnight, which is Oct 25 in Vancouver;
// schedule code formats days with formatIsoDate (src/lib/calendar-date.ts).
// ---------------------------------------------------------------------------

const SCHEDULE_UI = [
  "src/app/(app)/schedule/",
  "src/components/schedule/",
  "src/app/(app)/my-jobs/",
  "src/components/work-order/",
  "src/app/(app)/projects/[id]/schedule-card.tsx",
  "src/lib/schedule/",
  "src/server/schedule.ts",
  "src/server/my-jobs.ts",
  "src/server/start-notices.ts",
  "src/server/work-orders.ts",
  "src/app/share/wo/",
  "src/app/(preview)/projects/[id]/work-orders/",
];
const DAY_FIELD_FORMAT = /\bformatDate\(\s*[\w.?!\[\]"']*\b(startDate|endDate|notBefore|communicatedStart|communicatedEnd|dueDate|weekOf|firstWorkDay|lastWorkDay)\b/;

describe("calendar days are formatted as calendar days", () => {
  it("detects formatDate on a booking day (self-test)", () => {
    expect(DAY_FIELD_FORMAT.test("{formatDate(e.startDate)}")).toBe(true);
    expect(DAY_FIELD_FORMAT.test("formatDate(entry?.endDate, { dateStyle: 'long' })")).toBe(true);
    expect(DAY_FIELD_FORMAT.test("formatIsoDate(e.startDate)")).toBe(false);
    expect(DAY_FIELD_FORMAT.test("formatDate(p.soldAt)")).toBe(false);
  });

  it("schedule code never passes a date column to formatDate", () => {
    const bad = SOURCES.filter((s) => inPaths(s.file, SCHEDULE_UI) && DAY_FIELD_FORMAT.test(s.text)).map((s) => s.file);
    expect(bad, "Use formatIsoDate / shortDay / longDay for `date` columns").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule (CLAUDE.md rule 10): Vancouver times go through businessZone(). BC stays on
// UTC−7 from 2026-11-01 and older zone data doesn't know, so a bare
// "America/Vancouver" handed to Intl shows times an hour early on those runtimes.
// ---------------------------------------------------------------------------

const ZONE_HELPERS = ["src/lib/time.ts"];
const RAW_BUSINESS_ZONE = /timeZone\s*:\s*(?:"America\/Vancouver"|'America\/Vancouver'|BUSINESS_TZ\b)|\bat time zone 'America\/Vancouver'/;

describe("Vancouver times go through businessZone()", () => {
  it("detects a raw zone (self-test)", () => {
    expect(RAW_BUSINESS_ZONE.test(`new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver" })`)).toBe(true);
    expect(RAW_BUSINESS_ZONE.test(`toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ })`)).toBe(true);
    expect(RAW_BUSINESS_ZONE.test(`{ timeZone: businessZone(at), month: "short" }`)).toBe(false);
    expect(RAW_BUSINESS_ZONE.test(`{ timeZone: "UTC" }`)).toBe(false);
  });

  it("no code hands America/Vancouver to Intl directly", () => {
    const bad = SOURCES.filter((s) => !s.file.endsWith(".test.ts") && !inPaths(s.file, ZONE_HELPERS) && RAW_BUSINESS_ZONE.test(s.text)).map((s) => s.file);
    expect(bad, "Use formatDate / businessDate / businessZone(instant) from src/lib").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule (CLAUDE.md rule 8): customer email is human-initiated. Only known modules
// send email, and start notices are sent only from server actions (a click after
// a preview), never from the schedule service, its hooks or any automation.
// ---------------------------------------------------------------------------

const EMAIL_SENDERS = ["src/lib/email.ts", "src/lib/auth.ts", "src/server/leads.ts", "src/server/proposals.ts", "src/server/start-notices.ts", "src/server/colour-selections.ts"];

function callsOf(s: Source, name: string): string[] {
  const sf = ast(s);
  const out: string[] = [];
  visit(sf, (n) => {
    if (ts.isCallExpression(n) && ((ts.isIdentifier(n.expression) && n.expression.text === name) || (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === name)))
      out.push(at(sf, n));
  });
  return out;
}

describe("customer email is human-initiated", () => {
  it("finds calls (self-test)", () => {
    expect(callsOf({ file: "x.ts", text: "await sendEmail({ to })" }, "sendEmail")).toHaveLength(1);
    expect(callsOf({ file: "x.ts", text: "await mail.sendStartNotice(input, user)" }, "sendStartNotice")).toHaveLength(1);
    expect(callsOf({ file: "x.ts", text: "import { sendEmail } from '@/lib/email'" }, "sendEmail")).toHaveLength(0);
  });

  it("only known modules call sendEmail", () => {
    const bad = SOURCES.filter((s) => !EMAIL_SENDERS.includes(s.file)).flatMap((s) => callsOf(s, "sendEmail"));
    expect(bad, "Customer email goes through a human-initiated, previewed send (CLAUDE.md rule 8)").toEqual([]);
  });

  it("start notices are sent only from server actions", () => {
    const bad = SOURCES.filter((s) => s.file !== "src/server/start-notices.ts" && !(s.file.startsWith("src/app/") && /\/actions\.ts$/.test(s.file)))
      .flatMap((s) => callsOf(s, "sendStartNotice"));
    expect(bad).toEqual([]);
    const hooks = SOURCES.filter((s) => s.file === "src/server/schedule.ts" || s.file === "src/server/schedule-hooks.ts");
    expect(hooks).toHaveLength(2);
    for (const h of hooks) expect(h.text, h.file).not.toMatch(/start-notices|@\/lib\/email/);
  });
});

// ---------------------------------------------------------------------------
// Rule (spec-work-orders §4): share-link tokens are handled in one place. Only
// src/server/work-orders.ts touches work_order_links (hashes, expiry, opens), and
// crew-facing work-order pages get their data from it, never from the database,
// the estimate or the proposal directly.
// ---------------------------------------------------------------------------

const WORK_ORDER_SERVICE = "src/server/work-orders.ts";
const WORK_ORDER_SCHEMA = "src/db/schema/work-orders.ts";
// The colour form has its own customer links (colour_selections.token_hash), handled only by its service.
const COLOUR_LINK_FILES = ["src/server/colour-selections.ts", "src/db/schema/colours.ts"];
const LINK_TABLE_RE = /\b(workOrderLinks|work_order_links|tokenHash|token_hash)\b/;
const WORK_ORDER_PAGES = ["src/app/share/wo/", "src/components/work-order/", "src/app/(app)/my-jobs/work-orders/", "src/app/(preview)/projects/[id]/work-orders/"];
const DIRECT_DATA_IMPORT = /from\s+["'](@\/db(?:\/[^"']*)?|@\/server\/(?:estimates|proposals|proposal-view|schedule|my-jobs))["']/;

function directDataImports(s: Source): string[] {
  return s.text
    .split("\n")
    .filter((line) => DIRECT_DATA_IMPORT.test(line) && !/^\s*import\s+type\b/.test(line))
    .map((line) => `${s.file}: ${line.trim()}`);
}

describe("work-order links and pages go through the work-order service", () => {
  it("detects link-table use and direct data imports (self-test)", () => {
    expect(LINK_TABLE_RE.test("db.select().from(workOrderLinks)")).toBe(true);
    expect(LINK_TABLE_RE.test("select token_hash from work_order_links")).toBe(true);
    expect(LINK_TABLE_RE.test("const links = await listWorkOrders(id)")).toBe(false);
    const check = (text: string) => directDataImports({ file: "x.tsx", text });
    expect(check(`import { db } from "@/db";`)).toHaveLength(1);
    expect(check(`import { workOrders } from "@/db/schema";`)).toHaveLength(1);
    expect(check(`import { loadEstimate } from "@/server/estimates";`)).toHaveLength(1);
    expect(check(`import type { WorkOrderStatus } from "@/db/schema/work-orders";`)).toHaveLength(0);
    expect(check(`import { getWorkOrderForToken } from "@/server/work-orders";`)).toHaveLength(0);
  });

  it("only work-orders.ts reads or writes share links", () => {
    expect(SOURCES.some((s) => s.file === WORK_ORDER_SERVICE)).toBe(true);
    const bad = SOURCES.filter((s) => s.file !== WORK_ORDER_SERVICE && s.file !== WORK_ORDER_SCHEMA && !COLOUR_LINK_FILES.includes(s.file) && !s.file.startsWith("src/db/schema/index") && LINK_TABLE_RE.test(s.text)).map((s) => s.file);
    // …and nothing but the colour service touches colour-form link hashes.
    const colourBad = SOURCES.filter((s) => COLOUR_LINK_FILES.every((f) => f !== s.file) && /\bcolourSelections\.tokenHash\b/.test(s.text)).map((s) => s.file);
    expect(colourBad).toEqual([]);
    expect(bad, "Share-link tokens and counters are handled only by src/server/work-orders.ts").toEqual([]);
  });

  it("crew-facing work-order pages load data only through work-orders.ts", () => {
    const files = SOURCES.filter((s) => inPaths(s.file, WORK_ORDER_PAGES));
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.flatMap(directDataImports), "Use getWorkOrderForToken / getWorkOrderForCrewMember / getWorkOrderForStaff").toEqual([]);
  });
});
