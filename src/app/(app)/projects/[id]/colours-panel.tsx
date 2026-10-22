"use client";
import { Check, Copy, Palette } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { Badge, Button, buttonClass, Card, CardHeader, Field, FormError, Input, Textarea, type Tone } from "@/components/ui";
import type { ColourSelectionStatus } from "@/db/schema/colours";
import { cn, formatDate } from "@/lib/utils";
import type { ColourSelectionSummary } from "@/server/colour-selections";
import { deleteColoursAction, sendColourLinkAction, startColoursAction, type ColourLinkResult } from "./colours/actions";

const STATUS: Record<ColourSelectionStatus, { label: string; tone: Tone }> = {
  draft: { label: "Being filled in", tone: "neutral" },
  sent: { label: "Sent to the customer", tone: "info" },
  signed: { label: "Signed", tone: "success" },
  replaced: { label: "Replaced", tone: "neutral" },
  cancelled: { label: "Deleted", tone: "neutral" },
};

type Draft = { to: string; subject: string; body: string } | null;

export function ColoursPanel({
  projectId,
  canEdit,
  selections,
  emailDrafts,
  className,
}: {
  projectId: string;
  canEdit: boolean;
  selections: ColourSelectionSummary[];
  emailDrafts: Record<string, Draft>;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<ColourSelectionSummary | null>(null);
  const open = selections.find((s) => s.status === "draft" || s.status === "sent");
  const signed = selections.find((s) => s.status === "signed");

  const begin = () =>
    start(async () => {
      setError(null);
      const r = await startColoursAction(projectId);
      if (r.ok && r.id) router.push(`/projects/${projectId}/colours/${r.id}`);
      else if (!r.ok) setError(r.error);
    });

  return (
    <Card id="colours" className={cn("scroll-mt-[calc(var(--app-top)+1rem)]", className)} role="region" aria-label="Colours">
      <CardHeader
        title="Colours"
        description="The customer's colours, signed off. They go in the customer file, and on the work order when you issue a new version."
        action={
          canEdit && !open ? (
            <Button size="sm" variant={signed ? "secondary" : "primary"} onClick={begin} disabled={pending}>
              <Palette className="size-4" aria-hidden /> {signed ? "Change colours" : "Fill in colours"}
            </Button>
          ) : undefined
        }
      />
      {error && <div className="px-4 pt-3"><FormError message={error} /></div>}
      {selections.length === 0 ? (
        <p className="p-4 text-sm text-muted">
          No colours yet.{canEdit ? " Fill them in with the customer (they sign on your phone or tablet), or send them a link to fill in and sign themselves. Signing ticks off the colour consult on this job." : ""}
        </p>
      ) : (
        <ul>
          {selections.map((s) => {
            const isOpen = s.status === "draft" || s.status === "sent";
            return (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4 first:border-t-0" data-testid="colour-selection">
                <div className="min-w-0 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
                    <span>{s.rowCount} {s.rowCount === 1 ? "line" : "lines"}</span>
                  </p>
                  <p className="mt-0.5 text-muted">
                    {s.signedAt
                      ? `Signed by ${s.signedName} on ${formatDate(s.signedAt)}${s.signedVia === "device" ? " (in person)" : " (online)"}`
                      : s.linkSentAt
                        ? `Link sent${s.linkSentTo ? ` to ${s.linkSentTo}` : ""} on ${formatDate(s.linkSentAt)}`
                        : `Last changed ${formatDate(s.updatedAt)}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/projects/${projectId}/colours/${s.id}`} className={buttonClass(isOpen && canEdit ? "primary" : "secondary", "sm")}>
                    {isOpen ? (canEdit ? "Fill in / sign" : "Open") : "Open signed copy"}
                  </Link>
                  {isOpen && canEdit && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setSending(s)}>
                        Send to customer
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => {
                          if (!window.confirm("Delete this colour form? Any link already sent stops working.")) return;
                          start(async () => {
                            const r = await deleteColoursAction(s.id);
                            if (!r.ok) setError(r.error);
                          });
                        }}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {sending && <SendDialog selection={sending} draft={emailDrafts[sending.id] ?? null} onClose={() => setSending(null)} />}
    </Card>
  );
}

const LINK_TOKEN = "[Colour form link]";

function SendDialog({ selection, draft, onClose }: { selection: ColourSelectionSummary; draft: Draft; onClose: () => void }) {
  const [email, setEmail] = useState(!!draft?.to);
  const [to, setTo] = useState(draft?.to ?? "");
  const [subject, setSubject] = useState(draft?.subject ?? "");
  const [body, setBody] = useState(draft?.body ?? "");
  const [result, setResult] = useState<ColourLinkResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  if (result?.ok) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Colour form link ready"
        description={`It works until ${formatDate(result.expiresAt)}. Once the customer signs, the colours appear on the job.`}
        footer={<Button onClick={onClose}>Done</Button>}
      >
        {result.emailed === "sent" && <p className="mb-3 rounded-md bg-success-soft px-3 py-2 text-sm text-success">Emailed to {to}.</p>}
        {result.emailed === "logged" && <p className="mb-3 rounded-md bg-info-soft px-3 py-2 text-sm text-info">Email isn&apos;t connected yet, so nothing was sent. Copy the link and text or email it yourself.</p>}
        {result.emailed === "failed" && <p className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">The email didn&apos;t go out ({result.emailError}). Copy the link and send it yourself.</p>}
        <Field label="Colour form link">
          <Input readOnly value={result.url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        </Field>
        <Button
          size="sm"
          variant="secondary"
          className="mt-2"
          onClick={async () => {
            await navigator.clipboard?.writeText(result.url).catch(() => undefined);
            setCopied(true);
          }}
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? "Copied" : "Copy link"}
        </Button>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Send the colour form"
      description="The customer fills in or checks the colours, ticks the two notes and signs. Any earlier link stops working."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                setResult(await sendColourLinkAction({ id: selection.id, email: email ? { to, subject, body } : null }));
              })
            }
          >
            {pending ? "Sending…" : email ? "Send" : "Create link"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Email it to the customer
        </label>
        {email && (
          <>
            <Field label="Customer email"><Input type="email" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            <Field label="Subject"><Input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} /></Field>
            <Field label="Email" hint={`From your "Choosing colours" template (Settings → Email templates). ${LINK_TOKEN} becomes the link.`}>
              <Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
          </>
        )}
        {result && !result.ok && <FormError message={result.error} />}
      </div>
    </Dialog>
  );
}
