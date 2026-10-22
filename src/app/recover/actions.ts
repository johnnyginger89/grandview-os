"use server";
import { redirect } from "next/navigation";
import { safeErrorMessage } from "@/lib/action-error";
import { recoverOwner, recoverySchema } from "@/server/owner-recovery";

export async function recoverAction(_: unknown, f: FormData): Promise<{ ok: false; error: string } | null> {
  try {
    const input = recoverySchema.parse({ code: f.get("code") ?? "", email: f.get("email") ?? "", password: f.get("password") ?? "", confirm: f.get("confirm") ?? "" });
    await recoverOwner(input);
  } catch (e) {
    return { ok: false, error: safeErrorMessage(e) };
  }
  redirect("/login?recovered=1");
}
