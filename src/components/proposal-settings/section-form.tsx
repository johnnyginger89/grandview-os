"use client";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { resetProposalTemplateSectionAction, saveProposalTemplateSectionAction } from "@/app/(app)/settings/proposals/actions";
import { Button, Card, CardHeader } from "@/components/ui";
import type { SectionKey } from "@/lib/proposal-template/schema";
import { useEditor } from "./editor-context";
import { Fields, setAt, type FieldSpec } from "./fields";

/** Holds one section's value, with Save / Discard / Reset and an unsaved-changes guard. */
export function useSectionValue<T>(section: SectionKey, initial: T, defaults: T) {
  const { version, setVersion } = useEditor();
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = () =>
    start(async () => {
      const r = await saveProposalTemplateSectionAction(section, value, version);
      if (r.ok) {
        setVersion(r.updatedAt);
        setSaved(value);
        setMessage({ ok: true, text: "Saved. Proposals already sent show the new pictures and wording right away; the estimate and contract on them don't change." });
      } else setMessage({ ok: false, text: r.error });
    });
  const discard = () => {
    setValue(saved);
    setMessage(null);
  };
  const reset = () => {
    if (!window.confirm("Put this section back to the original wording and pictures? Your changes here will be lost.")) return;
    start(async () => {
      const r = await resetProposalTemplateSectionAction(section, version);
      if (r.ok) {
        setVersion(r.updatedAt);
        setSaved(defaults);
        setValue(defaults);
        setMessage({ ok: true, text: "Section reset to the default." });
      } else setMessage({ ok: false, text: r.error });
    });
  };
  return { value, setValue, dirty, pending, message, save, discard, reset };
}

export function SaveBar({ dirty, pending, message, save, discard, reset }: { dirty: boolean; pending: boolean; message: { ok: boolean; text: string } | null; save: () => void; discard: () => void; reset: () => void }) {
  return (
    <div className="sticky bottom-[var(--app-bottom)] z-10 -mx-4 mt-6 flex flex-wrap items-center gap-3 border-t border-border bg-surface px-4 py-3">
      <Button onClick={save} disabled={!dirty || pending}>{pending ? "Saving…" : "Save"}</Button>
      <Button variant="secondary" onClick={discard} disabled={!dirty || pending}>Discard</Button>
      {dirty && <span className="text-sm text-warning">Unsaved changes</span>}
      {message && <span className={`text-sm ${message.ok ? "text-success" : "text-danger"}`} role={message.ok ? "status" : "alert"}>{message.text}</span>}
      <button type="button" onClick={reset} disabled={pending} className="ml-auto text-sm text-muted underline-offset-2 hover:text-text hover:underline">Reset section to default</button>
    </div>
  );
}

export function SectionForm({
  section,
  title,
  description,
  initial,
  defaults,
  specs,
  children,
}: {
  section: SectionKey;
  title: string;
  description?: string;
  initial: unknown;
  defaults: unknown;
  specs: FieldSpec[];
  children?: ReactNode;
}) {
  const s = useSectionValue<unknown>(section, initial, defaults);
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="px-4 pt-4">
        {children}
        <Fields specs={specs} ctx={{ value: s.value, set: (p, v) => s.setValue((cur: unknown) => setAt(cur, p, v)), defaults, tokenBase: section }} />
        <SaveBar {...s} />
      </div>
    </Card>
  );
}
