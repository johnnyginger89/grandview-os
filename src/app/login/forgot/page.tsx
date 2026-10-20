"use client";
import Link from "next/link";
import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "../auth-shell";

export default function ForgotPage() {
  const [sent, setSent] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email"));
    // Same response whether or not the account exists, to avoid revealing who has an account.
    await authClient.requestPasswordReset({ email, redirectTo: "/login/reset" });
    setSent(true);
  }
  return (
    <AuthShell title="Reset password">
      {sent ? (
        <p className="text-sm text-muted">If that email has an account, a reset link is on its way. It expires in 1 hour.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email"><Input name="email" type="email" required autoFocus /></Field>
          <Button type="submit" className="w-full">Send reset link</Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm"><Link href="/login" className="text-brand hover:underline">Back to sign in</Link></p>
    </AuthShell>
  );
}
