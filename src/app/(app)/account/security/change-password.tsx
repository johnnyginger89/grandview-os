"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, FormError, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { setPasswordWithCodeAction } from "./actions";

/**
 * Change your own password; other devices are signed out so an old password stops working everywhere.
 * `required`: signed in with a temporary password, so the rest of the app opens once this is done.
 */
export function ChangePassword({ hasTwoFactor, required = false }: { hasTwoFactor: boolean; required?: boolean }) {
  const router = useRouter();
  const [forgot, setForgot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const currentPassword = String(f.get("current") ?? "");
    const code = String(f.get("code") ?? "");
    const newPassword = String(f.get("new") ?? "");
    setError(null);
    setDone(false);
    if (newPassword.length < 12) return setError("The new password needs at least 12 characters.");
    if (newPassword !== String(f.get("again") ?? "")) return setError("The two new passwords don't match.");
    if (!forgot && newPassword === currentPassword) return setError("Choose a new password, different from your current one.");
    setPending(true);
    if (forgot) {
      const r = await setPasswordWithCodeAction({ code, newPassword });
      setPending(false);
      if (!r.ok) return setError(r.error);
    } else {
      const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
      setPending(false);
      if (error) return setError(error.code === "INVALID_PASSWORD" ? "Your current password is incorrect." : (error.message ?? "The password couldn't be changed. Try again."));
    }
    form.reset();
    setDone(true);
    if (required) router.refresh();
  }

  return (
    <form method="post" onSubmit={submit} className="space-y-3">
      {forgot ? (
        <Field label="6-digit code from your authenticator app" hint="Instead of your current password.">
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" required />
        </Field>
      ) : (
        <Field label="Current password" hint={required ? "The temporary password you were given." : undefined}>
          <Input name="current" type="password" autoComplete="current-password" required />
        </Field>
      )}
      {hasTwoFactor && (
        <button type="button" className="min-h-9 text-sm text-brand hover:underline" onClick={() => { setForgot(!forgot); setError(null); }}>
          {forgot ? "I know my current password" : "Forgot your current password? Use your authenticator code instead"}
        </button>
      )}
      <Field label="New password" hint="At least 12 characters. A short sentence is easy to remember.">
        <Input name="new" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
      </Field>
      <Field label="New password again">
        <Input name="again" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
      </Field>
      <FormError message={error} />
      {done && <p role="status" className="text-sm text-success">Password changed. Your other devices have been signed out; sign in there with the new password.</p>}
      <Button type="submit" disabled={pending}>{pending ? "Changing…" : "Change password"}</Button>
    </form>
  );
}
