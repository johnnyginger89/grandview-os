import { notFound } from "next/navigation";
import { recoveryConfigured } from "@/server/owner-recovery";
import { AuthShell } from "../login/auth-shell";
import { RecoverForm } from "./recover-form";

export const metadata = { title: "Owner account recovery" };
export const dynamic = "force-dynamic";

/** Only exists while OWNER_RECOVERY_CODE is set in the hosting settings. */
export default function RecoverPage() {
  if (!recoveryConfigured()) notFound();
  return (
    <AuthShell title="Set a new owner password" subtitle="For when you can't get in. Uses the recovery code you put in Vercel.">
      <RecoverForm />
    </AuthShell>
  );
}
