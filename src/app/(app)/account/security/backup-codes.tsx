"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button, Field, FormError, Input } from "@/components/ui";
import { regenerateBackupCodesAction } from "./actions";

/** Make a new set of backup codes (the old ones stop working), confirmed with the authenticator app. Shown once. */
export function BackupCodes() {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const code = String(new FormData(form).get("code") ?? "").replace(/\s/g, "");
    setError(null);
    setPending(true);
    const r = await regenerateBackupCodesAction({ code });
    setPending(false);
    if (!r.ok) return setError(r.error);
    form.reset();
    setCodes(r.codes);
  }

  async function copy(list: string[]) {
    try {
      await navigator.clipboard.writeText(list.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy your backup codes:", list.join(" "));
    }
  }

  if (codes) {
    return (
      <div className="space-y-3 text-sm">
        <p role="status" className="text-success">New backup codes are ready. The old ones no longer work.</p>
        <ul aria-label="New backup codes" className="grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-3 font-mono text-xs">
          {codes.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <p className="text-muted">Save them now somewhere safe, such as a password manager. They won&apos;t be shown again.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => copy(codes)}>
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            {copied ? "Copied" : "Copy codes"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCodes(null)}>I&apos;ve saved them</Button>
        </div>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={submit} className="space-y-3">
      <p className="text-sm text-muted">Lost your backup codes, or used most of them? Make a new set. The old ones stop working.</p>
      <Field label="Code from your authenticator app">
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" required />
      </Field>
      <FormError message={error} />
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Checking…" : "Make new backup codes"}</Button>
    </form>
  );
}
