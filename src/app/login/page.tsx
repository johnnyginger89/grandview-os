"use client";
import Link from "next/link";
import { useState } from "react";
import { Button, Field, FormError, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "./auth-shell";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (error) {
      setPending(false);
      setError(error.status === 429 ? "Too many attempts. Wait a minute and try again." : error.status && error.status >= 500 ? "Sign-in is temporarily unavailable. Please try again shortly." : "Email or password is incorrect.");
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return; // client plugin redirects
    window.location.href = "/";
  }

  return (
    <AuthShell title="Sign in" subtitle="Grandview Painting team access">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <FormError message={error} />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-center text-sm">
          <Link href="/login/forgot" className="text-brand hover:underline">Forgot password?</Link>
        </p>
      </form>
    </AuthShell>
  );
}
