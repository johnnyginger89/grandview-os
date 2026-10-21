"use client";
import { CircleCheck } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { markStartConfirmedAction } from "@/app/(app)/schedule/actions";
import { Badge, Button, FormError, Input, type Tone } from "@/components/ui";
import type { IsoDate } from "@/lib/calendar-date";
import { ACTION_LABEL, availableActions, CONFIRMATION_LABEL, needsUpdate, type ConfirmationAction } from "@/lib/schedule/confirmation";
import { CONFIRM_VIA, type ConfirmVia, type NoticeKind, type StartConfirmation } from "@/lib/schedule/constants";
import { callAction } from "./call-action";
import { customerToldText } from "./schedule-text";
import { StartNoticeButton } from "./start-notice-dialog";

const TONE: Record<StartConfirmation, Tone> = {
  none: "neutral",
  week_sent: "info",
  week_confirmed: "brand",
  date_sent: "info",
  date_confirmed: "success",
};

const VIA_LABEL: Record<ConfirmVia, string> = { email: "Email reply", phone: "Phone", text: "Text", in_person: "In person" };

/** Where the customer start-date conversation stands: "Start week sent", "Date confirmed ✓"… */
export function ConfirmationChip({ confirmation, className }: { confirmation: StartConfirmation; className?: string }) {
  return (
    <Badge tone={TONE[confirmation]} className={className} data-testid="confirmation-chip">
      {confirmation === "date_confirmed" && <CircleCheck className="mr-1 size-3" aria-hidden />}
      {CONFIRMATION_LABEL[confirmation]}
    </Badge>
  );
}

/** "Customer was told Mon, Oct 26 · now Wed, Oct 28" when the schedule moved after a notice. */
export function CustomerToldChip({ told, now }: { told: IsoDate; now: IsoDate }) {
  return (
    <Badge tone="warning" data-testid="customer-told-chip">
      {customerToldText(told, now)}
    </Badge>
  );
}

function sendLabel(action: ConfirmationAction, confirmation: StartConfirmation): string {
  if (action === "send_date" && confirmation === "date_sent") return "Resend start date…";
  return ACTION_LABEL[action];
}

/**
 * The customer block of the booking drawer (and the project page): the chip, the
 * notice buttons for the current stage, and "Mark … confirmed" with how they said yes.
 * Buttons appear only for users who may email customers (schedule.write + messages.send).
 */
export function CustomerConfirmation({
  projectId,
  confirmation,
  communicatedStart,
  currentStart,
  canNotify,
  onDone,
}: {
  projectId: string;
  confirmation: StartConfirmation;
  communicatedStart: IsoDate | null;
  /** The project's first work day now (null = nothing booked). */
  currentStart: IsoDate | null;
  canNotify: boolean;
  onDone?: (message: string) => void;
}) {
  const state = { confirmation, communicatedStart };
  const moved = needsUpdate(state, currentStart);
  const actions = availableActions(state, currentStart);
  const [confirming, setConfirming] = useState<NoticeKind | null>(null);
  const [via, setVia] = useState<ConfirmVia>("email");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const show = (a: ConfirmationAction) => !!currentStart && !confirming && actions.includes(a);
  const dateAction: ConfirmationAction = actions.includes("send_update") ? "send_update" : "send_date";

  function confirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!confirming) return;
    setError(null);
    const kind = confirming;
    start(async () => {
      const r = await callAction(() => markStartConfirmedAction({ projectId, kind, via, note: note.trim() || null }));
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setConfirming(null);
      setNote("");
      onDone?.(r.message ?? "Saved");
    });
  }

  return (
    <div className="space-y-3" data-testid="customer-confirmation">
      <div className="flex flex-wrap items-center gap-2">
        <ConfirmationChip confirmation={confirmation} />
        {moved && communicatedStart && currentStart && <CustomerToldChip told={communicatedStart} now={currentStart} />}
      </div>
      {!currentStart && <p className="text-sm text-muted">Book the work first, then send the customer their start date.</p>}

      {canNotify && (
        <div className="flex flex-wrap gap-2">
          {/* The two send buttons stay mounted so their dialog survives the stage change after a send. */}
          <StartNoticeButton
            projectId={projectId}
            kind="start_week"
            label={ACTION_LABEL.send_week}
            variant={actions[0] === "send_week" ? "primary" : "secondary"}
            showButton={show("send_week")}
            onSent={onDone}
          />
          {(["confirm_week", "confirm_date"] as const).filter(show).map((a) => (
            <Button key={a} size="sm" variant="secondary" onClick={() => { setConfirming(a === "confirm_week" ? "start_week" : "start_date"); setError(null); }}>
              {ACTION_LABEL[a]}
            </Button>
          ))}
          <StartNoticeButton
            projectId={projectId}
            kind="start_date"
            label={sendLabel(dateAction, confirmation)}
            title={dateAction === "send_update" ? "Send updated start date" : undefined}
            variant={actions[0] === dateAction ? "primary" : "secondary"}
            showButton={show(dateAction)}
            onSent={onDone}
          />
        </div>
      )}

      {confirming && (
        <form onSubmit={confirm} className="space-y-3 rounded-md border border-border bg-surface-2 p-3">
          <fieldset>
            <legend className="mb-1 text-sm font-medium">How did they confirm the {confirming === "start_week" ? "week" : "date"}?</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {CONFIRM_VIA.map((v) => (
                <label key={v} className="flex items-center gap-2 text-sm">
                  <input type="radio" name={`confirm-via-${projectId}`} value={v} checked={via === v} onChange={() => setVia(v)} className="size-4" />
                  {VIA_LABEL[v]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Note (optional)</span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Called Tuesday, works for them" />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Mark confirmed"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(null)} disabled={pending}>Cancel</Button>
          </div>
        </form>
      )}
      <FormError message={error} />
    </div>
  );
}
