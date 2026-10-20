import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { DEFAULT_COMPANY, DEFAULT_PRICING, DEFAULT_PROPOSAL } from "@/db/seed-data";

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
export const getProposalSettings = () => getSetting<ProposalSettings>("proposal", DEFAULT_PROPOSAL);
