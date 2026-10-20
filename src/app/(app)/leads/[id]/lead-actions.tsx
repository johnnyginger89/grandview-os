"use client";
import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { Button, FormError, Select, Textarea } from "@/components/ui";
import { addNoteAction, moveStageAction, previewBookingEmailAction, sendBookingLinkAction } from "../actions";

export function StageSelect({ opportunityId, stageId, stages, lostReasons }: { opportunityId: string; stageId: string; stages: { id: string; name: string; kind: string }[]; lostReasons: string[] }) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState(stageId);
  const [askLost, setAskLost] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function commit(id: string, reason?: string) {
    start(async () => {
      const r = await moveStageAction(opportunityId, id, reason);
      if (!r.ok) setError(r.error);
      else setValue(id);
      setAskLost(null);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Stage"
        value={value}
        disabled={pending}
        className="w-auto"
        onChange={(e) => {
          const s = stages.find((x) => x.id === e.target.value);
          if (s?.kind === "lost") setAskLost(s.id);
          else commit(e.target.value);
        }}
      >
        {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      {askLost && (
        <>
          <Select id="lost-reason-detail" className="w-auto" defaultValue={lostReasons[0]}>{lostReasons.map((r) => <option key={r}>{r}</option>)}</Select>
          <Button onClick={() => commit(askLost, (document.getElementById("lost-reason-detail") as HTMLSelectElement).value)}>Mark lost</Button>
          <Button variant="ghost" onClick={() => setAskLost(null)}>Cancel</Button>
        </>
      )}
      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  );
}

export function BookingLinkButton({ opportunityId, hasEmail }: { opportunityId: string; hasEmail: boolean }) {
  const [preview, setPreview] = useState<{ to: string | null; subject: string; body: string; bookingUrlConfigured: boolean } | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  if (!hasEmail) return <p className="text-sm text-muted">Add an email address to send the booking link.</p>;

  if (result?.ok) return <p className="text-sm text-success">{result.text}</p>;

  if (!preview) {
    return (
      <Button className="w-full" disabled={pending} onClick={() => start(async () => setPreview(await previewBookingEmailAction(opportunityId)))}>
        <Send className="size-4" /> Send booking link
      </Button>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-md border border-border bg-surface-2 p-3">
        <p className="text-xs text-muted">To: {preview.to}</p>
        <p className="mt-1 font-medium">{preview.subject}</p>
        <p className="mt-2 whitespace-pre-wrap text-muted">{preview.body}</p>
      </div>
      {!preview.bookingUrlConfigured && <FormError message="Your YouCanBook.me link isn't set yet. Add it in Settings → Company." />}
      {result && !result.ok && <FormError message={result.text} />}
      <div className="flex gap-2">
        <Button
          disabled={pending || !preview.bookingUrlConfigured}
          onClick={() => start(async () => {
            const r = await sendBookingLinkAction(opportunityId);
            setResult(r.ok ? { ok: true, text: r.message ?? "Sent" } : { ok: false, text: r.error });
          })}
        >
          {pending ? "Sending…" : "Send now"}
        </Button>
        <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
      </div>
    </div>
  );
}

export function ActivityComposer({ opportunityId }: { opportunityId: string }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function save(type: "note" | "call") {
    start(async () => {
      const r = await addNoteAction(opportunityId, text, type);
      if (r.ok) setText("");
      else setError(r.error);
    });
  }
  return (
    <div className="space-y-2">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Add a note or log a call…" />
      <FormError message={error} />
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || !text.trim()} onClick={() => save("note")}>Add note</Button>
        <Button size="sm" variant="secondary" disabled={pending || !text.trim()} onClick={() => save("call")}>Log call</Button>
      </div>
    </div>
  );
}
