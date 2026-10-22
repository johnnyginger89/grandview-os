"use client";
import { useState, useTransition } from "react";
import { ChevronDown, CircleCheck, Copy, ExternalLink, Link2, Send, Tablet } from "lucide-react";
import { Popover, popoverItem } from "@/components/app-shell/popover";
import { Dialog } from "@/components/dialog";
import { FollowUpDialog } from "@/components/proposals/follow-up-dialog";
import { Badge, Button, Field, FormError, Input, Textarea, type Tone } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/utils";
import { sendProposalAction, setStatusAction, withdrawProposalAction } from "../actions";
import { AcceptDialog, acceptedText } from "./accept-dialog";
import type { ProposalProps, ProposalRow } from "./proposal-types";

const TONE: Record<string, Tone> = { sent: "info", viewed: "brand", expired: "warning", accepted: "success", declined: "danger", superseded: "neutral", withdrawn: "neutral" };
const LINK_TOKEN = "[Proposal link]";

const isOpen = (p: ProposalRow) => p.status === "sent" || p.status === "viewed";

/** The proposal waiting on the customer, if any (expired or not). */
const openRow = (rows: ProposalRow[]) => rows.find(isOpen) ?? null;

/** "valid until Nov 19, 2026" while the customer can still accept the open proposal. */
export function validUntilText(rows: ProposalRow[]): string | null {
  const open = openRow(rows);
  return open?.expiresAt && !open.expired ? `valid until ${formatDate(open.expiresAt)}` : null;
}

/** The one Send dialog: the email from the template, checked and sent (or just a link). */
export function SendDialog({ estimateId, proposals, onClose, title = "Send proposal" }: { estimateId: string; proposals: ProposalProps; onClose: () => void; title?: string }) {
  const [to, setTo] = useState(proposals.defaultEmail);
  const [subject, setSubject] = useState(proposals.emailDraft.subject);
  const [body, setBody] = useState(proposals.emailDraft.body);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [email, setEmail] = useState(true);
  const [result, setResult] = useState<{ link: string; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const send = () =>
    start(async () => {
      setError(null);
      const r = await sendProposalAction(estimateId, { to, message: note, email, subject, body });
      if (!r.ok) return setError(r.error);
      const sent =
        r.emailStatus === "sent"
          ? `Emailed to ${to}.`
          : r.emailStatus === "failed"
            ? `Proposal created, but the email couldn't be sent (${r.emailError ?? "email not set up"}). Copy the link and send it yourself.`
            : r.emailStatus === "logged"
              ? "Proposal created. Email sending isn't switched on yet – copy the link below."
              : "Proposal created. Copy the link and send it to your customer.";
      setResult({ link: r.link, note: sent });
    });

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description="Sending freezes this version as a revision. You can keep editing; a newer proposal replaces this one."
      className="w-[min(40rem,calc(100vw-2rem))]"
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button onClick={send} disabled={pending}>
              <Send className="size-4" aria-hidden /> {pending ? "Sending…" : email ? "Send proposal" : "Create link"}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-2 text-sm">
          <p role="status" className={result.note.startsWith("Emailed") ? "text-success" : "text-warning"}>{result.note}</p>
          <div className="flex gap-2">
            <Input readOnly value={result.link} aria-label="Proposal link" className="font-mono text-xs" />
            <Button
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(result.link);
                setCopied(true);
              }}
            >
              <Copy className="size-3.5" aria-hidden /> {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Email it to the customer
          </label>
          {email && (
            <>
              <Field label="Customer email"><Input type="email" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
              <Field label="Subject"><Input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} /></Field>
              <Field label="Email" hint={`Written from your "Sending a proposal" template (Settings → Email templates). ${LINK_TOKEN} becomes the link to the proposal.`}>
                <Textarea rows={10} value={body} maxLength={10_000} onChange={(e) => setBody(e.target.value)} />
              </Field>
            </>
          )}
          {showNote ? (
            <Field label="Note at the top of the proposal page (optional)"><Textarea rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></Field>
          ) : (
            <button type="button" className="min-h-9 text-sm text-brand hover:underline" onClick={() => setShowNote(true)}>+ Add a note on the proposal page</button>
          )}
          <a href={`/estimates/${estimateId}/proposal-preview`} target="_blank" rel="noopener" className="inline-flex min-h-9 items-center gap-1 text-sm text-brand hover:underline">
            <ExternalLink className="size-3.5" aria-hidden /> Preview what the customer sees
          </a>
          <FormError message={error} />
        </div>
      )}
    </Dialog>
  );
}

/** Send proposal, with ▾ for the other ways a proposal goes out or comes back accepted. */
export function SendControls({ estimateId, status, proposals, compact }: { estimateId: string; status: string; proposals: ProposalProps; compact?: boolean }) {
  const [dialog, setDialog] = useState<"send" | "accept" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  if (!proposals.canSend) return null;
  // An expired link is dead; there's nothing worth copying.
  const open = proposals.rows.find((p) => isOpen(p) && !p.expired);

  const signNow = () =>
    start(async () => {
      // Opened right away (before the request) so the browser doesn't block it as a pop-up.
      const tab = window.open("about:blank", "_blank");
      const r = await sendProposalAction(estimateId, { to: "", message: "", email: false });
      if (!r.ok) {
        tab?.close();
        return setError(r.error);
      }
      if (tab) tab.location.href = r.link;
      else window.location.href = r.link;
    });

  return (
    <div className="flex items-center gap-0.5">
      <Button size={compact ? "md" : "sm"} onClick={() => setDialog("send")} className="rounded-r-none">
        <Send className="size-4" aria-hidden /> {compact ? "Send" : "Send proposal"}
      </Button>
      <Popover
        label="More ways to send"
        align="right"
        side={compact ? "above" : "below"}
        buttonClassName={`grid place-items-center rounded-l-none rounded-r-lg bg-brand text-brand-contrast hover:bg-brand-hover ${compact ? "h-10 w-10" : "h-8 w-8"}`}
        button={<ChevronDown className="size-4" aria-hidden />}
      >
        {(close) => (
          <>
            <button type="button" className={popoverItem} disabled={pending} onClick={() => { close(); signNow(); }}>
              <Tablet className="size-4" aria-hidden /> Sign now on this device
            </button>
            <button type="button" className={popoverItem} onClick={() => { close(); setDialog("accept"); }}>
              <CircleCheck className="size-4" aria-hidden /> Mark as accepted
            </button>
            {status === "draft" && (
              <button
                type="button"
                className={popoverItem}
                disabled={pending}
                onClick={() => {
                  close();
                  if (confirm("Mark this estimate as sent without emailing anything? A revision is saved.")) start(async () => { const r = await setStatusAction(estimateId, "sent"); setError(r.ok ? null : r.error); });
                }}
              >
                <Send className="size-4" aria-hidden /> Mark as sent without emailing
              </button>
            )}
            {open && (
              <button
                type="button"
                className={popoverItem}
                onClick={async () => {
                  await navigator.clipboard.writeText(open.link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                  close();
                }}
              >
                <Link2 className="size-4" aria-hidden /> Copy proposal link
              </button>
            )}
          </>
        )}
      </Popover>
      {copied && <span role="status" className="ml-2 text-xs text-success">Link copied</span>}
      {error && <span role="alert" className="ml-2 text-xs text-danger">{error}</span>}
      {dialog === "send" && <SendDialog estimateId={estimateId} proposals={proposals} onClose={() => setDialog(null)} />}
      {dialog === "accept" && <AcceptDialog estimateId={estimateId} defaultName={proposals.acceptName} options={proposals.options} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Where the proposal stands, for the header: "Sent · not opened yet", "Opened 2×", "Signed by …". */
export function proposalStatusText(rows: ProposalRow[]): string | null {
  const p = rows[0];
  if (!p) return null;
  if (p.acceptedAt) return acceptedText(p);
  if (p.status === "declined") return "Declined";
  if (p.status === "withdrawn") return "Withdrawn";
  if (p.expired && p.expiresAt) return `Expired on ${formatDate(p.expiresAt)}`;
  return p.firstViewedAt ? `Opened ${p.viewCount}×` : "Sent · not opened yet";
}

/** The open proposal ran out before the customer accepted: say so, and offer the Send dialog again. */
export function ExpiredNotice({ estimateId, proposals }: { estimateId: string; proposals: ProposalProps }) {
  const [sending, setSending] = useState(false);
  const open = openRow(proposals.rows);
  return (
    <>
      {open?.expired && open.expiresAt && (
        <section aria-label="Expired proposal" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          <p>
            <strong>Expired on {formatDate(open.expiresAt)}.</strong> The customer can no longer accept this proposal.
          </p>
          {proposals.canSend && (
            <Button size="sm" onClick={() => setSending(true)}>
              <Send className="size-4" aria-hidden /> Send updated proposal
            </Button>
          )}
        </section>
      )}
      {/* Outside the notice: once sent, the page refreshes and the notice goes, but the link stays on screen. */}
      {sending && <SendDialog estimateId={estimateId} proposals={proposals} title="Send updated proposal" onClose={() => setSending(false)} />}
    </>
  );
}

/** Every proposal sent for this estimate, with follow-up and withdraw. */
export function SentProposals({ estimateId, proposals }: { estimateId: string; proposals: ProposalProps }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [followingUp, setFollowingUp] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const { rows, canSend, followUps } = proposals;
  if (!rows.length) return null;
  const copy = async (link: string) => {
    await navigator.clipboard.writeText(link);
    setCopied(link);
    setTimeout(() => setCopied(null), 2000);
  };
  return (
    <section id="proposals" aria-label="Sent proposals" className="rounded-lg border border-border bg-surface shadow-card">
      <h2 className="px-4 pt-3 font-semibold">Sent proposals</h2>
      {note && <p role="status" className="px-4 pt-1 text-sm text-success">{note}</p>}
      <FormError message={error} />
      <ul className="divide-y divide-border text-sm">
        {rows.map((p) => (
          <li key={p.id} className="space-y-1 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={TONE[p.expired ? "expired" : p.status]}>{p.expired ? "expired" : p.status}</Badge>
              <span className="text-muted">Rev {p.revision} · {p.sentTo ? `sent ${formatDateTime(p.sentAt)} to ${p.sentTo}` : `created ${formatDateTime(p.sentAt)}`}</span>
            </div>
            <p className="text-xs text-muted">
              {acceptedText(p) ?? (p.firstViewedAt ? `Opened ${p.viewCount}× · first ${formatDateTime(p.firstViewedAt)}` : "Not opened yet")}
              {p.declineReason ? ` · Declined: "${p.declineReason}"` : ""}
              {isOpen(p) && followUps.count > 0 && followUps.lastAt
                ? ` · Followed up ${followUps.count === 1 ? "once" : `${followUps.count} times`}, last ${formatDateTime(followUps.lastAt)}`
                : ""}
              {isOpen(p) && p.expiresAt ? ` · ${p.expired ? "Expired on" : "Valid until"} ${formatDate(p.expiresAt)}` : ""}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <a href={p.link} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 text-brand hover:underline"><ExternalLink className="size-3" aria-hidden /> Open</a>
              <button type="button" onClick={() => copy(p.link)} className="inline-flex min-h-8 items-center gap-1 text-brand hover:underline"><Copy className="size-3" aria-hidden /> {copied === p.link ? "Copied" : "Copy link"}</button>
              {canSend && isOpen(p) && !p.expired && p.sentTo && (
                <button type="button" onClick={() => setFollowingUp(p.id)} className="inline-flex min-h-8 items-center gap-1 font-medium text-brand hover:underline"><Send className="size-3" aria-hidden /> Follow up</button>
              )}
              {canSend && isOpen(p) && (
                <button
                  type="button"
                  className="min-h-8 text-muted hover:text-danger"
                  onClick={() => {
                    if (confirm("Withdraw this proposal? The customer's link will stop accepting signatures.")) start(async () => { const r = await withdrawProposalAction(estimateId, p.id); setError(r.ok ? null : r.error); });
                  }}
                >
                  Withdraw
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {followingUp && <FollowUpDialog proposalId={followingUp} customerName={proposals.customerName} onClose={() => setFollowingUp(null)} onSent={setNote} />}
    </section>
  );
}
