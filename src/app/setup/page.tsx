import { notFound } from "next/navigation";
import { ownerExists, setupConfigured } from "@/server/setup";
import { AuthShell } from "../login/auth-shell";
import { SetupForm } from "./setup-form";

export const metadata = { title: "First-time setup" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!setupConfigured() || (await ownerExists())) notFound();
  return (
    <AuthShell title="Create the owner account" subtitle="One-time setup. Enter the setup code from your hosting settings, then choose your login.">
      <SetupForm />
    </AuthShell>
  );
}
