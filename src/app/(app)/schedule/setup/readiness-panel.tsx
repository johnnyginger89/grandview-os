"use client";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { Button, Card, CardHeader, Field, FormError, Input, Select } from "@/components/ui";
import { READINESS_STATES, SCHEDULE_ENTRY_KINDS, type ReadinessState, type ScheduleEntryKind } from "@/lib/schedule/constants";
import { KIND_LABEL } from "@/lib/schedule/format";
import type { ReadinessCheck, ScheduleSettings } from "@/lib/schedule/settings-schema";
import { saveScheduleSettingsAction, type SetupResult } from "./actions";

const MAX_CHECKS = 12;

const STEP_LABEL: Record<ReadinessState, string> = { todo: "Not started", in_progress: "Under way", done: "Done", not_needed: "Not needed" };

interface CheckDraft extends Omit<ReadinessCheck, "key"> {
  uid: string;
  /** Null for a check added here; a key is made from its name on save. Existing keys never change, so answers stay linked. */
  key: string | null;
}

function slug(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
}

function withKeys(drafts: CheckDraft[]): ReadinessCheck[] {
  const used = new Set(drafts.flatMap((c) => (c.key ? [c.key] : [])));
  return drafts.map((c) => {
    let key = c.key;
    if (!key) {
      const base = slug(c.label).length >= 2 ? slug(c.label) : "check";
      key = base;
      for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
      used.add(key);
    }
    return {
      key,
      label: c.label.trim(),
      states: { todo: c.states.todo.trim(), in_progress: c.states.in_progress.trim(), done: c.states.done.trim(), not_needed: c.states.not_needed.trim() },
      linkedEntryKind: c.linkedEntryKind,
    };
  });
}

function problem(drafts: CheckDraft[]): string | null {
  for (const [i, c] of drafts.entries()) {
    const name = c.label.trim() || `Check ${i + 1}`;
    if (!c.label.trim()) return `Check ${i + 1} needs a name.`;
    if (READINESS_STATES.some((s) => !c.states[s].trim())) return `“${name}” needs a name for every step.`;
  }
  return null;
}

/** The "Ready to schedule?" checks every job gets. They warn on the calendar, never block. */
export function ReadinessPanel({ settings }: { settings: ScheduleSettings }) {
  const [checks, setChecks] = useState<CheckDraft[]>(() => settings.readinessChecks.map((c) => ({ ...c, states: { ...c.states }, uid: c.key })));
  const [nextId, setNextId] = useState(1);
  const [result, setResult] = useState<SetupResult | null>(null);
  const [pending, start] = useTransition();

  const update = (uid: string, patch: Partial<CheckDraft>) => {
    setChecks((cur) => cur.map((c) => (c.uid === uid ? { ...c, ...patch } : c)));
    setResult(null);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= checks.length) return;
    const next = [...checks];
    [next[i], next[j]] = [next[j], next[i]];
    setChecks(next);
    setResult(null);
  };
  const remove = (c: CheckDraft) => {
    if (!window.confirm(`Remove “${c.label || "this check"}”? Answers already given on jobs are kept but hidden.`)) return;
    setChecks((cur) => cur.filter((x) => x.uid !== c.uid));
    setResult(null);
  };
  const add = () => {
    setChecks((cur) => [
      ...cur,
      { uid: `new-${nextId}`, key: null, label: "", states: { todo: "To do", in_progress: "In progress", done: "Done", not_needed: "Not needed" }, linkedEntryKind: null },
    ]);
    setNextId((n) => n + 1);
    setResult(null);
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const p = problem(checks);
    if (p) return setResult({ ok: false, error: p });
    start(async () => {
      const r = await saveScheduleSettingsAction({ ...settings, readinessChecks: withKeys(checks) });
      setResult(r);
      // New checks now have keys; keep them so a second save doesn't add them again.
      if (r.ok) setChecks((cur) => withKeys(cur).map((c, i) => ({ ...c, uid: cur[i].uid })));
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Readiness checks">
      <Card>
        <CardHeader
          title="Readiness checks"
          description="What has to be sorted before a job starts. Each job shows these on its Schedule card, and the calendar warns about jobs that aren't ready (it never blocks them)."
        />
        <div className="space-y-3 p-4">
          {checks.length === 0 && <p className="text-sm text-muted">No checks. Jobs will always count as ready.</p>}
          {checks.map((c, i) => (
            <div key={c.uid} role="group" aria-label={`Check ${i + 1}`} className="space-y-3 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Check name" className="min-w-48 flex-1">
                  <Input value={c.label} maxLength={60} onChange={(e) => update(c.uid, { label: e.target.value })} placeholder="e.g. Deposit received" />
                </Field>
                <Field label="Updates itself" className="min-w-48">
                  <Select value={c.linkedEntryKind ?? ""} onChange={(e) => update(c.uid, { linkedEntryKind: (e.target.value || null) as ScheduleEntryKind | null })}>
                    <option value="">No</option>
                    {SCHEDULE_ENTRY_KINDS.map((k) => <option key={k} value={k}>When “{KIND_LABEL[k]}” is booked</option>)}
                  </Select>
                </Field>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="px-2" aria-label={`Move ${c.label || `check ${i + 1}`} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="size-4" aria-hidden />
                  </Button>
                  <Button size="sm" variant="ghost" className="px-2" aria-label={`Move ${c.label || `check ${i + 1}`} down`} disabled={i === checks.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown className="size-4" aria-hidden />
                  </Button>
                  <Button size="sm" variant="ghost" className="px-2" aria-label={`Remove ${c.label || `check ${i + 1}`}`} onClick={() => remove(c)}>
                    <X className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs text-subtle">What to call each step (you pick one on every job):</p>
                <div className="grid gap-2 sm:grid-cols-4">
                  {READINESS_STATES.map((s) => (
                    <Field key={s} label={STEP_LABEL[s]}>
                      <Input value={c.states[s]} maxLength={30} onChange={(e) => update(c.uid, { states: { ...c.states, [s]: e.target.value } })} />
                    </Field>
                  ))}
                </div>
                {c.linkedEntryKind && (
                  <p className="mt-1 text-xs text-subtle">
                    Booking “{KIND_LABEL[c.linkedEntryKind]}” moves this from “{c.states.todo || STEP_LABEL.todo}” to “{c.states.in_progress || STEP_LABEL.in_progress}”.
                  </p>
                )}
              </div>
            </div>
          ))}
          <Button variant="secondary" size="sm" disabled={checks.length >= MAX_CHECKS} onClick={add}>
            <Plus className="size-4" aria-hidden /> Add check
          </Button>
          {checks.length >= MAX_CHECKS && <p className="text-xs text-subtle">You can have up to {MAX_CHECKS} checks.</p>}
        </div>
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save readiness checks"}</Button>
        {result?.ok && <span role="status" className="text-sm text-success">{result.message}</span>}
      </div>
      {result && !result.ok && <FormError message={result.error} />}
    </form>
  );
}
