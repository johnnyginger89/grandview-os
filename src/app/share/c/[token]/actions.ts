"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { safeErrorMessage } from "@/lib/action-error";
import { saveColourFormFromCustomer, signColourFormFromLink } from "@/server/colour-selections";

const tokenSchema = z.string().max(100);

function fail(e: unknown) {
  // Customers get the plain message, without the field name.
  if (e instanceof z.ZodError) return { ok: false as const, error: e.issues[0]?.message ?? "Please check the form." };
  return { ok: false as const, error: safeErrorMessage(e) };
}

export async function saveColoursAction(token: string, input: unknown) {
  try {
    const t = tokenSchema.parse(token);
    await saveColourFormFromCustomer(t, z.unknown().parse(input));
    return { ok: true as const };
  } catch (e) {
    return fail(e);
  }
}

export async function signColoursAction(token: string, input: unknown) {
  try {
    const t = tokenSchema.parse(token);
    const h = await headers();
    const ip = h.get("x-vercel-forwarded-for") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    await signColourFormFromLink(t, z.unknown().parse(input), { ip, userAgent: h.get("user-agent") });
    revalidatePath(`/share/c/${t}`);
    return { ok: true as const, message: "Thank you! Your colours are signed." };
  } catch (e) {
    return fail(e);
  }
}
