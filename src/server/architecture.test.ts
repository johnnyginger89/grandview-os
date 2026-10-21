/**
 * Architecture rules checked against the source tree. Later batches append rules here.
 * Each rule has a small self-test so a broken detector can't pass silently.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

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
  "src/server/dashboard.ts",
  "src/server/goals.ts",
  "src/server/pipeline-list.ts",
  "src/server/project-status.ts",
  "src/lib/reporting/",
  "src/components/reporting/",
  "src/app/(app)/performance/",
  "src/app/(app)/month-snapshot.tsx",
  "src/app/(app)/page.tsx",
  "src/app/(app)/leads/",
  "src/app/(app)/projects/",
  "src/app/(app)/settings/",
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

function destructiveStatements(sql: string): string[] {
  const body = stripSqlComments(sql);
  const found = DESTRUCTIVE.filter(([re]) => re.test(body)).map(([, what]) => what);
  // A NOT NULL column without a default can't be added to a table that has rows.
  for (const m of body.matchAll(/\badd\s+column\s+("?[\w]+"?)([^;]*)/gi))
    if (/\bnot\s+null\b/i.test(m[2]) && !/\bdefault\b/i.test(m[2]) && !/\bgenerated\b/i.test(m[2])) found.push(`ADD COLUMN ${m[1]} NOT NULL without DEFAULT`);
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
  });

  it(`migrations from ${String(ADDITIVE_FROM_IDX).padStart(4, "0")} on are additive only`, () => {
    const bad = journal.entries
      .filter((e) => e.idx >= ADDITIVE_FROM_IDX)
      .flatMap((e) => destructiveStatements(readFileSync(path.join(DRIZZLE, `${e.tag}.sql`), "utf8")).map((what) => `${e.tag}: ${what}`));
    expect(bad, "Migrations run before the new code is live: add tables, nullable or defaulted columns and indexes only").toEqual([]);
  });
});
