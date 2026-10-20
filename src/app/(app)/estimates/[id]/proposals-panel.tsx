"use client";
import { useState, useTransition } from "react";
import { Copy, ExternalLink, Send } from "lucide-react";
import { Badge, Button, Card, CardHeader, Field, FormError, Input, Textarea, type Tone } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { sendProposalAction, withdrawProposalAction } from "../actions";

export interface ProposalRow {
  id: string;
  revision: number;
  status: string;
  link: string;
  sentTo: string | null;
  sentAt: string;
  firstViewedAt: string | null;
  viewCount: number;
  acceptedAt: string | null;
  acceptedName: string | null;
  declineReason: string | null;
}

const TONE: Record<string, Tone> = { sent: "info", viewed: "brand", accepted: "success", declined: "danger", superseded: "neutral", withdrawn: "neutral" };

export function ProposalsPanel({ estimateId, rows, defaultEmail, canSend }: { estimateId: string; rows: ProposalRow[]; defaultEmail: string; canSend: boolean }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultEmail);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(true);
  const [result, setResult] = useState<{ link: string; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const copy = async (link: string) => {
    await navigator.clipboard.writeText(link);
    setCopied(link);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <Card id="proposals">
      <CardHeader
        title="Customer proposal"
        description="A branded page your customer can review, pick upgrades on, and sign."
        action={canSend && !open && <Button size="sm" onClick={() => { setOpen(true); setResult(null); }}><Send className="size-3.5" /> Send proposal</Button>}
      />
      {open && (
        <div className="space-y-3 border-b border-border p-4">
          {result ? (
            <div className="space-y-2 text-sm">
              <p className={result.note.startsWith("Emailed") ? "text-success" : "text-warning"}>{result.note}</p>
              <div className="flex gap-2">
                <Input readOnly value={result.link} aria-label="Proposal link" className="h-9 font-mono text-xs" />
                <Button size="sm" variant="secondary" onClick={() => copy(result.link)}><Copy className="size-3.5" /> {copied === result.link ? "Copied" : "Copy"}</Button>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Done</Button>
            </div>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Email it to the customer</label>
              {email && <Field label="Customer email"><Input type="email" value={to} onChange={(e) => setTo(e.target.value)} /></Field>}
              <Field label="Personal message (optional)" hint="Shown at the top of the proposal and in the email."><Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
              <p className="text-xs text-muted">Sending freezes this version of the estimate as a revision. You can keep editing; a newer proposal replaces this one.</p>
              <FormError message={error} />
              <div className="flex gap-2">
                <Button disabled={pending} onClick={() => start(async () => {
                  setError(null);
                  const r = await sendProposalAction(estimateId, { to, message, email });
                  if (!r.ok) return setError(r.error);
                  const note = r.emailStatus === "sent" ? `Emailed to ${to}.` : r.emailStatus === "failed" ? `Proposal created, but the email couldn't be sent (${r.emailError ?? "email not set up"}). Copy the link and send it yourself.` : r.emailStatus === "logged" ? "Proposal created. Email delivery isn't set up in this environment – copy the link below." : "Proposal created. Copy the link and send it to your customer.";
                  setResult({ link: r.link, note });
                })}>{pending ? "Sending…" : email ? "Send proposal" : "Create link"}</Button>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              </div>
            </>
          )}
        </div>
      )}
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted">No proposal sent yet.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {rows.map((p) => (
            <li key={p.id} className="space-y-1 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TONE[p.status]}>{p.status}</Badge>
                <span className="text-muted">Rev {p.revision} · sent {formatDateTime(p.sentAt)}{p.sentTo ? ` to ${p.sentTo}` : ""}</span>
              </div>
              <p className="text-xs text-muted">
                {p.acceptedAt ? `Signed by ${p.acceptedName} on ${formatDateTime(p.acceptedAt)}` : p.firstViewedAt ? `Opened ${p.viewCount}× · first ${formatDateTime(p.firstViewedAt)}` : "Not opened yet"}
                {p.declineReason ? ` · Declined: "${p.declineReason}"` : ""}
              </p>
              <div className="flex flex-wrap gap-3 text-xs">
                <a href={p.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline"><ExternalLink className="size-3" /> Open</a>
                <button type="button" onClick={() => copy(p.link)} className="inline-flex items-center gap-1 text-brand hover:underline"><Copy className="size-3" /> {copied === p.link ? "Copied" : "Copy link"}</button>
                {canSend && (p.status === "sent" || p.status === "viewed") && (
                  <button type="button" className="text-muted hover:text-danger" onClick={() => { if (confirm("Withdraw this proposal? The customer's link will stop accepting signatures.")) start(async () => { const r = await withdrawProposalAction(estimateId, p.id); if (!r.ok) setError(r.error); }); }}>Withdraw</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
