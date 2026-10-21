"use client";
import { Send } from "lucide-react";
import { useState, useTransition } from "react";
import { previewStartNoticeAction, sendStartNoticeAction, type NoticePreviewView } from "@/app/(app)/schedule/actions";
import { Dialog } from "@/components/dialog";
import { Button, Field, FormError, Input, Textarea } from "@/components/ui";
import type { NoticeKind, NoticeVariant } from "@/lib/schedule/constants";
import { longDay, workingDaysLabel } from "@/lib/schedule/format";
import { callAction, innerDialogClose } from "./call-action";

const TITLE: Record<NoticeKind, string> = { start_week: "Send start week", start_date: "Send start date" };

function datesLine(kind: NoticeKind, p: NoticePreviewView): string | null {
  if (!p.startDate) return null;
  if (kind === "start_week") return `Start week of ${longDay(p.weekOf ?? p.startDate)}`;
  const finish = p.endDate && p.endDate !== p.startDate ? ` · finish around ${longDay(p.endDate)}` : "";
  return `Start ${longDay(p.startDate)} · about ${workingDaysLabel(p.workingDays)}${finish}`;
}

/**
 * "Send start week…" / "Send start date…": a button that opens a preview the server
 * composed. The user can edit the subject and message, then presses Send. Nothing is
 * ever sent without that click (CLAUDE.md rule 8). The recipient and dates come from
 * the server and can't be changed here.
 */
export function StartNoticeButton({
  projectId,
  kind,
  label,
  title,
  variant = "secondary",
  showButton = true,
  onSent,
}: {
  projectId: string;
  kind: NoticeKind;
  label: string;
  /** Dialog title; defaults to "Send start week" / "Send start date". */
  title?: string;
  variant?: "primary" | "secondary";
  /**
   * Hide the button but keep the component mounted, so an open dialog survives the
   * stage changing underneath it (the page refreshes right after a send).
   */
  showButton?: boolean;
  onSent?: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<NoticePreviewView | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sendAnyway, setSendAnyway] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [sending, startSending] = useTransition();

  function load(v?: NoticeVariant) {
    setError(null);
    startLoading(async () => {
      const r = await callAction(() => previewStartNoticeAction({ projectId, kind, variant: v }));
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setPreview(r.preview);
      setSubject(r.preview.subject);
      setBody(r.preview.body);
    });
  }

  function openDialog() {
    setPreview(null);
    setSent(null);
    setSendAnyway(false);
    setOpen(true);
    load();
  }

  function send() {
    if (!preview?.startDate) return;
    setError(null);
    const expectedStart = preview.startDate;
    startSending(async () => {
      const r = await callAction(() => sendStartNoticeAction({ projectId, kind, variant: preview.variant, subject, body, expectedStart, sendAnyway }));
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const message = r.message ?? "Sent";
      setSent(message);
      onSent?.(message);
    });
  }

  const canSend = !!preview && !preview.blocked && !!subject.trim() && !!body.trim() && (!preview.pastStart || sendAnyway) && !sending && !sent;
  const dates = preview ? datesLine(kind, preview) : null;

  return (
    <>
      {showButton && (
        <Button variant={variant} size="sm" onClick={openDialog}>
          <Send className="size-4" aria-hidden /> {label}
        </Button>
      )}
      <Dialog
        open={open}
        onClose={innerDialogClose(() => setOpen(false))}
        title={title ?? TITLE[kind]}
        description="Check the email, change the wording if you like, then press Send."
        className="w-[min(40rem,calc(100vw-2rem))]"
        footer={
          sent ? (
            <Button onClick={() => setOpen(false)} data-autofocus>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={send} disabled={!canSend} data-testid="start-notice-send">
                <Send className="size-4" aria-hidden /> {sending ? "Sending…" : "Send"}
              </Button>
            </>
          )
        }
      >
        <div className="space-y-4 text-sm" data-testid="start-notice-dialog">
          {!preview && loading && <p className="text-muted">Preparing the email…</p>}
          {sent && (
            <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-success" data-testid="start-notice-result">{sent}</p>
          )}
          {preview && (
            <>
              <div className="space-y-1">
                <p data-testid="start-notice-to">
                  <span className="text-muted">To: </span>
                  {preview.to ?? <span className="text-danger">No email address on file</span>}
                </p>
                {dates && <p className="font-medium" data-testid="start-notice-dates">{dates}</p>}
              </div>

              {preview.problems.length > 0 && (
                <ul className="space-y-1 rounded-md bg-warning-soft px-3 py-2 text-warning" aria-label="Problems">
                  {preview.problems.map((p) => <li key={p}>{p}</li>)}
                </ul>
              )}
              {preview.pastStart && !preview.blocked && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={sendAnyway} onChange={(e) => setSendAnyway(e.target.checked)} className="size-4" />
                  Send anyway
                </label>
              )}

              <fieldset disabled={!!sent || loading}>
                <legend className="mb-1 text-sm font-medium">Wording</legend>
                <div className="flex gap-4">
                  {(["interior", "exterior"] as const).map((v) => (
                    <label key={v} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`notice-variant-${projectId}`}
                        value={v}
                        checked={preview.variant === v}
                        onChange={() => load(v)}
                        className="size-4"
                      />
                      {v === "interior" ? "Interior" : "Exterior (mentions weather)"}
                    </label>
                  ))}
                </div>
                {loading && <p className="mt-1 text-xs text-muted">Updating the wording…</p>}
              </fieldset>

              <Field label="Subject">
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} disabled={!!sent} />
              </Field>
              <Field label="Message">
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} maxLength={10_000} disabled={!!sent} />
              </Field>
            </>
          )}
          <FormError message={error} />
        </div>
      </Dialog>
    </>
  );
}
