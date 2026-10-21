import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, media } from "@/db/schema";
import { DEFAULT_COMPANY, DEFAULT_PRICING, DEFAULT_PROPOSAL, DEFAULT_PROPOSAL_TEMPLATE } from "@/db/seed-data";
import { DEFAULT_ESTIMATING_PRESETS, ESTIMATING_PRESETS_KEY, estimatingPresetsSchema, type EstimatingPresets } from "@/lib/estimating/presets";
import { markRemovedOverrides, mergeWithDefaults } from "@/lib/proposal-template/merge";
import {
  mediaRefs,
  PROPOSAL_TEMPLATE_KEY,
  sectionSchemas,
  tokenProblems,
  type ProposalTemplate,
  type SectionKey,
} from "@/lib/proposal-template/schema";
import { audit } from "./audit";

export type PricingSettings = typeof DEFAULT_PRICING;
export type CompanySettings = typeof DEFAULT_COMPANY;
export type ProposalSettings = typeof DEFAULT_PROPOSAL;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, key) });
  if (!row) return fallback;
  if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
    return { ...fallback, ...(row.value as object) } as T;
  }
  return row.value as T;
}

export async function setSetting(key: string, value: unknown, userId: string) {
  await db
    .insert(appSettings)
    .values({ key, value, updatedBy: userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: userId, updatedAt: new Date() } });
}

export const getPricing = () => getSetting<PricingSettings>("pricing", DEFAULT_PRICING);
export const getCompany = () => getSetting<CompanySettings>("company", DEFAULT_COMPANY);
export const getList = (key: "lead_sources" | "lost_reasons" | "project_types") => getSetting<string[]>(key, []);
/** Legacy proposal wording (before the presentation template). Kept read-only for the "earlier wording" panel. */
export const getProposalSettings = () => getSetting<ProposalSettings>("proposal", DEFAULT_PROPOSAL);

/** Room presets, favourite colours and sheens for the estimate editor; starter values until the owner saves their own. */
export async function getEstimatingPresets(): Promise<EstimatingPresets> {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, ESTIMATING_PRESETS_KEY) });
  const parsed = estimatingPresetsSchema.safeParse(row?.value);
  if (row && !parsed.success) console.error("[estimating_presets] invalid, using the starter presets");
  return parsed.success ? parsed.data : DEFAULT_ESTIMATING_PRESETS;
}

export async function saveEstimatingPresets(raw: unknown, userId: string): Promise<void> {
  const value = estimatingPresetsSchema.parse(raw);
  await setSetting(ESTIMATING_PRESETS_KEY, value, userId);
  await audit({ actorId: userId, action: "settings.update", entityType: "settings", entityId: ESTIMATING_PRESETS_KEY, after: { rooms: value.rooms.length, favouriteColours: value.favouriteColours.length } });
}

export class SettingsError extends Error {
  readonly expose = true;
}

/** The proposal template merged over the defaults, plus the row version for optimistic saves. */
export async function getProposalTemplateState(): Promise<{ template: ProposalTemplate; updatedAt: string | null; invalidSections: SectionKey[] }> {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, PROPOSAL_TEMPLATE_KEY) });
  const { template, invalidSections } = mergeWithDefaults(row?.value ?? DEFAULT_PROPOSAL_TEMPLATE, DEFAULT_PROPOSAL_TEMPLATE);
  for (const k of invalidSections) console.error(`[proposal_template] section ${k} invalid, using defaults`);
  return { template, updatedAt: row?.updatedAt.toISOString() ?? null, invalidSections };
}

export async function getProposalTemplate(): Promise<ProposalTemplate> {
  return (await getProposalTemplateState()).template;
}

/**
 * Validate and save one section of the proposal template. `expectedUpdatedAt` is the
 * version the editor loaded; a different stored version means someone else saved first.
 */
export async function saveProposalTemplateSection(section: SectionKey, value: unknown, userId: string, expectedUpdatedAt: string | null) {
  const schema = sectionSchemas[section];
  if (!schema) throw new SettingsError("Unknown proposal settings section.");
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, PROPOSAL_TEMPLATE_KEY) });
  const currentVersion = row?.updatedAt.toISOString() ?? null;
  if (currentVersion !== expectedUpdatedAt) throw new SettingsError("Someone else saved proposal settings. Reload to see their changes.");

  const parsed = schema.parse(value);
  const problems = tokenProblems(parsed, section);
  if (problems.length) throw new SettingsError(problems[0]);

  const ids = mediaRefs(parsed);
  if (ids.length) {
    const found = await db
      .select({ id: media.id })
      .from(media)
      .where(and(inArray(media.id, ids), eq(media.status, "ready"), eq(media.kind, "image")));
    if (found.length !== ids.length) throw new SettingsError("One of the pictures is no longer available. Please choose it again.");
  }

  const { template: current } = mergeWithDefaults(row?.value ?? DEFAULT_PROPOSAL_TEMPLATE, DEFAULT_PROPOSAL_TEMPLATE);
  const defaultJobTypes = DEFAULT_PROPOSAL_TEMPLATE.jobTypes as Record<string, unknown>;
  // Job types are always written with explicit nulls for removed overrides (see markRemovedOverrides).
  const next = {
    ...current,
    version: 1,
    jobTypes: markRemovedOverrides(current.jobTypes as Record<string, unknown>, defaultJobTypes),
    [section]: section === "jobTypes" ? markRemovedOverrides(parsed as Record<string, unknown>, defaultJobTypes) : parsed,
  };
  const now = new Date();

  await db.transaction(async (tx) => {
    if (row) {
      const updated = await tx
        .update(appSettings)
        .set({ value: next, updatedBy: userId, updatedAt: now })
        .where(and(eq(appSettings.key, PROPOSAL_TEMPLATE_KEY), sql`date_trunc('milliseconds', ${appSettings.updatedAt}) = ${currentVersion}::timestamptz`))
        .returning({ key: appSettings.key });
      if (!updated.length) throw new SettingsError("Someone else saved proposal settings. Reload to see their changes.");
    } else {
      const inserted = await tx
        .insert(appSettings)
        .values({ key: PROPOSAL_TEMPLATE_KEY, value: next, updatedBy: userId, updatedAt: now })
        .onConflictDoNothing()
        .returning({ key: appSettings.key });
      if (!inserted.length) throw new SettingsError("Someone else saved proposal settings. Reload to see their changes.");
    }
    await audit(
      { actorId: userId, action: `settings.proposal_template.${section}`, entityType: "settings", entityId: PROPOSAL_TEMPLATE_KEY, before: current[section], after: parsed },
      tx,
    );
  });
  return { updatedAt: now.toISOString() };
}
