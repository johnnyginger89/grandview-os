"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Dialog } from "@/components/dialog";
import { Button, Field, FormError, Input, Textarea } from "@/components/ui";
import { followUpDraftAction, sendFollowUpAction } from "@/app/(app)/estimates/actions";

/**
 * "Follow up": the email is written from the "Following up on a proposal" template and
 * shown here to check, then sent in the same conversation as the proposal email.
 */
export function FollowUpDialog({ proposalId, customerName, onClose, onSent }: { proposalId: string; customerName: string; onClose: () => void; onSent?: (note: string) => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState<{ to: string; subject: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    followUpDraftAction(proposalId).then((r) => {
      if (!live) return;
      if (r.ok) setDraft(r.draft);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [proposalId]);

  const send = () =>
    start(async () => {
      if (!draft) return;
      setError(null);
      const r = await sendFollowUpAction(proposalId, draft);
      if (!r.ok) return setError(r.error);
      onSent?.(r.status === "sent" ? `Follow-up emailed to ${draft.to}.` : "Follow-up saved. Email sending isn't switched on yet, so it wasn't actually sent.");
      router.refresh();
      onClose();
    });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Follow up with ${customerName}`}
      description="Check the email, change anything you like, and send. It goes out as a reply to the proposal email."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={send} disabled={pending || !draft}>
            <Send className="size-4" aria-hidden /> {pending ? "Sending…" : "Send follow-up"}
          </Button>
        </>
      }
    >
      {draft ? (
        <div className="space-y-3">
          <Field label="To"><Input type="email" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></Field>
          <Field label="Subject"><Input value={draft.subject} maxLength={200} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></Field>
          <Field label="Email" hint='Written from your "Following up on a proposal" template (Settings → Email templates).'>
            <Textarea rows={12} value={draft.body} maxLength={10_000} onChange={(e) => setDraft({ ...draft, body: e.target.value })} data-autofocus />
          </Field>
          <FormError message={error} />
        </div>
      ) : error ? (
        <FormError message={error} />
      ) : (
        <p className="text-sm text-muted">Writing the email…</p>
      )}
    </Dialog>
  );
}
