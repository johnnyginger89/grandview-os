"use client";
import { useState } from "react";
import { Button, Field, FormError, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "../auth-shell";

export default function VerifyPage() {
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const code = String(new FormData(e.currentTarget).get("code")).replace(/\s/g, "");
    const trustDevice = new FormData(e.currentTarget).get("trust") === "on";
    const res = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    if (res.error) {
      setPending(false);
      setError(res.error.status === 429 ? "Too many attempts. Wait a minute and try again." : "That code didn't work. Try again.");
      return;
    }
    window.location.href = "/";
  }

  return (
    <AuthShell
      title="Two-factor verification"
      subtitle={useBackup ? "Enter one of your saved backup codes." : "Enter the 6-digit code from your authenticator app."}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={useBackup ? "Backup code" : "Authentication code"}>
          <Input name="code" inputMode={useBackup ? "text" : "numeric"} autoComplete="one-time-code" required autoFocus />
        </Field>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" name="trust" className="size-4" /> Trust this device for 30 days
        </label>
        <FormError message={error} />
        <Button type="submit" className="w-full" disabled={pending}>Verify</Button>
        <button type="button" className="w-full text-center text-sm text-brand hover:underline" onClick={() => setUseBackup(!useBackup)}>
          {useBackup ? "Use authenticator app instead" : "Use a backup code"}
        </button>
      </form>
    </AuthShell>
  );
}
