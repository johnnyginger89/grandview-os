"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Copy, ExternalLink, Send } from "lucide-react";
import { Dialog } from "@/components/dialog";
import { Badge, Button, Card, CardHeader, Field, FormError, Input, Textarea, type Tone } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { acceptForCustomerAction, sendProposalAction, withdrawProposalAction } from "../actions";

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
  /** online, phone, email, in_person or paper. */
  acceptedMethod: string | null;
  declineReason: string | null;
}

export interface ProposalOption {
  id: string;
  title: string;
  /** Formatted, before GST. */
  price: string;
}

const TONE: Record<string, Tone> = { sent: "info", viewed: "brand", accepted: "success", declined: "danger", superseded: "neutral", withdrawn: "neutral" };
const LINK_TOKEN = "[Proposal link]";
const METHODS = [
  { value: "phone", label: "By phone" },
  { value: "email", label: "By email" },
  { value: "in_person", label: "In person" },
  { value: "paper", label: "Signed a paper copy" },
] as const;
const METHOD_PHRASE: Record<string, string> = { phone: "by phone", email: "by email", in_person: "in person", paper: "on paper" };

function acceptedText(p: ProposalRow) {
  if (!p.acceptedAt) return null;
  return p.acceptedMethod && p.acceptedMethod !== "online"
    ? `Accepted ${METHOD_PHRASE[p.acceptedMethod] ?? ""} by ${p.acceptedName} on ${formatDateTime(p.acceptedAt)}`
    : `Signed by ${p.acceptedName} on ${formatDateTime(p.acceptedAt)}`;
}

function AcceptDialog({ estimateId, defaultName, options, onClose }: { estimateId: string; defaultName: string; options: ProposalOption[]; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [method, setMethod] = useState<(typeof METHODS)[number]["value"] | "">("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError(null);
      if (!method) return setError("Choose how they accepted.");
      const r = await acceptForCustomerAction(estimateId, { name, method, selectedOptionIds: chosen, note: note || undefined });
      if (!r.ok) return setError(r.error);
      router.push(r.projectId ? `/projects/${r.projectId}` : `/estimates/${estimateId}`);
    });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Mark as accepted"
      description="For when the customer said yes by phone, email, in person or on paper. The job is created right away and this estimate is locked, just like an online signature."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>
            <CircleCheck className="size-4" aria-hidden /> {pending ? "Saving…" : "Mark as accepted"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Who accepted it?">
          <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-autofocus />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">How did they accept?</legend>
          <div className="grid grid-cols-2 gap-2">
            {METHODS.map((m) => (
              <label key={m.value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border-strong px-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                <input type="radio" name="accept-method" value={m.value} checked={method === m.value} onChange={() => setMethod(m.value)} className="size-4" />
                {m.label}
              </label>
            ))}
          </div>
        </fieldset>
        {options.length > 0 && (
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Optional upgrades they chose</legend>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {options.map((o) => (
                <li key={o.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={chosen.includes(o.id)}
                      onChange={(e) => setChosen((c) => (e.target.checked ? [...c, o.id] : c.filter((x) => x !== o.id)))}
                    />
                    <span className="flex-1">{o.title}</span>
                    <span className="tabular-nums text-muted">+{o.price}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        <Field label="Note (optional)" hint="e.g. Accepted on the phone with Malcolm; wants to start after the 15th.">
          <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="text-xs text-muted">The estimate is accepted exactly as it is now. If you changed it after sending, the customer is held to this version.</p>
        <FormError message={error} />
      </div>
    </Dialog>
  );
}

export function ProposalsPanel({
  estimateId,
  rows,
  defaultEmail,
  emailDraft,
  acceptName,
  options,
  canSend,
}: {
  estimateId: string;
  rows: ProposalRow[];
  defaultEmail: string;
  /** From the "Sending a proposal" template, with this customer's details filled in. */
  emailDraft: { subject: string; body: string };
  acceptName: string;
  options: ProposalOption[];
  canSend: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [to, setTo] = useState(defaultEmail);
  const [subject, setSubject] = useState(emailDraft.subject);
  const [body, setBody] = useState(emailDraft.body);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
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
        action={
          canSend &&
          !open && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setAccepting(true)}>
                <CircleCheck className="size-3.5" aria-hidden /> Mark as accepted
              </Button>
              <Button size="sm" onClick={() => { setOpen(true); setResult(null); }}>
                <Send className="size-3.5" aria-hidden /> Send proposal
              </Button>
            </div>
          )
        }
      />
      {accepting && <AcceptDialog estimateId={estimateId} defaultName={acceptName} options={options} onClose={() => setAccepting(false)} />}
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
              {email && (
                <>
                  <Field label="Customer email"><Input type="email" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
                  <Field label="Subject"><Input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} /></Field>
                  <Field label="Email" hint={`Written from your "Sending a proposal" template (Settings → Email templates). ${LINK_TOKEN} becomes the link to the proposal.`}>
                    <Textarea rows={11} value={body} maxLength={10_000} onChange={(e) => setBody(e.target.value)} />
                  </Field>
                </>
              )}
              {showNote ? (
                <Field label="Note at the top of the proposal page (optional)"><Textarea rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></Field>
              ) : (
                <button type="button" className="text-sm text-brand hover:underline" onClick={() => setShowNote(true)}>+ Add a note on the proposal page</button>
              )}
              <p className="text-xs text-muted">Sending freezes this version of the estimate as a revision. You can keep editing; a newer proposal replaces this one.</p>
              <FormError message={error} />
              <div className="flex gap-2">
                <Button disabled={pending} onClick={() => start(async () => {
                  setError(null);
                  const r = await sendProposalAction(estimateId, { to, message: note, email, subject, body });
                  if (!r.ok) return setError(r.error);
                  const sent = r.emailStatus === "sent" ? `Emailed to ${to}.` : r.emailStatus === "failed" ? `Proposal created, but the email couldn't be sent (${r.emailError ?? "email not set up"}). Copy the link and send it yourself.` : r.emailStatus === "logged" ? "Proposal created. Email sending isn't switched on yet – copy the link below." : "Proposal created. Copy the link and send it to your customer.";
                  setResult({ link: r.link, note: sent });
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
                <span className="text-muted">Rev {p.revision} · {p.sentTo ? `sent ${formatDateTime(p.sentAt)} to ${p.sentTo}` : `created ${formatDateTime(p.sentAt)}`}</span>
              </div>
              <p className="text-xs text-muted">
                {acceptedText(p) ?? (p.firstViewedAt ? `Opened ${p.viewCount}× · first ${formatDateTime(p.firstViewedAt)}` : "Not opened yet")}
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
