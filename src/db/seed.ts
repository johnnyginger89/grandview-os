/**
 * Idempotent seed. Safe to run repeatedly.
 *
 *   pnpm db:seed              baseline config (stages, factors, rates, materials, templates)
 *   pnpm db:seed --dev-users  also creates one development login per role
 *
 * --dev-users is refused unless DATABASE_URL points at localhost.
 */
import "dotenv/config";
import { and, eq, isNull, sql } from "drizzle-orm";
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
import { planStarterSeed, readSeededStarters, SEEDED_STARTERS_KEY } from "./seed-starters";
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

/**
 * Starter materials and rates go in at most once per database (see seed-starters.ts), so a
 * deploy never brings back one the owner renamed, recoded or deleted.
 */
async function seedMaterialsAndRates() {
  // One transaction, one run at a time: a run that fails halfway must not leave starter rows
  // without the record (the next run would take them for the owner's), and two deploys at once
  // must not both insert the starters.
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('grandview-os:seed-starters'))`);
    const stored = await tx.query.appSettings.findFirst({ where: eq(s.appSettings.key, SEEDED_STARTERS_KEY) });
    const recorded = readSeededStarters(stored?.value);
    if (stored && !recorded) console.warn(`[seed] ${SEEDED_STARTERS_KEY} is unreadable; treating it as not recorded yet`);
    const existingMaterials = await tx.select({ id: s.materials.id, manufacturer: s.materials.manufacturer, name: s.materials.name }).from(s.materials);
    const existingRates = await tx.select({ code: s.productionRates.code, proposalGroup: s.productionRates.proposalGroup }).from(s.productionRates);
    const plan = planStarterSeed({ materials: MATERIALS, rates: RATES }, { materials: existingMaterials, rates: existingRates }, recorded);

    const ids = new Map<string, string>();
    for (const m of MATERIALS) {
      const { key, ...values } = m;
      if (!plan.materials.includes(key)) {
        const found = existingMaterials.find((e) => e.manufacturer === m.manufacturer && e.name === m.name);
        if (found) ids.set(key, found.id);
        continue;
      }
      const [row] = await tx.insert(s.materials).values({ ...values, notes: "Starter price – confirm with supplier" }).returning();
      await tx.insert(s.materialPriceHistory).values({ materialId: row.id, pricePerGallon: row.pricePerGallon });
      ids.set(key, row.id);
    }

    // Fill proposal groups added after the rate was seeded; never overwrite the owner's.
    for (const { code, proposalGroup } of plan.proposalGroups) {
      await tx
        .update(s.productionRates)
        .set({ proposalGroup })
        .where(and(eq(s.productionRates.code, code), isNull(s.productionRates.proposalGroup)));
    }

    for (const [i, r] of RATES.entries()) {
      if (!plan.rates.includes(r.code)) continue;
      // A starter material the owner renamed or deleted can't be linked; the rate goes in without one.
      const materialId = r.material ? (ids.get(r.material) ?? null) : null;
      const [rate] = await tx
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
      const [version] = await tx
        .insert(s.productionRateVersions)
        .values({
          rateId: rate.id,
          version: 1,
          productionRate: r.productionRate,
          additionalCoatFactor: r.additionalCoatFactor ?? "1",
          defaultCoats: r.defaultCoats,
          materialId,
          materialWastePct: materialId ? "0.10" : "0",
          otherCostPerUnit: r.otherCostPerUnit ?? "0",
          changeNote: "Starter value",
        })
        .returning();
      await tx.update(s.productionRates).set({ currentVersionId: version.id }).where(eq(s.productionRates.id, rate.id));
    }

    if (plan.recordChanged) {
      await tx
        .insert(s.appSettings)
        .values({ key: SEEDED_STARTERS_KEY, value: plan.seeded })
        .onConflictDoUpdate({ target: s.appSettings.key, set: { value: plan.seeded, updatedAt: new Date() } });
    }
    if (plan.materials.length || plan.rates.length) {
      console.log(`  starter materials added: ${plan.materials.length}, starter rates added: ${plan.rates.length}`);
    }
  });
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
