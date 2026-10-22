"use client";
import { useState } from "react";
import { Button, Field, FormError, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

/** Change your own password; other devices are signed out so an old password stops working everywhere. */
export function ChangePassword() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const currentPassword = String(f.get("current") ?? "");
    const newPassword = String(f.get("new") ?? "");
    setError(null);
    setDone(false);
    if (newPassword.length < 12) return setError("The new password needs at least 12 characters.");
    if (newPassword !== String(f.get("again") ?? "")) return setError("The two new passwords don't match.");
    setPending(true);
    const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    setPending(false);
    if (error) return setError(error.code === "INVALID_PASSWORD" ? "Your current password is incorrect." : (error.message ?? "The password couldn't be changed. Try again."));
    form.reset();
    setDone(true);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Current password">
        <Input name="current" type="password" autoComplete="current-password" required />
      </Field>
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
