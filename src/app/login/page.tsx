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
      // Phones often add a space after an autofilled address.
      email: String(form.get("email") ?? "").trim().toLowerCase(),
      password: String(form.get("password")),
    });
    if (error) {
      setPending(false);
      setError(
        error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : error.status && error.status >= 500
            ? "Sign-in is temporarily unavailable. Please try again shortly."
            : error.code === "INVALID_ORIGIN"
              ? `Signing in from ${window.location.host} isn't switched on. Use the main address, or ask the owner to add this one.`
              : error.code === "EMAIL_NOT_VERIFIED"
                ? "This account's email isn't confirmed yet."
                : error.status === 403
                  ? "This account can't sign in right now. Ask the owner to check it's active."
                  : "Email or password is incorrect.",
      );
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
