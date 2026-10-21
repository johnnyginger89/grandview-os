/**
 * Idempotent seed. Safe to run repeatedly.
 *
 *   pnpm db:seed              baseline config (stages, factors, rates, materials, templates)
 *   pnpm db:seed --dev-users  also creates one development login per role
 *
 * --dev-users is refused unless DATABASE_URL points at localhost.
 */
import "dotenv/config";
import { and, eq, isNull } from "drizzle-orm";
import { isLocalDatabase } from "./connection";
import { db } from "./index";
import * as s from "./schema";
import {
  DEFAULT_COMPANY,
  DEFAULT_PRICING,
  DEFAULT_PROPOSAL,
  DEFAULT_PROPOSAL_TEMPLATE,
  FACTORS,
  LEAD_SOURCES,
  LOST_REASONS,
  MATERIALS,
  MESSAGE_TEMPLATES,
  PIPELINE_STAGES,
  PROJECT_TYPES,
  RATES,
} from "./seed-data";
import { SCHEDULE_MESSAGE_TEMPLATES } from "./seed-schedule";
import { ROLES } from "./schema/auth";

async function seedSettings() {
  const entries: [string, unknown][] = [
    ["pricing", DEFAULT_PRICING],
    ["company", DEFAULT_COMPANY],
    ["proposal", DEFAULT_PROPOSAL],
    ["lead_sources", LEAD_SOURCES],
    ["lost_reasons", LOST_REASONS],
    ["project_types", PROJECT_TYPES],
  ];
  for (const [key, value] of entries) {
    await db.insert(s.appSettings).values({ key, value }).onConflictDoNothing();
  }
  await seedProposalTemplate();
}

/**
 * Inserted once; an owner's edits are never overwritten. On that first insert the
 * old `proposal` setting's "show area prices" choice is carried over.
 */
async function seedProposalTemplate() {
  const existing = await db.query.appSettings.findFirst({ where: eq(s.appSettings.key, "proposal_template"), columns: { key: true } });
  if (existing) return;
  const legacy = await db.query.appSettings.findFirst({ where: eq(s.appSettings.key, "proposal") });
  const showAreaPrices = (legacy?.value as { showAreaPrices?: unknown } | undefined)?.showAreaPrices === true;
  const value = { ...DEFAULT_PROPOSAL_TEMPLATE, estimateDocument: { ...DEFAULT_PROPOSAL_TEMPLATE.estimateDocument, showAreaPrices } };
  await db.insert(s.appSettings).values({ key: "proposal_template", value }).onConflictDoNothing();
}

async function seedStages() {
  for (const [i, st] of PIPELINE_STAGES.entries()) {
    await db
      .insert(s.pipelineStages)
      .values({ ...st, position: i })
      .onConflictDoNothing({ target: s.pipelineStages.key });
  }
}

async function seedFactors() {
  const existing = await db.select().from(s.factorOptions).limit(1);
  if (existing.length) return;
  await db.insert(s.factorOptions).values(FACTORS.map((f, i) => ({ ...f, position: i, isDefault: !!f.isDefault })));
}

async function seedMaterialsAndRates() {
  const ids = new Map<string, string>();
  for (const m of MATERIALS) {
    const { key, ...values } = m;
    const found = await db.query.materials.findFirst({ where: (t, { and, eq }) => and(eq(t.manufacturer, m.manufacturer), eq(t.name, m.name)) });
    if (found) {
      ids.set(key, found.id);
      continue;
    }
    const [row] = await db.insert(s.materials).values({ ...values, notes: "Starter price – confirm with supplier" }).returning();
    await db.insert(s.materialPriceHistory).values({ materialId: row.id, pricePerGallon: row.pricePerGallon });
    ids.set(key, row.id);
  }

  for (const [i, r] of RATES.entries()) {
    const found = await db.query.productionRates.findFirst({ where: (t, { eq }) => eq(t.code, r.code) });
    if (found) {
      // Fill proposal groups added after the rate was seeded; never overwrite the owner's.
      if (r.proposalGroup && !found.proposalGroup) {
        await db
          .update(s.productionRates)
          .set({ proposalGroup: r.proposalGroup })
          .where(and(eq(s.productionRates.code, r.code), isNull(s.productionRates.proposalGroup)));
      }
      continue;
    }
    const [rate] = await db
      .insert(s.productionRates)
      .values({
        code: r.code,
        name: r.name,
        category: r.category,
        unit: r.unit,
        basis: r.basis ?? "units_per_hour",
        dimensionSource: r.dimensionSource ?? "manual",
        proposalGroup: r.proposalGroup ?? null,
        position: i,
      })
      .returning();
    const [version] = await db
      .insert(s.productionRateVersions)
      .values({
        rateId: rate.id,
        version: 1,
        productionRate: r.productionRate,
        additionalCoatFactor: r.additionalCoatFactor ?? "1",
        defaultCoats: r.defaultCoats,
        materialId: r.material ? ids.get(r.material) : null,
        materialWastePct: r.material ? "0.10" : "0",
        otherCostPerUnit: r.otherCostPerUnit ?? "0",
        changeNote: "Starter value",
      })
      .returning();
    await db.update(s.productionRates).set({ currentVersionId: version.id }).where(eq(s.productionRates.id, rate.id));
  }
}

async function seedTemplates() {
  for (const t of [...MESSAGE_TEMPLATES, ...SCHEDULE_MESSAGE_TEMPLATES]) {
    await db.insert(s.messageTemplates).values(t).onConflictDoNothing({ target: s.messageTemplates.key });
  }
}

export const DEV_PASSWORD = "grandview-dev-only-1";

async function seedDevUsers() {
  const { auth } = await import("@/lib/auth");
  const ctx = await auth.$context;
  for (const role of ROLES) {
    const email = `${role.replace(/_/g, "-")}@dev.grandview.local`;
    const existing = await db.query.user.findFirst({ where: (t, { eq }) => eq(t.email, email) });
    if (existing) continue;
    const name = role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) + " (Dev)";
    const u = await ctx.internalAdapter.createUser({ email, name, emailVerified: true, role }, { method: "admin" });
    await ctx.internalAdapter.linkAccount({
      userId: u.id,
      providerId: "credential",
      accountId: u.id,
      password: await ctx.password.hash(DEV_PASSWORD),
    });
    console.log(`  dev user ${email}`);
  }
  console.log(`  dev password: ${DEV_PASSWORD}`);
}

/** Baseline configuration only (no users). Used by `pnpm db:seed` and every production deploy. */
export async function seedBaseline() {
  await seedSettings();
  await seedStages();
  await seedFactors();
  await seedMaterialsAndRates();
  await seedTemplates();
}

export function assertDevUsersAllowed(env: NodeJS.ProcessEnv = process.env) {
  const url = env.DATABASE_URL ?? "";
  if (env.NODE_ENV === "production" || env.VERCEL || !isLocalDatabase(url)) {
    throw new Error("Refusing to create dev users: they are only allowed on a local database (localhost).");
  }
}

async function main() {
  if (process.argv.includes("--dev-users")) assertDevUsersAllowed();
  await seedBaseline();
  if (process.argv.includes("--dev-users")) await seedDevUsers();
  console.log("Seed complete");
  process.exit(0);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/db/seed.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
