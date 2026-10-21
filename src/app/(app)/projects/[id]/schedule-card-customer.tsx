"use client";
import { Send } from "lucide-react";
import { useState, useTransition } from "react";
import { Badge, Button, Field, FormError, Input, Select, type Tone } from "@/components/ui";
import type { IsoDate } from "@/lib/calendar-date";
import { ACTION_LABEL, availableActions, CONFIRMATION_LABEL, needsUpdate, type ConfirmationAction } from "@/lib/schedule/confirmation";
import { CONFIRM_VIA, type ConfirmVia, type NoticeKind, type StartConfirmation } from "@/lib/schedule/constants";
import { shortDay } from "@/lib/schedule/format";
import { StartNoticeDialog, type NoticeRequest } from "./_start-notice/start-notice-dialog";
import { markStartConfirmedAction } from "./schedule-actions";

const TONE: Record<StartConfirmation, Tone> = {
  none: "neutral",
  week_sent: "info",
  week_confirmed: "brand",
  date_sent: "info",
  date_confirmed: "success",
};

const VIA_LABEL: Record<ConfirmVia, string> = { email: "Email reply", phone: "Phone", text: "Text", in_person: "In person" };

const NOTICE: Record<"send_week" | "send_date" | "send_update", { kind: NoticeKind; title: string }> = {
  send_week: { kind: "start_week", title: "Send start week" },
  send_date: { kind: "start_date", title: "Send start date" },
  send_update: { kind: "start_date", title: "Send updated start date" },
};

function ConfirmForm({ projectId, kind, onDone }: { projectId: string; kind: NoticeKind; onDone: (message: string | null) => void }) {
  const [via, setVia] = useState<ConfirmVia>("email");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const r = await markStartConfirmedAction({ projectId, kind, via, note: note.trim() || null });
      if (r.ok) onDone(r.message);
      else setError(r.error);
    });

  return (
    <div className="space-y-3 rounded-md bg-surface-2 p-3">
      <Field label="How did they confirm?">
        <Select value={via} onChange={(e) => setVia(e.target.value as ConfirmVia)} className="max-w-48">
          {CONFIRM_VIA.map((v) => <option key={v} value={v}>{VIA_LABEL[v]}</option>)}
        </Select>
      </Field>
      <Field label="Confirmation note (optional)">
        <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Called Tuesday, all good" />
      </Field>
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : ACTION_LABEL[kind === "start_week" ? "confirm_week" : "confirm_date"]}</Button>
        <Button size="sm" variant="ghost" onClick={() => onDone(null)} disabled={pending}>Cancel</Button>
      </div>
    </div>
  );
}

/** The customer start-date workflow: chip, "customer was told" warning and the notice / confirm buttons. */
export function ScheduleCustomerBlock({
  projectId,
  confirmation,
  communicatedStart,
  firstWorkDay,
  history,
  canNotify,
}: {
  projectId: string;
  confirmation: StartConfirmation;
  communicatedStart: IsoDate | null;
  firstWorkDay: IsoDate | null;
  /** Already formatted, e.g. "Start week email sent Oct 20, 2026". */
  history: string[];
  canNotify: boolean;
}) {
  const [confirming, setConfirming] = useState<NoticeKind | null>(null);
  const [notice, setNotice] = useState<NoticeRequest | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const state = { confirmation, communicatedStart };
  const moved = needsUpdate(state, firstWorkDay);
  const actions = firstWorkDay ? availableActions(state, firstWorkDay) : [];

  const button = (a: ConfirmationAction, i: number) => {
    const variant = i === 0 ? "primary" : "secondary";
    if (a === "confirm_week" || a === "confirm_date") {
      const kind: NoticeKind = a === "confirm_week" ? "start_week" : "start_date";
      return (
        <Button key={a} size="sm" variant={variant} onClick={() => { setConfirming(kind); setMessage(null); }}>
          {ACTION_LABEL[a]}
        </Button>
      );
    }
    return (
      <Button key={a} size="sm" variant={variant} onClick={() => { setNotice(NOTICE[a]); setMessage(null); }}>
        <Send className="size-3.5" aria-hidden /> {ACTION_LABEL[a]}
      </Button>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONE[confirmation]} data-testid="start-confirmation">
          {CONFIRMATION_LABEL[confirmation]}{confirmation === "date_confirmed" ? " ✓" : ""}
        </Badge>
        {moved && communicatedStart && firstWorkDay && (
          <Badge tone="warning">Customer was told {shortDay(communicatedStart)} · now {shortDay(firstWorkDay)}</Badge>
        )}
      </div>
      {history.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted">
          {history.map((h) => <li key={h}>{h}</li>)}
        </ul>
      )}
      {canNotify && !firstWorkDay && <p className="text-sm text-muted">Book the work first, then let the customer know when you&apos;re starting.</p>}
      {canNotify && actions.length > 0 && !confirming && <div className="flex flex-wrap gap-2">{actions.map(button)}</div>}
      {canNotify && confirming && (
        <ConfirmForm
          projectId={projectId}
          kind={confirming}
          onDone={(m) => {
            setConfirming(null);
            setMessage(m);
          }}
        />
      )}
      {message && <p role="status" className="text-sm text-success">{message}</p>}
      {canNotify && <StartNoticeDialog projectId={projectId} notice={notice} onClose={() => setNotice(null)} />}
    </div>
  );
}
