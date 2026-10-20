"use client";
import { useState } from "react";
import { Button, Field, FormError, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "../auth-shell";

export default function ResetPage() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const pw = String(form.get("password"));
    if (pw !== String(form.get("confirm"))) return setError("Passwords don't match.");
    if (pw.length < 12) return setError("Use at least 12 characters.");
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    const { error } = await authClient.resetPassword({ newPassword: pw, token });
    if (error) return setError("This reset link is invalid or has expired. Request a new one.");
    setDone(true);
  }
  return (
    <AuthShell title="Choose a new password" subtitle="At least 12 characters. A short sentence works well.">
      {done ? (
        <p className="text-sm text-muted">Password updated. <a href="/login" className="text-brand hover:underline">Sign in</a></p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="New password"><Input name="password" type="password" autoComplete="new-password" required /></Field>
          <Field label="Confirm password"><Input name="confirm" type="password" autoComplete="new-password" required /></Field>
          <FormError message={error} />
          <Button type="submit" className="w-full">Update password</Button>
        </form>
      )}
    </AuthShell>
  );
}
