"use client";
import { ArrowDown, ArrowUp, Plus, Star } from "lucide-react";
import { useId, useState, useTransition, type FormEvent } from "react";
import { Button, Card, CardHeader, Field, FormError, Input, Select, Table, Textarea, td, th } from "@/components/ui";
import { CREW_COLOR_CLASSES, CREW_COLOR_LABEL, crewColorClasses } from "@/lib/schedule/colors";
import { CREW_COLORS, CREW_KINDS, CREW_TRADES, type CrewColor, type CrewKind, type CrewTrade } from "@/lib/schedule/constants";
import { CREW_KIND_LABEL, CREW_TRADE_LABEL } from "@/lib/schedule/format";
import type { CrewWithMembersDTO } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";
import { reorderCrewsAction, saveCrewAction, setCrewActiveAction } from "./actions";

export interface MemberOption {
  id: string;
  name: string;
  roleLabel: string;
  /** Crew leader, painter or subcontractor login. */
  field: boolean;
}

interface Member {
  userId: string;
  isLead: boolean;
}

interface Draft {
  id?: string;
  name: string;
  kind: CrewKind;
  trade: CrewTrade;
  subCompany: string;
  color: CrewColor;
  crewSize: string;
  hoursPerDay: string;
  worksSaturdays: boolean;
  notes: string;
  members: Member[];
}

const HOURS_RE = /^\d{1,2}(\.\d{1,2})?$/;

/** "8.00" → "8", "7.50" → "7.5". */
function hoursText(h: string): string {
  return h.includes(".") ? h.replace(/0+$/, "").replace(/\.$/, "") : h;
}

function draftProblem(d: Draft): string | null {
  if (!d.name.trim()) return "Give the crew a name.";
  const size = Number(d.crewSize);
  if (!/^\d+$/.test(d.crewSize.trim()) || size < 1 || size > 50) return "Crew size is the number of people: 1 to 50.";
  const h = d.hoursPerDay.trim();
  if (!HOURS_RE.test(h) || Number(h) <= 0 || Number(h) > 24) return "Hours per day must be a number like 8 or 7.5.";
  return null;
}

function ActiveSwitch({ crew, onError }: { crew: CrewWithMembersDTO; onError: (message: string | null) => void }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={crew.active}
      aria-label={`Active: ${crew.name}`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          onError(null);
          const r = await setCrewActiveAction({ id: crew.id, active: !crew.active });
          if (!r.ok) onError(`${crew.name} can't be turned off yet. ${r.error}`);
        })
      }
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50", crew.active ? "bg-success" : "bg-border-strong")}
    >
      <span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform", crew.active ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}

function MembersCell({ crew }: { crew: CrewWithMembersDTO }) {
  if (!crew.members.length) return <span className="text-muted">No logins yet</span>;
  return (
    <span>
      {crew.members.map((m, i) => (
        <span key={m.userId} className={cn(!m.active && "text-muted line-through")}>
          {i > 0 && ", "}
          {m.isLead && <span aria-hidden>★ </span>}
          {m.name}
          {m.isLead && <span className="sr-only"> (lead)</span>}
          {!m.active && " (inactive)"}
        </span>
      ))}
    </span>
  );
}

function CrewForm({
  initial,
  users,
  dropped,
  onSaved,
  onCancel,
}: {
  initial: Draft;
  users: MemberOption[];
  /** Members who can't stay (inactive logins). */
  dropped: string[];
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const colorName = useId();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((cur) => ({ ...cur, [key]: value }));

  const isMember = (id: string) => d.members.some((m) => m.userId === id);
  const isLead = (id: string) => d.members.some((m) => m.userId === id && m.isLead);
  const toggleMember = (id: string, on: boolean) =>
    set("members", on ? [...d.members, { userId: id, isLead: false }] : d.members.filter((m) => m.userId !== id));
  const toggleLead = (id: string) => {
    const makeLead = !isLead(id);
    const members = isMember(id) ? d.members : [...d.members, { userId: id, isLead: false }];
    set("members", members.map((m) => ({ ...m, isLead: makeLead && m.userId === id })));
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const problem = draftProblem(d);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    start(async () => {
      const r = await saveCrewAction({
        crew: {
          id: d.id,
          name: d.name.trim(),
          kind: d.kind,
          trade: d.trade,
          subCompany: d.kind === "subcontractor" ? d.subCompany.trim() || null : null,
          color: d.color,
          crewSize: Number(d.crewSize),
          hoursPerDay: d.hoursPerDay.trim(),
          worksSaturdays: d.worksSaturdays,
          notes: d.notes.trim() || null,
        },
        members: d.members,
      });
      if (r.ok) onSaved(r.message);
      else {
        setError(r.error);
        if (r.id) set("id", r.id);
      }
    });
  };

  const field = users.filter((u) => u.field);
  const office = users.filter((u) => !u.field);
  const memberRow = (u: MemberOption) => (
    <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <span className="flex min-w-0 items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isMember(u.id)} onChange={(e) => toggleMember(u.id, e.target.checked)} className="size-4" />
          <span>{u.name}</span>
        </label>
        <span className="text-xs text-muted">{u.roleLabel}</span>
      </span>
      <button
        type="button"
        aria-pressed={isLead(u.id)}
        aria-label={`Crew lead: ${u.name}`}
        onClick={() => toggleLead(u.id)}
        className={cn(
          "inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium",
          isLead(u.id) ? "border-warning bg-warning-soft text-warning" : "border-border text-muted hover:bg-surface-2",
        )}
      >
        <Star className={cn("size-3.5", isLead(u.id) && "fill-current")} aria-hidden /> Lead
      </button>
    </li>
  );

  return (
    <Card>
      <CardHeader title={d.id ? `Edit ${initial.name || "crew"}` : "Add crew"} />
      <form onSubmit={submit} className="space-y-4 p-4" aria-label={d.id ? "Edit crew" : "Add crew"}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={d.name} maxLength={60} required onChange={(e) => set("name", e.target.value)} placeholder="e.g. Niko" />
          </Field>
          <Field label="Type">
            <Select value={d.kind} onChange={(e) => set("kind", e.target.value as CrewKind)}>
              {CREW_KINDS.map((k) => <option key={k} value={k}>{CREW_KIND_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label="Trade">
            <Select value={d.trade} onChange={(e) => set("trade", e.target.value as CrewTrade)}>
              {CREW_TRADES.map((t) => <option key={t} value={t}>{CREW_TRADE_LABEL[t]}</option>)}
            </Select>
          </Field>
          {d.kind === "subcontractor" && (
            <Field label="Sub company">
              <Input value={d.subCompany} maxLength={120} onChange={(e) => set("subCompany", e.target.value)} placeholder="Their business name" />
            </Field>
          )}
          <Field label="Crew size" hint="How many people usually work together. This and the hours set how long jobs are suggested to take.">
            <Input type="number" inputMode="numeric" min={1} max={50} value={d.crewSize} onChange={(e) => set("crewSize", e.target.value)} />
          </Field>
          <Field label="Hours per day" hint="Hours each person works in a day, e.g. 8 or 7.5.">
            <Input inputMode="decimal" value={d.hoursPerDay} onChange={(e) => set("hoursPerDay", e.target.value)} />
          </Field>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Colour</legend>
          <div className="flex flex-wrap gap-2">
            {CREW_COLORS.map((c) => (
              <label key={c} className="relative block size-8" title={CREW_COLOR_LABEL[c]}>
                {/* Invisible but clickable radio laid over the swatch. */}
                <input
                  type="radio"
                  name={colorName}
                  value={c}
                  checked={d.color === c}
                  onChange={() => set("color", c)}
                  className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
                />
                <span className="sr-only">{CREW_COLOR_LABEL[c]}</span>
                <span
                  aria-hidden
                  className={cn(
                    "block size-8 rounded-full ring-offset-2 ring-offset-surface peer-checked:ring-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring",
                    CREW_COLOR_CLASSES[c].dot,
                    CREW_COLOR_CLASSES[c].ring,
                  )}
                />
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-subtle">Selected: {CREW_COLOR_LABEL[d.color]}</p>
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={d.worksSaturdays} onChange={(e) => set("worksSaturdays", e.target.checked)} className="size-4" />
          Works Saturdays
        </label>

        <Field label="Notes (optional)">
          <Textarea rows={2} maxLength={1000} value={d.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Members</legend>
          <p className="text-xs text-subtle">
            People ticked here see this crew&apos;s jobs on My Jobs (address, notes, no prices). The lead also sees the customer&apos;s phone number.
          </p>
          {dropped.length > 0 && (
            <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
              {dropped.join(", ")} {dropped.length === 1 ? "is" : "are"} no longer an active user and will be taken off this crew when you save.
            </p>
          )}
          {users.length === 0 ? (
            <p className="text-sm text-muted">No active users yet. Add logins in Settings → Users.</p>
          ) : (
            <div className="grid gap-x-6 sm:grid-cols-2">
              {field.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-subtle">Field logins</p>
                  <ul className="divide-y divide-border">{field.map(memberRow)}</ul>
                </div>
              )}
              {office.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-subtle">Office</p>
                  <ul className="divide-y divide-border">{office.map(memberRow)}</ul>
                </div>
              )}
            </div>
          )}
        </fieldset>

        <FormError message={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save crew"}</Button>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

export function CrewsPanel({
  crews,
  users,
  defaults,
}: {
  crews: CrewWithMembersDTO[];
  users: MemberOption[];
  defaults: { crewSize: number; hoursPerDay: string };
}) {
  const [editing, setEditing] = useState<{ draft: Draft; dropped: string[] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const [pending, start] = useTransition();

  const byId = new Map(crews.map((c) => [c.id, c]));
  const ordered = (order ?? crews.map((c) => c.id)).map((id) => byId.get(id)).filter((c): c is CrewWithMembersDTO => !!c);
  const activeUserIds = new Set(users.map((u) => u.id));

  const openNew = () => {
    const used = new Set(crews.map((c) => c.color));
    const color = CREW_COLORS.find((c) => !used.has(c)) ?? "sky";
    setMessage(null);
    setEditing({
      draft: { name: "", kind: "in_house", trade: "painting", subCompany: "", color, crewSize: String(defaults.crewSize), hoursPerDay: hoursText(defaults.hoursPerDay), worksSaturdays: false, notes: "", members: [] },
      dropped: [],
    });
  };

  const openEdit = (c: CrewWithMembersDTO) => {
    setMessage(null);
    setEditing({
      draft: {
        id: c.id,
        name: c.name,
        kind: c.kind,
        trade: c.trade,
        subCompany: c.subCompany ?? "",
        color: c.color,
        crewSize: String(c.crewSize),
        hoursPerDay: hoursText(c.hoursPerDay),
        worksSaturdays: c.worksSaturdays,
        notes: c.notes ?? "",
        members: c.members.filter((m) => activeUserIds.has(m.userId)).map((m) => ({ userId: m.userId, isLead: m.isLead })),
      },
      dropped: c.members.filter((m) => !activeUserIds.has(m.userId)).map((m) => m.name),
    });
  };

  const move = (id: string, dir: -1 | 1) => {
    const ids = ordered.map((c) => c.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setOrder(ids);
    setError(null);
    start(async () => {
      const r = await reorderCrewsAction({ ids });
      setOrder(null);
      if (!r.ok) setError(r.error);
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Crews"
          description="Each crew is a row on the calendar. Use the arrows to set the order."
          action={!editing && <Button size="sm" onClick={openNew}><Plus className="size-4" aria-hidden /> Add crew</Button>}
        />
        {message && <p role="status" className="px-4 pt-3 text-sm text-success">{message}</p>}
        {error && <div className="px-4 pt-3"><FormError message={error} /></div>}
        {ordered.length === 0 ? (
          <p className="p-4 text-sm text-muted">No crews yet. Click Add crew to create your first one.</p>
        ) : (
          <Table aria-label="Crews">
            <thead>
              <tr>
                <th className={th}>Crew</th>
                <th className={th}>Type</th>
                <th className={th}>Size</th>
                <th className={th}>Saturdays</th>
                <th className={th}>Members</th>
                <th className={th}>Active</th>
                <th className={th}><span className="sr-only">Order and edit</span></th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((c, i) => (
                <tr key={c.id} className={cn(!c.active && "bg-surface-2/60")}>
                  <td className={td}>
                    <span className="inline-flex items-center gap-2 font-medium">
                      <span className={cn("size-3 shrink-0 rounded-full", crewColorClasses(c.color).dot)} aria-hidden />
                      {c.name}
                    </span>
                    {!c.active && <span className="ml-2 text-xs text-muted">(off)</span>}
                  </td>
                  <td className={td}>
                    {CREW_KIND_LABEL[c.kind]}
                    {c.subCompany && <span className="block text-xs text-muted">{c.subCompany}</span>}
                    {c.trade !== "painting" && <span className="block text-xs text-muted">{CREW_TRADE_LABEL[c.trade]}</span>}
                  </td>
                  <td className={cn(td, "whitespace-nowrap tabular-nums")}>{c.crewSize} × {hoursText(c.hoursPerDay)} h</td>
                  <td className={td}>{c.worksSaturdays ? "Yes" : "No"}</td>
                  <td className={cn(td, "min-w-40")}><MembersCell crew={c} /></td>
                  <td className={td}><ActiveSwitch crew={c} onError={setError} /></td>
                  <td className={cn(td, "whitespace-nowrap text-right")}>
                    <span className="inline-flex items-center gap-1">
                      <Button size="sm" variant="ghost" className="px-2" aria-label={`Move ${c.name} up`} disabled={pending || i === 0} onClick={() => move(c.id, -1)}>
                        <ArrowUp className="size-4" aria-hidden />
                      </Button>
                      <Button size="sm" variant="ghost" className="px-2" aria-label={`Move ${c.name} down`} disabled={pending || i === ordered.length - 1} onClick={() => move(c.id, 1)}>
                        <ArrowDown className="size-4" aria-hidden />
                      </Button>
                      <Button size="sm" variant="secondary" disabled={!!editing} onClick={() => openEdit(c)}>
                        Edit<span className="sr-only"> {c.name}</span>
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing && (
        <CrewForm
          key={editing.draft.id ?? "new"}
          initial={editing.draft}
          users={users}
          dropped={editing.dropped}
          onCancel={() => setEditing(null)}
          onSaved={(m) => {
            setEditing(null);
            setMessage(m);
          }}
        />
      )}
    </div>
  );
}
