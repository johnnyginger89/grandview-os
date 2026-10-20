"use server";
import { redirect } from "next/navigation";
import { safeErrorMessage } from "@/lib/action-error";
import { createFirstOwner } from "@/server/setup";

export async function setupAction(_: unknown, f: FormData): Promise<{ ok: false; error: string } | null> {
  try {
    await createFirstOwner({
      token: String(f.get("token") ?? ""),
      name: String(f.get("name") ?? ""),
      email: String(f.get("email") ?? ""),
      password: String(f.get("password") ?? ""),
      confirm: String(f.get("confirm") ?? ""),
    });
  } catch (e) {
    return { ok: false, error: safeErrorMessage(e) };
  }
  redirect("/login?setup=done");
}
