"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { safeErrorMessage } from "@/lib/action-error";
import { setPasswordWithCode } from "@/server/password-by-code";

const schema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app."),
  newPassword: z.string().min(12, "The new password needs at least 12 characters.").max(128),
});

export async function setPasswordWithCodeAction(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const data = schema.parse(input);
    await setPasswordWithCode(data, await headers());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: safeErrorMessage(e) };
  }
}
