"use client";
import Link from "next/link";
import QRCode from "qrcode";
import { useState } from "react";
import { Badge, Button, Field, FormError, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export function TwoFactorSetup({ enabled }: { enabled: boolean }) {
  const [step, setStep] = useState<"idle" | "scan" | "done">("idle");
  const [qr, setQr] = useState<string>("");
  const [secret, setSecret] = useState<string>("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const password = String(new FormData(e.currentTarget).get("password"));
    const { data, error } = await authClient.twoFactor.enable({ password });
    if (error || !data || !("totpURI" in data)) return setError("Password is incorrect.");
    setBackupCodes(data.backupCodes);
    setSecret(new URL(data.totpURI).searchParams.get("secret") ?? "");
    setQr(await QRCode.toDataURL(data.totpURI, { margin: 1, width: 200 }));
    setStep("scan");
  }

  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const code = String(new FormData(e.currentTarget).get("code")).replace(/\s/g, "");
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) return setError("That code didn't match. Check the time on your phone and try again.");
    setStep("done");
  }

  if (enabled && step === "idle") {
    return <p className="flex items-center gap-2 text-sm"><Badge tone="success">On</Badge> Two-factor authentication is protecting your account.</p>;
  }

  if (step === "done") {
    return (
      <div className="space-y-3 text-sm">
        <p className="flex items-center gap-2"><Badge tone="success">On</Badge> Two-factor authentication is set up.</p>
        <Link href="/" className="text-brand hover:underline">Continue to Grandview OS</Link>
      </div>
    );
  }

  if (step === "scan") {
    return (
      <div className="space-y-4 text-sm">
        <ol className="list-decimal space-y-1 pl-5 text-muted">
          <li>Scan this code with your authenticator app.</li>
          <li>Save the backup codes somewhere safe (a password manager is ideal).</li>
          <li>Enter the 6-digit code the app shows.</li>
        </ol>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {qr && <img src={qr} alt="Authenticator QR code" className="size-48 rounded border border-border" />}
        <p className="text-xs text-muted">Can&apos;t scan? Enter this key: <code className="break-all font-mono">{secret}</code></p>
        <div className="rounded-md bg-surface-2 p-3">
          <p className="mb-2 text-xs font-medium">Backup codes (each works once)</p>
          <div className="grid grid-cols-2 gap-1 font-mono text-xs">{backupCodes.map((c) => <span key={c}>{c}</span>)}</div>
        </div>
        <form onSubmit={verify} className="flex items-end gap-2">
          <Field label="6-digit code" className="flex-1"><Input name="code" inputMode="numeric" autoComplete="one-time-code" required /></Field>
          <Button type="submit">Turn on</Button>
        </form>
        <FormError message={error} />
      </div>
    );
  }

  return (
    <form onSubmit={start} className="space-y-3">
      <Field label="Confirm your password to begin"><Input name="password" type="password" autoComplete="current-password" required /></Field>
      <FormError message={error} />
      <Button type="submit">Set up two-factor authentication</Button>
    </form>
  );
}
