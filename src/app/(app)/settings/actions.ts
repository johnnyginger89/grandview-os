"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { messageTemplates } from "@/db/schema";
import { assertPermission } from "@/lib/authz/guard";
import { audit } from "@/server/audit";
import { getCompany, getPricing, setSetting } from "@/server/settings";
import { createUserAccount, updateUserAccess } from "@/server/users";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const err = (e: unknown) => ({ ok: false as const, error: e instanceof z.ZodError ? `${e.issues[0]?.path.join(".")}: ${e.issues[0]?.message}` : e instanceof Error ? e.message : "Something went wrong" });
const dec = z.string().trim().regex(/^\d+(\.\d+)?$/, "Enter a number");

export async function saveCompanyAction(_: unknown, f: FormData): Promise<Result> {
  try {
    const user = await assertPermission("settings.manage");
    const v = z.object({
      name: z.string().trim().min(1).max(200),
      email: z.string().trim().email().or(z.literal("")),
      phone: z.string().trim().max(40),
      address: z.string().trim().max(300),
      gstNumber: z.string().trim().max(40),
      bookingUrl: z.string().trim().url("Booking link must be a full URL starting with https://").or(z.literal("")),
    }).parse(Object.fromEntries(["name", "email", "phone", "address", "gstNumber", "bookingUrl"].map((k) => [k, String(f.get(k) ?? "")])));
    const before = await getCompany();
    await setSetting("company", v, user.id);
    await audit({ actorId: user.id, action: "settings.company", entityType: "settings", entityId: "company", before, after: v });
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
    const items = [...new Set(text.split("\n").map((s) => s.trim()).filter(Boolean))].slice(0, 100);
    await setSetting(key, items, user.id);
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
    const r = await createUserAccount(input, me.id, me.role);
    revalidatePath("/settings");
    return { ok: true, tempPassword: r.tempPassword, email: input.email };
  } catch (e) {
    return err(e);
  }
}

export async function updateUserAction(userId: string, patch: { role?: string; active?: boolean }): Promise<Result> {
  try {
    const me = await assertPermission("users.manage");
    await updateUserAccess(userId, patch, me.id, me.role);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}
