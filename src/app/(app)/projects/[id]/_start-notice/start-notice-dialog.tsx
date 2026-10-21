"use client";
import { useCallback, useEffect, useState, useTransition, type ReactNode } from "react";
import { Dialog } from "@/components/dialog";
import { Button, Field, FormError, Input, Textarea } from "@/components/ui";
import type { NoticeKind, NoticeVariant } from "@/lib/schedule/constants";
import { longDay, workingDaysLabel } from "@/lib/schedule/format";
import type { NoticePreview } from "@/lib/schedule/types";
import { previewStartNoticeAction, sendStartNoticeAction } from "./actions";

export interface NoticeRequest {
  kind: NoticeKind;
  /** Dialog title, e.g. "Send start week". */
  title: string;
}

function datesLine(p: NoticePreview, kind: NoticeKind): string | null {
  if (kind === "start_week") return p.weekOf ? `Start week of ${longDay(p.weekOf)}` : null;
  if (!p.startDate) return null;
  const finish = p.endDate && p.endDate !== p.startDate ? ` · finish around ${longDay(p.endDate)}` : "";
  return `Start ${longDay(p.startDate)} · about ${workingDaysLabel(p.workingDays)}${finish}`;
}

/** Mounted only while the dialog is open, so every opening starts from a fresh server preview. */
function NoticeBody({ projectId, kind, onClose }: { projectId: string; kind: NoticeKind; onClose: () => void }) {
  const [preview, setPreview] = useState<NoticePreview | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sendAnyway, setSendAnyway] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [pending, start] = useTransition();

  const compose = useCallback(
    (wording?: NoticeVariant) =>
      start(async () => {
        const r = await previewStartNoticeAction({ projectId, kind, variant: wording });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setPreview(r.preview);
        setSubject(r.preview.subject);
        setBody(r.preview.body);
      }),
    [projectId, kind],
  );

  useEffect(() => {
    compose();
  }, [compose]);

  const send = () => {
    if (!preview?.startDate) return;
    const expectedStart = preview.startDate;
    setError(null);
    setSending(true);
    start(async () => {
      const r = await sendStartNoticeAction({ projectId, kind, variant: preview.variant, subject, body, expectedStart, sendAnyway });
      setSending(false);
      if (r.ok) {
        setSent(r.message);
        return;
      }
      setError(r.error);
      // The schedule moved while the dialog was open: show the new dates.
      if (r.reason === "stale") compose(preview.variant);
    });
  };

  const canSend = !!preview && !preview.blocked && !!preview.startDate && (!preview.pastStart || sendAnyway) && subject.trim() !== "" && body.trim() !== "" && !pending;
  const dates = preview ? datesLine(preview, kind) : null;
  const footer = (children: ReactNode) => (
    <div className="sticky bottom-0 -mx-5 -mb-4 mt-4 flex flex-wrap justify-end gap-2 border-t border-border bg-surface px-5 py-3">{children}</div>
  );

  if (sent) {
    return (
      <>
        <p role="status" className="text-sm text-success">{sent}</p>
        {footer(<Button onClick={onClose}>Done</Button>)}
      </>
    );
  }

  if (!preview) {
    return (
      <>
        {error ? <FormError message={error} /> : <p className="text-sm text-muted">Preparing the email…</p>}
        {footer(<Button variant="ghost" onClick={onClose}>Cancel</Button>)}
      </>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-1 text-sm">
          <p className="break-all">To: <span className="font-medium">{preview.to ?? "no email on file"}</span></p>
          {dates && <p className="text-muted">{dates}</p>}
        </div>

        {kind === "start_week" && (
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Wording</legend>
            <div className="flex gap-4 text-sm">
              {(["interior", "exterior"] as const).map((v) => (
                <label key={v} className="flex items-center gap-2">
                  <input type="radio" name={`notice-variant-${projectId}`} checked={preview.variant === v} disabled={pending} onChange={() => compose(v)} />
                  {v === "interior" ? "Interior" : "Exterior"}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-subtle">Switching rewrites the email from the template.</p>
          </fieldset>
        )}

        {preview.problems.length > 0 && (
          <ul className="space-y-1 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning" aria-label="Problems">
            {preview.problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}

        <Field label="Subject">
          <Input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value.replace(/[\r\n]/g, " "))} />
        </Field>
        <Field label="Message">
          <Textarea rows={12} maxLength={10_000} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>

        {preview.pastStart && !preview.blocked && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sendAnyway} onChange={(e) => setSendAnyway(e.target.checked)} />
            Send anyway – the start date is in the past
          </label>
        )}
        <FormError message={error} />
      </div>
      {footer(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={send} disabled={!canSend}>{sending ? "Sending…" : "Send"}</Button>
        </>,
      )}
    </>
  );
}

/**
 * "Send start week…" / "Send start date…": a server-composed email the user can
 * edit, then sends with one click (never automatic). The recipient and dates come
 * from the server; the client only picks the wording and edits the text. Keep this
 * mounted while the card refreshes so the result stays on screen after sending.
 */
export function StartNoticeDialog({ projectId, notice, onClose }: { projectId: string; notice: NoticeRequest | null; onClose: () => void }) {
  return (
    <Dialog
      open={notice !== null}
      onClose={onClose}
      title={notice?.title ?? ""}
      description="Check the email, change anything you like, then press Send."
      className="w-[min(40rem,calc(100vw-2rem))]"
    >
      {notice && <NoticeBody projectId={projectId} kind={notice.kind} onClose={onClose} />}
    </Dialog>
  );
}
