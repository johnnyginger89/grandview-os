"use client";
import { ArrowDown, ArrowUp, Check, Copy, Plus, Trash2 } from "lucide-react";
import { useId, useMemo, useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import { Dialog } from "@/components/dialog";
import { Badge, Button, buttonClass, Card, CardHeader, Field, FormError, Input, Select, Textarea, type Tone } from "@/components/ui";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { daysLeft } from "@/lib/work-orders/links";
import { LINK_DAY_CHOICES, MAX_CHECKLIST_ITEMS, MAX_CHECKLIST_TEXT, MAX_LINK_DAYS } from "@/lib/work-orders/schemas";
import { SECTION_LABEL, STATUS_LABEL, type NewWorkOrderDefaults, type WorkOrderDTO, type WorkOrderFieldsDTO, type WorkOrderLinkDTO } from "@/lib/work-orders/types";
import { cancelWorkOrderAction, createShareLinkAction, createWorkOrderAction, issueWorkOrderAction, revokeShareLinkAction, updateWorkOrderAction } from "./work-order-actions";

type CrewOption = { id: string; name: string };
type Flash = { ok: boolean; text: string } | null;
type DialogState = { kind: "new" } | { kind: "edit"; wo: WorkOrderDTO } | { kind: "issue"; wo: WorkOrderDTO } | { kind: "link"; wo: WorkOrderDTO } | null;

const STATUS_TONE: Record<WorkOrderDTO["status"], Tone> = { draft: "neutral", issued: "success", cancelled: "danger" };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sectionList = (s: readonly (keyof typeof SECTION_LABEL)[]) => s.map((x) => SECTION_LABEL[x]).join(", ");
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2, 14));

// ---------------------------------------------------------------------------
// Share links are stored hashed, so a link can only be copied again from the
// browser that created it, until that tab session ends (sessionStorage).
// ---------------------------------------------------------------------------

const LINKS_KEY = "grandview.shareUrls";
const LINKS_EVENT = "grandview:work-order-links";

function readLinks(): string {
  try {
    return sessionStorage.getItem(LINKS_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberLink(linkId: string, url: string) {
  try {
    const all = JSON.parse(readLinks() || "{}") as Record<string, string>;
    sessionStorage.setItem(LINKS_KEY, JSON.stringify({ ...all, [linkId]: url }));
    window.dispatchEvent(new Event(LINKS_EVENT));
  } catch {
    // Storage blocked: the link can still be copied from the dialog right now.
  }
}

function subscribeLinks(onChange: () => void) {
  window.addEventListener(LINKS_EVENT, onChange);
  return () => window.removeEventListener(LINKS_EVENT, onChange);
}

function useRememberedLinks(): Record<string, string> {
  const raw = useSyncExternalStore(subscribeLinks, readLinks, () => "");
  return useMemo(() => {
    try {
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  }, [raw]);
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", text);
    }
  }
  return (
    <Button size="sm" variant="secondary" onClick={copy}>
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied ? "Copied" : label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export function WorkOrdersPanel({
  projectId,
  canEdit,
  workOrders,
  defaults,
  crews,
  now,
  className,
}: {
  projectId: string;
  canEdit: boolean;
  workOrders: WorkOrderDTO[];
  defaults: NewWorkOrderDefaults;
  crews: CrewOption[];
  /** Server time (ISO), so link expiry text matches the server render. */
  now: string;
  className?: string;
}) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [busy, start] = useTransition();
  const remembered = useRememberedLinks();
  const close = () => setDialog(null);
  const done = (text: string) => {
    setDialog(null);
    setFlash({ ok: true, text });
  };

  function run(action: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) {
    start(async () => {
      const r = await action();
      setFlash(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    });
  }

  const newFields: WorkOrderFieldsDTO = {
    title: defaults.title,
    crewId: null,
    specialInstructions: "",
    equipment: "",
    safetyNotes: "",
    accessNotes: defaults.accessNotes,
    showCustomerPhone: false,
    checklist: defaults.checklist,
  };

  return (
    <Card id="work-orders" className={cn("scroll-mt-[calc(var(--app-top)+1rem)]", className)} role="region" aria-label="Work orders">
      <CardHeader
        title="Work orders"
        description="What each crew needs on site: dates, address, scope, colours and instructions. Never prices or hours."
        action={
          canEdit ? (
            <Button size="sm" onClick={() => setDialog({ kind: "new" })}>
              <Plus className="size-4" aria-hidden /> New work order
            </Button>
          ) : undefined
        }
      />
      <div aria-live="polite">
        {flash && (
          <p role={flash.ok ? "status" : "alert"} className={`mx-4 mt-3 rounded-md px-3 py-2 text-sm ${flash.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
            {flash.text}
          </p>
        )}
      </div>
      {!defaults.hasSignedEstimate && (
        <p className="mx-4 mt-3 rounded-md bg-info-soft px-3 py-2 text-sm text-info">
          This job has no signed estimate in Grandview OS, so its work orders have no scope list. Write what the crew needs in the special instructions.
        </p>
      )}
      {workOrders.length === 0 ? (
        <p className="p-4 text-sm text-muted">
          No work orders yet.{canEdit ? " Create one for the crew: it pulls in the signed scope, colours, the schedule and the address. Subcontractors without a login can get a share link." : ""}
        </p>
      ) : (
        <ul>
          {workOrders.map((wo) => (
            <WorkOrderRow
              key={wo.id}
              wo={wo}
              projectId={projectId}
              canEdit={canEdit}
              busy={busy}
              now={now}
              remembered={remembered}
              onEdit={() => setDialog({ kind: "edit", wo })}
              onIssue={() => setDialog({ kind: "issue", wo })}
              onLink={() => setDialog({ kind: "link", wo })}
              onCancel={() => {
                if (window.confirm(`Cancel ${wo.number}? Crews will no longer be able to open it, and its share links stop working.`)) run(() => cancelWorkOrderAction({ id: wo.id }));
              }}
              onRevoke={(l) => {
                if (window.confirm(`Turn off the link for “${l.label}”? Anyone who opens it will be told to ask the office for a new one.`)) run(() => revokeShareLinkAction({ linkId: l.id }));
              }}
            />
          ))}
        </ul>
      )}

      {dialog?.kind === "new" && (
        <WorkOrderFormDialog mode="new" projectId={projectId} initial={newFields} crews={crews} onClose={close} onDone={done} />
      )}
      {dialog?.kind === "edit" && (
        <WorkOrderFormDialog
          mode="edit"
          projectId={projectId}
          workOrder={dialog.wo}
          initial={dialog.wo.fields}
          crews={dialog.wo.crewId && !crews.some((c) => c.id === dialog.wo.crewId) ? [...crews, { id: dialog.wo.crewId, name: dialog.wo.crewName ?? "Current crew" }] : crews}
          onClose={close}
          onDone={done}
        />
      )}
      {dialog?.kind === "issue" && <IssueDialog wo={dialog.wo} onClose={close} onDone={done} />}
      {dialog?.kind === "link" && <LinkDialog wo={dialog.wo} defaultDays={defaults.linkDays} onClose={close} onCreated={(m) => setFlash({ ok: true, text: m })} />}
    </Card>
  );
}

function LinkRow({ l, wo, canEdit, busy, now, url, onRevoke }: { l: WorkOrderLinkDTO; wo: WorkOrderDTO; canEdit: boolean; busy: boolean; now: string; url: string | undefined; onRevoke: () => void }) {
  const active = l.status === "active";
  const left = daysLeft(l.expiresAt, new Date(now));
  const state =
    l.status === "revoked" ? `Turned off ${formatDate(l.revokedAt)}`
    : l.status === "expired" ? `Expired ${formatDate(l.expiresAt)}`
    : `Works until ${formatDate(l.expiresAt)}${left <= 7 ? ` (${plural(left, "day")} left)` : ""}`;
  const opens = l.openCount ? `Opened ${plural(l.openCount, "time")}, last ${formatDateTime(l.lastOpenedAt)}` : "Not opened yet";
  const seen = wo.status === "issued" && active && l.openCount > 0 ? l.lastOpenedVersion === wo.currentVersion : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-sm" data-testid="work-order-link">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {l.label}
          {!active && <Badge tone="neutral">{l.status === "revoked" ? "Turned off" : "Expired"}</Badge>}
          {seen === true && <Badge tone="success">Seen version {wo.currentVersion}</Badge>}
          {seen === false && <Badge tone="warning">Not yet opened since version {wo.currentVersion}</Badge>}
        </p>
        <p className="text-xs text-muted">
          {state} · {opens}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {active && url && <CopyButton text={url} label="Copy link" />}
        {canEdit && active && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onRevoke} aria-label={`Revoke link for ${l.label}`}>
            Revoke
          </Button>
        )}
      </div>
    </li>
  );
}

function WorkOrderRow({
  wo,
  projectId,
  canEdit,
  busy,
  now,
  remembered,
  onEdit,
  onIssue,
  onLink,
  onCancel,
  onRevoke,
}: {
  wo: WorkOrderDTO;
  projectId: string;
  canEdit: boolean;
  busy: boolean;
  now: string;
  remembered: Record<string, string>;
  onEdit: () => void;
  onIssue: () => void;
  onLink: () => void;
  onCancel: () => void;
  onRevoke: (l: WorkOrderLinkDTO) => void;
}) {
  const base = `/projects/${projectId}/work-orders/${wo.id}`;
  const open = wo.status !== "cancelled";
  const activeLinks = wo.links.filter((l) => l.status === "active").length;
  const pending = wo.status === "issued" ? wo.pendingChanges : null;
  return (
    <li className="border-t border-border p-4 first:border-t-0" data-testid="work-order">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span className="tabular-nums">{wo.number}</span>
            <span className="text-muted">·</span>
            <span>{wo.crewName ?? "All crews"}</span>
            <Badge tone={STATUS_TONE[wo.status]}>{STATUS_LABEL[wo.status]}</Badge>
          </p>
          <p className="truncate text-sm text-muted">{wo.title}</p>
          <p className="mt-0.5 text-xs text-muted">
            {wo.currentVersion ? `Version ${wo.currentVersion}, issued ${formatDate(wo.issuedAt)}` : "Not issued yet: crews can't see it"} · {plural(activeLinks, "active link")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && open && (
            <Button size="sm" variant="secondary" onClick={onEdit}>
              Edit
            </Button>
          )}
          {(open || wo.currentVersion > 0) && (
            <>
              <a href={`${base}?draft=1`} target="_blank" rel="noopener" className={buttonClass("secondary", "sm")}>
                Preview
              </a>
              <a href={`${base}?print=1`} target="_blank" rel="noopener" className={buttonClass("secondary", "sm")}>
                Print
              </a>
            </>
          )}
          {canEdit && open && (
            <Button size="sm" onClick={onIssue} disabled={busy}>
              {wo.currentVersion ? "Issue new version" : "Issue"}
            </Button>
          )}
        </div>
      </div>

      {pending && pending.length > 0 && (
        <p className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          Changed since version {wo.currentVersion} and not issued yet: {sectionList(pending)}. Crews still see version {wo.currentVersion}.
        </p>
      )}

      {(wo.status === "issued" || wo.links.length > 0) && (
        <div className="mt-3 rounded-md border border-border">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Share links</p>
              <p className="text-xs text-muted">For crews without a login. Each link always shows the latest issued version.</p>
            </div>
            {canEdit && wo.status === "issued" && (
              <Button size="sm" variant="secondary" onClick={onLink} disabled={busy}>
                Create link
              </Button>
            )}
          </div>
          {wo.links.length ? (
            <ul aria-label={`Share links for ${wo.number}`}>
              {wo.links.map((l) => (
                <LinkRow key={l.id} l={l} wo={wo} canEdit={canEdit} busy={busy} now={now} url={remembered[l.id]} onRevoke={() => onRevoke(l)} />
              ))}
            </ul>
          ) : (
            <p className="border-t border-border px-3 py-2 text-sm text-muted">No links yet.</p>
          )}
        </div>
      )}

      {(wo.versions.length > 0 || (canEdit && open)) && (
        <div className="mt-3 flex flex-wrap items-start justify-between gap-2">
          {wo.versions.length > 0 ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted hover:text-text">Version history ({wo.versions.length})</summary>
              <ol className="mt-2 space-y-1">
                {wo.versions.map((v) => (
                  <li key={v.version}>
                    <a href={`${base}?v=${v.version}`} target="_blank" rel="noopener" className="font-medium text-brand hover:underline">
                      Version {v.version}
                    </a>{" "}
                    <span className="text-muted">
                      · {formatDateTime(v.issuedAt)}
                      {v.issuedByName ? ` · ${v.issuedByName}` : ""}
                      {v.changeNote ? ` · “${v.changeNote}”` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          ) : (
            <span />
          )}
          {canEdit && open && (
            <button type="button" onClick={onCancel} disabled={busy} className="text-sm text-danger hover:underline disabled:opacity-50">
              Cancel work order
            </button>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function WorkOrderFormDialog({
  mode,
  projectId,
  workOrder,
  initial,
  crews,
  onClose,
  onDone,
}: {
  mode: "new" | "edit";
  projectId: string;
  workOrder?: WorkOrderDTO;
  initial: WorkOrderFieldsDTO;
  crews: CrewOption[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [f, setF] = useState<WorkOrderFieldsDTO>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const formId = useId();
  const set = <K extends keyof WorkOrderFieldsDTO>(k: K, v: WorkOrderFieldsDTO[K]) => setF((p) => ({ ...p, [k]: v }));
  const setItem = (i: number, text: string) => set("checklist", f.checklist.map((c, j) => (j === i ? { ...c, text } : c)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...f.checklist];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item);
    set("checklist", next);
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const fields = { ...f, checklist: f.checklist.map((c) => ({ id: c.id, text: c.text.trim() })).filter((c) => c.text) };
    start(async () => {
      const r = mode === "new" ? await createWorkOrderAction({ ...fields, projectId }) : await updateWorkOrderAction({ ...fields, id: workOrder?.id });
      if (r.ok) onDone(r.message);
      else setError(r.error);
    });
  }

  const issued = !!workOrder && workOrder.currentVersion > 0;
  return (
    <Dialog
      open
      onClose={onClose}
      className="w-[min(40rem,calc(100vw-2rem))]"
      title={mode === "new" ? "New work order" : `Edit ${workOrder?.number}`}
      description={issued ? `Crews keep seeing version ${workOrder?.currentVersion} until you issue a new version.` : "Crews can't see it until you issue it."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? "Saving…" : mode === "new" ? "Create work order" : "Save changes"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4">
        <FormError message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Crew" hint="All crews: everyone booked on this job can open it.">
            <Select value={f.crewId ?? ""} onChange={(e) => set("crewId", e.target.value || null)} data-autofocus>
              <option value="">All crews</option>
              {crews.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title">
            <Input value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={200} required />
          </Field>
        </div>
        <Field label="Special instructions" hint="Start lines with “- ” for bullet points.">
          <Textarea rows={4} value={f.specialInstructions} onChange={(e) => set("specialInstructions", e.target.value)} maxLength={4000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Equipment" hint="Ladders, lifts, drop sheets…">
            <Textarea rows={3} value={f.equipment} onChange={(e) => set("equipment", e.target.value)} maxLength={2000} />
          </Field>
          <Field label="Safety notes" hint="Lead paint, fall protection, ventilation…">
            <Textarea rows={3} value={f.safetyNotes} onChange={(e) => set("safetyNotes", e.target.value)} maxLength={2000} />
          </Field>
        </div>
        <Field label="Access notes" hint="Gate codes, parking, pets. Starts with the notes saved on the property.">
          <Textarea rows={2} value={f.accessNotes} onChange={(e) => set("accessNotes", e.target.value)} maxLength={1000} />
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-text">Checklist</legend>
          {f.checklist.length === 0 && <p className="mb-2 text-sm text-muted">No checklist items.</p>}
          <ol className="space-y-2">
            {f.checklist.map((c, i) => (
              <li key={c.id} className="flex items-center gap-1">
                <Input aria-label={`Checklist item ${i + 1}`} value={c.text} onChange={(e) => setItem(i, e.target.value)} maxLength={MAX_CHECKLIST_TEXT} />
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move item ${i + 1} up`} className="grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 disabled:opacity-30">
                  <ArrowUp className="size-4" aria-hidden />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === f.checklist.length - 1} aria-label={`Move item ${i + 1} down`} className="grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 disabled:opacity-30">
                  <ArrowDown className="size-4" aria-hidden />
                </button>
                <button type="button" onClick={() => set("checklist", f.checklist.filter((_, j) => j !== i))} aria-label={`Remove item ${i + 1}`} className="grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-danger-soft hover:text-danger">
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ol>
          <Button size="sm" variant="secondary" className="mt-2" disabled={f.checklist.length >= MAX_CHECKLIST_ITEMS} onClick={() => set("checklist", [...f.checklist, { id: newId(), text: "" }])}>
            <Plus className="size-4" aria-hidden /> Add checklist item
          </Button>
        </fieldset>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4" checked={f.showCustomerPhone} onChange={(e) => set("showCustomerPhone", e.target.checked)} />
          <span>
            Show customer phone to crew
            <span className="block text-xs text-subtle">On My Jobs only the crew lead sees it. Anyone with a share link sees it.</span>
          </span>
        </label>
      </form>
    </Dialog>
  );
}

function IssueDialog({ wo, onClose, onDone }: { wo: WorkOrderDTO; onClose: () => void; onDone: (message: string) => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const next = wo.currentVersion + 1;
  const first = wo.currentVersion === 0;
  const changes = wo.pendingChanges;

  function issue() {
    setError(null);
    start(async () => {
      const r = await issueWorkOrderAction({ id: wo.id, changeNote: first ? null : note });
      if (r.ok) onDone(r.message);
      else setError(r.error);
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={first ? `Issue ${wo.number}` : `Issue version ${next}`}
      description={
        first
          ? "The crew can then open it from My Jobs, and you can create share links. Later changes need a new version."
          : "Crews who open it will see an “Updated” banner with the changed sections highlighted."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={issue} disabled={pending} data-autofocus>
            {pending ? "Issuing…" : first ? "Issue work order" : `Issue version ${next}`}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <FormError message={error} />
        {!first && changes && (
          <p className="text-sm">{changes.length ? <>What&apos;s different from version {wo.currentVersion}: <strong>{sectionList(changes)}</strong>.</> : `Nothing has changed since version ${wo.currentVersion} yet.`}</p>
        )}
        {!first && (
          <Field label="What changed? (optional)" hint="For the version history. Crews see the highlighted sections.">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
        )}
        <p className="text-sm text-muted">Tip: use Preview first to check what the crew will see.</p>
      </div>
    </Dialog>
  );
}

function LinkDialog({ wo, defaultDays, onClose, onCreated }: { wo: WorkOrderDTO; defaultDays: number; onClose: () => void; onCreated: (message: string) => void }) {
  const preset = (LINK_DAY_CHOICES as readonly number[]).includes(defaultDays);
  const [label, setLabel] = useState(wo.crewName ?? "");
  const [choice, setChoice] = useState(preset ? String(defaultDays) : "custom");
  const [custom, setCustom] = useState(String(defaultDays));
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);
  const [pending, start] = useTransition();
  const formId = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const days = choice === "custom" ? Number(custom) : Number(choice);
    if (!Number.isInteger(days) || days < 1 || days > MAX_LINK_DAYS) {
      setError(`Enter a whole number of days from 1 to ${MAX_LINK_DAYS}.`);
      return;
    }
    start(async () => {
      const r = await createShareLinkAction({ workOrderId: wo.id, label, days });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      rememberLink(r.linkId, r.url);
      setCreated({ url: r.url, expiresAt: r.expiresAt });
      onCreated(`Link created for ${label.trim()}.`);
    });
  }

  if (created)
    return (
      <Dialog open onClose={onClose} title="Link ready to share" description={`Send it to the crew by text or email. It works until ${formatDate(created.expiresAt)}.`} footer={<Button onClick={onClose}>Done</Button>}>
        <div className="grid gap-3">
          <Field label="Work order link">
            <Input readOnly value={created.url} onFocus={(e) => e.currentTarget.select()} data-autofocus />
          </Field>
          <div>
            <CopyButton text={created.url} />
          </div>
          <p className="text-sm text-muted">For security, the full link is only kept in this browser until you close it. After that, create a new link if you need it again.</p>
        </div>
      </Dialog>
    );

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Share ${wo.number}`}
      description="Anyone with the link can see this work order (never prices or hours) until it expires or you turn it off."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? "Creating…" : "Create link"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4">
        <FormError message={error} />
        <Field label="Who is it for?" hint="Only you see this, for example “Niko's crew”.">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} required data-autofocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Link works for">
            <Select value={choice} onChange={(e) => setChoice(e.target.value)}>
              {LINK_DAY_CHOICES.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
              <option value="custom">Custom…</option>
            </Select>
          </Field>
          {choice === "custom" && (
            <Field label="Number of days" hint={`1 to ${MAX_LINK_DAYS}`}>
              <Input type="number" inputMode="numeric" min={1} max={MAX_LINK_DAYS} value={custom} onChange={(e) => setCustom(e.target.value)} />
            </Field>
          )}
        </div>
      </form>
    </Dialog>
  );
}
