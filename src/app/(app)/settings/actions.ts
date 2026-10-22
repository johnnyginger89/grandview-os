"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { safeErrorMessage } from "@/lib/action-error";
import { db } from "@/db";
import { messageTemplates } from "@/db/schema";
import { assertPermission } from "@/lib/authz/guard";
import { audit } from "@/server/audit";
import { requestMeta } from "@/server/request-meta";
import { getCompany, getPricing, setSetting } from "@/server/settings";
import { createUserAccount, resetTwoFactor, setTemporaryPassword, updateUserAccess } from "@/server/users";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const err = (e: unknown) => ({ ok: false as const, error: safeErrorMessage(e) });
const dec = z.string().trim().regex(/^\d+(\.\d+)?$/, "Enter a number");

export async function saveCompanyAction(_: unknown, f: FormData): Promise<Result> {
  try {
    const user = await assertPermission("settings.manage");
    const https = (msg: string) => z.string().trim().max(300).refine((u) => u === "" || /^https:\/\/[^\s]+$/i.test(u), msg);
    const keys = ["name", "displayName", "tagline", "email", "phone", "phone2", "phone2Label", "address", "gstNumber", "licenceLabel", "licenceNumber", "website", "bookingUrl"];
    const v = z.object({
      name: z.string().trim().min(1, "Company name is required").max(200),
      displayName: z.string().trim().max(80),
      tagline: z.string().trim().max(120),
      email: z.string().trim().email().or(z.literal("")),
      phone: z.string().trim().max(40),
      phone2: z.string().trim().max(40),
      phone2Label: z.string().trim().max(30),
      address: z.string().trim().max(300).transform((a) => a.replace(/\r\n?/g, "\n")),
      gstNumber: z.string().trim().max(40),
      licenceLabel: z.string().trim().max(30),
      licenceNumber: z.string().trim().max(40),
      website: https("Website must be a full address starting with https://"),
      bookingUrl: https("Booking link must be a full URL starting with https://"),
    }).parse(Object.fromEntries(keys.map((k) => [k, String(f.get(k) ?? "")])));
    const before = await getCompany();
    const after = { ...before, ...v };
    await setSetting("company", after, user.id);
    await audit({ actorId: user.id, action: "settings.company", entityType: "settings", entityId: "company", before, after });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

export async function savePricingAction(_: unknown, f: FormData): Promise<Result> {
  try {
    const user = await assertPermission("settings.manage");
    const pct = (k: string) => String(Number(dec.parse(String(f.get(k)))) / 100);
    const v = {
      pricingMethod: z.enum(["billing_rate", "target_margin"]).parse(f.get("pricingMethod")),
      laborCostPerHour: dec.parse(String(f.get("laborCostPerHour"))),
      billingRatePerHour: dec.parse(String(f.get("billingRatePerHour"))),
      targetMargin: pct("targetMargin"),
      materialMarkupPct: pct("materialMarkupPct"),
      minimumJobPrice: dec.parse(String(f.get("minimumJobPrice"))),
      gstRate: pct("gstRate"),
      depositPct: pct("depositPct"),
      estimateValidDays: z.coerce.number().int().min(1).max(365).parse(f.get("estimateValidDays")),
      hoursPerCrewDay: dec.parse(String(f.get("hoursPerCrewDay"))),
    };
    if (Number(v.targetMargin) >= 0.95) throw new Error("Target margin must be below 95%");
    const before = await getPricing();
    await setSetting("pricing", v, user.id);
    await audit({ actorId: user.id, action: "settings.pricing", entityType: "settings", entityId: "pricing", before, after: v });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

export async function saveListAction(key: "lead_sources" | "lost_reasons" | "project_types", text: string): Promise<Result> {
  try {
    const user = await assertPermission("settings.manage");
    // Server actions can be called directly, so the key is checked at runtime too.
    const k = z.enum(["lead_sources", "lost_reasons", "project_types"]).parse(key);
    const items = [...new Set(z.string().max(20_000).parse(text).split("\n").map((s) => s.trim().slice(0, 100)).filter(Boolean))].slice(0, 100);
    await setSetting(k, items, user.id);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

export async function saveTemplateAction(id: string, subject: string, body: string): Promise<Result> {
  try {
    const user = await assertPermission("settings.manage");
    await db.update(messageTemplates).set({ subject: z.string().max(300).parse(subject), body: z.string().min(1).max(10000).parse(body), updatedAt: new Date() }).where(eq(messageTemplates.id, z.string().uuid().parse(id)));
    await audit({ actorId: user.id, action: "settings.template", entityType: "message_template", entityId: id });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

export async function createUserAction(_: unknown, f: FormData): Promise<Result<{ tempPassword?: string; email?: string }>> {
  try {
    const me = await assertPermission("users.manage");
    const input = { name: String(f.get("name")), email: String(f.get("email")), role: String(f.get("role")) as "painter", phone: String(f.get("phone") ?? "") };
    const r = await createUserAccount(input, me.id, me.role, requestMeta(await headers()));
    revalidatePath("/settings");
    return { ok: true, tempPassword: r.tempPassword, email: input.email };
  } catch (e) {
    return err(e);
  }
}

export async function updateUserAction(userId: string, patch: { role?: string; active?: boolean }): Promise<Result> {
  try {
    const me = await assertPermission("users.manage");
    const v = z.object({ role: z.string().max(40).optional(), active: z.boolean().optional() }).strict().parse(patch);
    await updateUserAccess(z.string().min(1).max(100).parse(userId), v, me.id, me.role, requestMeta(await headers()));
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

const userId = z.string().min(1).max(100);

/** The owner gives someone a temporary password (shown once); they choose their own at their next sign-in. */
export async function setTemporaryPasswordAction(id: unknown): Promise<Result<{ name: string; email: string; tempPassword: string }>> {
  try {
    const me = await assertPermission("users.manage");
    const r = await setTemporaryPassword(userId.parse(id), me, requestMeta(await headers()));
    revalidatePath("/settings");
    return { ok: true, ...r };
  } catch (e) {
    return err(e);
  }
}

/** The owner turns off someone's two-step sign-in so they set it up again at their next sign-in. */
export async function resetTwoFactorAction(id: unknown): Promise<Result<{ name: string }>> {
  try {
    const me = await assertPermission("users.manage");
    const r = await resetTwoFactor(userId.parse(id), me, requestMeta(await headers()));
    revalidatePath("/settings");
    return { ok: true, ...r };
  } catch (e) {
    return err(e);
  }
}
