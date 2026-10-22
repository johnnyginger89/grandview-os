"use client";
import { useActionState } from "react";
import { submitWith } from "@/components/submit";
import { Button, Field, FormError, Input } from "@/components/ui";
import { recoverAction } from "./actions";

export function RecoverForm() {
  const [state, action, pending] = useActionState(recoverAction, null);
  // POST, so pressing the button before the page has loaded never puts the code or password in the address.
  return (
    <form method="post" onSubmit={submitWith(action)} className="space-y-4">
      <Field label="Recovery code" hint="Exactly what you typed as OWNER_RECOVERY_CODE in Vercel."><Input name="code" type="password" autoComplete="off" required autoFocus /></Field>
      <Field label="Your email"><Input name="email" type="email" autoComplete="email" required /></Field>
      <Field label="New password" hint="At least 12 characters. A short sentence works well."><Input name="password" type="password" autoComplete="new-password" minLength={12} required /></Field>
      <Field label="New password again"><Input name="confirm" type="password" autoComplete="new-password" required /></Field>
      <FormError message={state?.error} />
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Saving…" : "Set new password"}</Button>
      <p className="text-xs text-muted">
        You&apos;ll still need your 6-digit authenticator code to sign in. The code works once, and the owner is told each time it&apos;s used. Afterwards, delete OWNER_RECOVERY_CODE in Vercel.
      </p>
    </form>
  );
}
