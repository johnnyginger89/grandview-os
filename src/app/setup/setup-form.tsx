"use client";
import { submitWith } from "@/components/submit";
import { useActionState } from "react";
import { Button, Field, FormError, Input } from "@/components/ui";
import { setupAction } from "./actions";

export function SetupForm() {
  const [state, action, pending] = useActionState(setupAction, null);
  return (
    <form onSubmit={submitWith(action)} className="space-y-4">
      <Field label="Setup code"><Input name="token" type="password" autoComplete="off" required autoFocus /></Field>
      <Field label="Your name"><Input name="name" autoComplete="name" required /></Field>
      <Field label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
      <Field label="Password" hint="At least 12 characters. A short sentence works well."><Input name="password" type="password" autoComplete="new-password" minLength={12} required /></Field>
      <Field label="Confirm password"><Input name="confirm" type="password" autoComplete="new-password" required /></Field>
      <FormError message={state?.error} />
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Creating…" : "Create owner account"}</Button>
      <p className="text-xs text-muted">Next you&apos;ll sign in and set up two-factor authentication.</p>
    </form>
  );
}
