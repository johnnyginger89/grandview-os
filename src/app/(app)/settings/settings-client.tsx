"use client";
import { Check, Copy } from "lucide-react";
import { gmailConnectMessage } from "@/lib/gmail-connect-messages";
import { submitWith } from "@/components/submit";
import { useActionState, useRef, useState, useTransition } from "react";
import { Badge, Button, Card, CardHeader, Field, FormError, Input, Select, Table, Textarea, td, th } from "@/components/ui";
import { ROLES } from "@/db/schema/auth";
import { can, ROLE_LABELS } from "@/lib/authz/permissions";
import { formatDate, formatDateTime } from "@/lib/utils";
import { createUserAction, resetTwoFactorAction, saveCompanyAction, saveListAction, savePricingAction, saveTemplateAction, setTemporaryPasswordAction, updateUserAction } from "./actions";
import { saveColourFormSettingsAction } from "./colour-form-settings-actions";
import { connectCompanyCamAction, disconnectCompanyCamAction, disconnectGmailAction, syncGmailAction } from "./integration-actions";
import { saveWorkOrderSettingsAction } from "./work-order-settings-actions";

function Saved({ state }: { state: { ok: boolean; error?: string } | null }) {
  if (!state) return null;
  return state.ok ? <span className="text-sm text-success">Saved</span> : <FormError message={state.error} />;
}

export function CompanyForm({ company, prefill }: { company: Record<string, string>; prefill: Record<string, string> }) {
  const [state, action, pending] = useActionState(saveCompanyAction, null);
  const form = useRef<HTMLFormElement>(null);
  const [filled, setFilled] = useState(false);
  function fillFromMarkate() {
    const f = form.current;
    if (!f) return;
    for (const [k, v] of Object.entries(prefill)) {
      const el = f.elements.namedItem(k);
      if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && !el.value.trim()) el.value = v;
    }
    setFilled(true);
  }
  return (
    <form ref={form} onSubmit={submitWith(action)} className="max-w-2xl">
      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-info-soft px-3 py-2 text-sm text-info sm:col-span-2">
          <span>These details print on every proposal (the FROM block) and in emails.</span>
          <Button size="sm" variant="secondary" onClick={fillFromMarkate}>Fill from your Markate proposal</Button>
        </div>
        {filled && <p className="text-sm text-muted sm:col-span-2">Empty fields were filled from your Markate proposal. Check them, then press Save.</p>}
        <Field label="Legal company name" hint="Used in the contract and emails"><Input name="name" defaultValue={company.name} required /></Field>
        <Field label="Name on proposals"><Input name="displayName" defaultValue={company.displayName} placeholder="Grandview Painting" /></Field>
        <Field label="Tagline" className="sm:col-span-2"><Input name="tagline" defaultValue={company.tagline} placeholder="Quality focused. Integrity driven." /></Field>
        <Field label="Email"><Input name="email" type="email" defaultValue={company.email} /></Field>
        <Field label="Website"><Input name="website" type="url" defaultValue={company.website} placeholder="https://www.grandviewpainting.ca/" /></Field>
        <Field label="Main phone"><Input name="phone" defaultValue={company.phone} /></Field>
        <div className="grid grid-cols-[1fr_8rem] gap-2">
          <Field label="Second phone"><Input name="phone2" defaultValue={company.phone2} /></Field>
          <Field label="Label"><Input name="phone2Label" defaultValue={company.phone2Label} placeholder="Cell" /></Field>
        </div>
        <Field label="Address" hint="Street on the first line, city and postal code on the second" className="sm:col-span-2"><Textarea name="address" rows={2} defaultValue={company.address} /></Field>
        <Field label="GST number"><Input name="gstNumber" defaultValue={company.gstNumber} placeholder="123456789 RT0001" /></Field>
        <div className="grid grid-cols-[8rem_1fr] gap-2">
          <Field label="Licence label"><Input name="licenceLabel" defaultValue={company.licenceLabel} placeholder="License" /></Field>
          <Field label="Licence number"><Input name="licenceNumber" defaultValue={company.licenceNumber} /></Field>
        </div>
        <Field label="YouCanBook.me booking link" hint="Sent to new leads with the one-click booking email." className="sm:col-span-2">
          <Input name="bookingUrl" type="url" defaultValue={company.bookingUrl} placeholder="https://grandviewpainting.youcanbook.me" />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2"><Button type="submit" disabled={pending}>Save</Button><Saved state={state} /></div>
      </Card>
    </form>
  );
}

export function PricingForm({ pricing }: { pricing: Record<string, string | number> }) {
  const [state, action, pending] = useActionState(savePricingAction, null);
  const pct = (k: string) => String(Number(pricing[k]) * 100);
  return (
    <form onSubmit={submitWith(action)} className="max-w-2xl">
      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning sm:col-span-2">The starting values here are placeholders. Set your real burdened labour cost and billing rate before sending estimates.</p>
        <Field label="Default pricing method" className="sm:col-span-2">
          <Select name="pricingMethod" defaultValue={String(pricing.pricingMethod)}>
            <option value="billing_rate">Billing rate × hours + marked-up materials (PaintScout style)</option>
            <option value="target_margin">Total cost ÷ (1 − target margin)</option>
          </Select>
        </Field>
        <Field label="Labour cost per hour ($)" hint="Burdened: wage + WCB + CPP/EI + vacation, or your sub's hourly equivalent"><Input name="laborCostPerHour" defaultValue={String(pricing.laborCostPerHour)} inputMode="decimal" /></Field>
        <Field label="Billing rate per hour ($)" hint="What you charge per labour hour"><Input name="billingRatePerHour" defaultValue={String(pricing.billingRatePerHour)} inputMode="decimal" /></Field>
        <Field label="Target gross margin (%)"><Input name="targetMargin" defaultValue={pct("targetMargin")} inputMode="decimal" /></Field>
        <Field label="Material markup (%)"><Input name="materialMarkupPct" defaultValue={pct("materialMarkupPct")} inputMode="decimal" /></Field>
        <Field label="Minimum job price ($)"><Input name="minimumJobPrice" defaultValue={String(pricing.minimumJobPrice)} inputMode="decimal" /></Field>
        <Field label="Deposit (%)"><Input name="depositPct" defaultValue={pct("depositPct")} inputMode="decimal" /></Field>
        <Field label="GST (%)"><Input name="gstRate" defaultValue={pct("gstRate")} inputMode="decimal" /></Field>
        <Field label="Estimates valid for (days)" hint="Counted from the day each proposal is sent, up to the end of the last day"><Input name="estimateValidDays" defaultValue={String(pricing.estimateValidDays)} inputMode="numeric" /></Field>
        <Field label="Hours per crew day"><Input name="hoursPerCrewDay" defaultValue={String(pricing.hoursPerCrewDay)} inputMode="decimal" /></Field>
        <div className="flex items-center gap-3 sm:col-span-2"><Button type="submit" disabled={pending}>Save</Button><Saved state={state} /></div>
      </Card>
    </form>
  );
}

export function ListsForm({ lists }: { lists: Record<"lead_sources" | "lost_reasons" | "project_types", string[]> }) {
  const titles = { lead_sources: "Lead sources", lost_reasons: "Lost reasons", project_types: "Project types" } as const;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {(Object.keys(titles) as (keyof typeof titles)[]).map((k) => <ListEditor key={k} k={k} title={titles[k]} items={lists[k]} />)}
    </div>
  );
}

function ListEditor({ k, title, items }: { k: "lead_sources" | "lost_reasons" | "project_types"; title: string; items: string[] }) {
  const [text, setText] = useState(items.join("\n"));
  const [state, setState] = useState<{ ok: boolean; error?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader title={title} description="One per line" />
      <div className="space-y-2 p-4">
        <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} aria-label={title} />
        <div className="flex items-center gap-3"><Button size="sm" disabled={pending} onClick={() => start(async () => setState(await saveListAction(k, text)))}>Save</Button><Saved state={state} /></div>
      </div>
    </Card>
  );
}

export function TemplatesForm({ templates }: { templates: { id: string; name: string; subject: string; body: string }[] }) {
  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-muted">
        Words in double braces are filled in for you when the email is written: {"{{first_name}} {{customer_name}} {{sender_name}} {{company_name}} {{company_phone}}"}, plus{" "}
        {"{{project_types}} {{booking_url}}"} for leads and {"{{job_title}} {{proposal_link}} {{valid_until}}"} for proposals.
      </p>
      {templates.map((t) => <TemplateEditor key={t.id} t={t} />)}
    </div>
  );
}

function TemplateEditor({ t }: { t: { id: string; name: string; subject: string; body: string } }) {
  const [subject, setSubject] = useState(t.subject);
  const [body, setBody] = useState(t.body);
  const [state, setState] = useState<{ ok: boolean; error?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader title={t.name} />
      <div className="space-y-3 p-4">
        <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Message"><Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <div className="flex items-center gap-3"><Button size="sm" disabled={pending} onClick={() => start(async () => setState(await saveTemplateAction(t.id, subject, body)))}>Save</Button><Saved state={state} /></div>
      </div>
    </Card>
  );
}

type UserRow = { id: string; name: string; email: string; role: string; active: boolean; mfa: boolean; mustChangePassword: boolean };

export function UsersPanel({ users, meId, isOwner, canResetSignIn }: { users: UserRow[]; meId: string; isOwner: boolean; canResetSignIn: boolean }) {
  const [state, action, pending] = useActionState(createUserAction, null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [reset, setReset] = useState<{ name: string; email: string; tempPassword?: string } | null>(null);
  const [busy, start] = useTransition();
  // Only the owner can hand out roles that see company financials.
  const roles = ROLES.filter((r) => isOwner || !can(r, "financials.read"));
  function temporaryPassword(u: UserRow) {
    if (!confirm(`Set a temporary password for ${u.name}? They'll be signed out everywhere and must choose their own password when they sign in.`)) return;
    start(async () => {
      const r = await setTemporaryPasswordAction(u.id);
      setRowError(r.ok ? null : r.error);
      setReset(r.ok ? { name: r.name, email: r.email, tempPassword: r.tempPassword } : null);
    });
  }
  function resetTwoStep(u: UserRow) {
    if (!confirm(`Reset two-step sign-in for ${u.name}? They'll be signed out everywhere and set up their authenticator app again when they next sign in.`)) return;
    start(async () => {
      const r = await resetTwoFactorAction(u.id);
      setRowError(r.ok ? null : r.error);
      setReset(r.ok ? { name: r.name, email: u.email } : null);
    });
  }
  return (
    <div className="space-y-4">
      {reset && (
        <div role="status" className="max-w-2xl rounded-md bg-success-soft p-3 text-sm">
          {reset.tempPassword ? (
            <>
              <p>
                Temporary password for <strong>{reset.name}</strong> ({reset.email}): <code className="rounded bg-surface px-1.5 py-0.5 font-mono">{reset.tempPassword}</code>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <CopyText text={reset.tempPassword} />
                <span className="text-xs text-muted">Share it privately; it&apos;s shown only once. They&apos;ve been signed out and will choose their own password when they sign in.</span>
              </div>
            </>
          ) : (
            <p>Two-step sign-in reset for <strong>{reset.name}</strong>. They&apos;ve been signed out and will set up their authenticator app again when they next sign in.</p>
          )}
        </div>
      )}
      <Card>
        <Table>
          <thead><tr><th className={th}>Name</th><th className={th}>Role</th><th className={`${th} hidden sm:table-cell`}>2FA</th><th className={th}>Status</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className={td}>
                  <p className="font-medium">{u.name}</p>
                  <p className="text-xs text-muted">{u.email}</p>
                  {u.mustChangePassword && <Badge tone="warning" className="mt-1">Temporary password</Badge>}
                </td>
                <td className={td}>
                  {u.id === meId || (u.role === "owner" && !isOwner) ? ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] : (
                    <Select aria-label={`Role for ${u.name}`} className="h-8 w-auto" defaultValue={u.role} disabled={busy} onChange={(e) => start(async () => { const r = await updateUserAction(u.id, { role: e.target.value }); setRowError(r.ok ? null : r.error); })}>
                      {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </Select>
                  )}
                </td>
                <td className={`${td} hidden sm:table-cell`}>{u.mfa ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}</td>
                <td className={td}>
                  {u.id === meId ? <Badge tone="success">You</Badge> : (
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant={u.active ? "ghost" : "secondary"} disabled={busy} onClick={() => { if (!u.active || confirm(`Deactivate ${u.name}? They'll be signed out immediately.`)) start(async () => { const r = await updateUserAction(u.id, { active: !u.active }); setRowError(r.ok ? null : r.error); }); }}>
                        {u.active ? "Deactivate" : "Reactivate"}
                      </Button>
                      {/* Owner only: anyone who could do these could take over the login. */}
                      {canResetSignIn && (
                        <Button size="sm" variant="ghost" disabled={busy} aria-label={`Set temporary password for ${u.name}`} onClick={() => temporaryPassword(u)}>
                          Set temporary password
                        </Button>
                      )}
                      {canResetSignIn && u.mfa && (
                        <Button size="sm" variant="ghost" disabled={busy} aria-label={`Reset two-step sign-in for ${u.name}`} onClick={() => resetTwoStep(u)}>
                          Reset two-step
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <FormError message={rowError} />
      </Card>
      <Card className="max-w-2xl">
        <CardHeader title="Add a user" description="Field crew and subcontractors only need an account to log time and upload photos. Work orders can be shared by link without an account." />
        <form action={action} className="grid gap-3 p-4 sm:grid-cols-2">
          <Field label="Name"><Input name="name" required /></Field>
          <Field label="Email"><Input name="email" type="email" required /></Field>
          <Field label="Role"><Select name="role" defaultValue="painter">{roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select></Field>
          <Field label="Phone"><Input name="phone" type="tel" /></Field>
          <div className="sm:col-span-2"><Button type="submit" disabled={pending}>Create account</Button></div>
          {state && !state.ok && <FormError message={state.error} />}
          {state?.ok && state.tempPassword && (
            <div className="rounded-md bg-success-soft p-3 text-sm sm:col-span-2">
              Account created for <strong>{state.email}</strong>. Temporary password: <code className="rounded bg-surface px-1.5 py-0.5 font-mono">{state.tempPassword}</code>
              <p className="mt-1 text-xs text-muted">Share it privately. It is shown only once; they&apos;ll choose their own password when they first sign in.</p>
            </div>
          )}
        </form>
      </Card>
    </div>
  );
}

function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this:", text);
    }
  }
  return (
    <Button size="sm" variant="secondary" onClick={copy}>
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function WorkOrderSettingsForm({
  settings,
}: {
  settings: { defaultChecklist: string[]; defaultLinkDays: number; createOnSale: boolean; showHours: boolean; showPaint: boolean };
}) {
  const [checklist, setChecklist] = useState(settings.defaultChecklist.join("\n"));
  const [days, setDays] = useState(String(settings.defaultLinkDays));
  const [createOnSale, setCreateOnSale] = useState(settings.createOnSale);
  const [showHours, setShowHours] = useState(settings.showHours);
  const [showPaint, setShowPaint] = useState(settings.showPaint);
  const [state, setState] = useState<{ ok: boolean; error?: string } | null>(null);
  const [pending, start] = useTransition();
  function save() {
    const n = Number(days.trim());
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      setState({ ok: false, error: "Enter a whole number of days from 1 to 365." });
      return;
    }
    const items = checklist.split("\n").map((s) => s.trim()).filter(Boolean);
    start(async () => setState(await saveWorkOrderSettingsAction({ defaultChecklist: items, defaultLinkDays: n, createOnSale, showHours, showPaint })));
  }
  const toggle = (label: string, hint: string, checked: boolean, set: (v: boolean) => void) => (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" className="mt-0.5 size-4" checked={checked} onChange={(e) => set(e.target.checked)} />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-muted">{hint}</span>
      </span>
    </label>
  );
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Work orders" description="Starting values for new crew work orders. Each work order can still be changed before it's issued." />
      <div className="grid gap-4 p-4">
        <fieldset className="grid gap-3">
          <legend className="sr-only">What work orders include</legend>
          {toggle("Create the work order when a job is sold", "A draft for everyone booked on the job, ready to check and issue.", createOnSale, setCreateOnSale)}
          {toggle("Show labour hours", "Estimated hours per item, per room and for the whole job. Never prices.", showHours, setShowHours)}
          {toggle("Show paint to order", "How much of each product, colour and sheen to buy, from the measurements and coverage.", showPaint, setShowPaint)}
        </fieldset>
        <Field label="Default checklist" hint="One item per line, up to 30. Copied onto every new work order.">
          <Textarea rows={9} value={checklist} onChange={(e) => setChecklist(e.target.value)} />
        </Field>
        <Field label="Share links work for (days)" hint="How long a new share link works unless you pick another time. 1 to 365 days.">
          <Input inputMode="numeric" className="w-32" value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <div className="flex items-center gap-3"><Button disabled={pending} onClick={save}>Save</Button><Saved state={state} /></div>
      </div>
    </Card>
  );
}

export function ColourFormSettingsForm({ settings }: { settings: { changeWarning: string; coverageWarning: string; sheens: string[]; surfaces: string[]; linkDays: number } }) {
  const [changeWarning, setChangeWarning] = useState(settings.changeWarning);
  const [coverageWarning, setCoverageWarning] = useState(settings.coverageWarning);
  const [sheens, setSheens] = useState(settings.sheens.join("\n"));
  const [surfaces, setSurfaces] = useState(settings.surfaces.join("\n"));
  const [days, setDays] = useState(String(settings.linkDays));
  const [state, setState] = useState<{ ok: boolean; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  function save() {
    const n = Number(days.trim());
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      setState({ ok: false, error: "Enter a whole number of days from 1 to 365." });
      return;
    }
    start(async () => setState(await saveColourFormSettingsAction({ changeWarning, coverageWarning, sheens: lines(sheens), surfaces: lines(surfaces), linkDays: n })));
  }
  return (
    <Card className="mt-4 max-w-2xl" role="region" aria-label="Colour form">
      <CardHeader title="Colour form" description="The customer ticks both notes before signing their colours. The wording they agreed to is kept with each signed form." />
      <div className="grid gap-4 p-4">
        <Field label="Note about changing colours"><Textarea rows={3} value={changeWarning} onChange={(e) => setChangeWarning(e.target.value)} /></Field>
        <Field label="Note about whites and bright colours"><Textarea rows={3} value={coverageWarning} onChange={(e) => setCoverageWarning(e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sheens to pick from" hint="One per line."><Textarea rows={7} value={sheens} onChange={(e) => setSheens(e.target.value)} /></Field>
          <Field label="Surfaces to pick from" hint="One per line. People can still type their own."><Textarea rows={7} value={surfaces} onChange={(e) => setSurfaces(e.target.value)} /></Field>
        </div>
        <Field label="Customer links work for (days)"><Input inputMode="numeric" className="w-32" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        <div className="flex items-center gap-3"><Button disabled={pending} onClick={save}>Save</Button><Saved state={state} /></div>
      </div>
    </Card>
  );
}

export function GmailSettings({
  status,
  result,
  canConnect,
}: {
  status: {
    configured: boolean;
    connected: boolean;
    broken: boolean;
    email: string | null;
    connectedAt: string | null;
    connectedByName: string | null;
    lastSyncAt: string | null;
    lastResult: { checked: number; imported: number; error: string | null } | null;
    catchingUp: boolean;
    importedTotal: number;
    redirectUri: string | null;
    companyEmail: string | null;
    companyDomain: string | null;
    onCompanyDomain: boolean | null;
    connectedByOwner: boolean | null;
  };
  /** From Google's return trip: ?gmail=connected|denied|error&reason=… */
  result: { gmail?: string; reason?: string };
  /** Owner only: password-reset emails go out through this mailbox. */
  canConnect: boolean;
}) {
  const [state, setState] = useState<{ ok: boolean; error?: string } | null>(null);
  const [synced, setSynced] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const day = (iso: string | null) => formatDateTime(iso);
  return (
    <Card role="region" aria-label="Gmail">
      <CardHeader
        title="Gmail"
        description="Emails from Grandview OS go out from your Gmail (they're in its Sent folder), and customers' emails are copied into their file every 10 minutes."
        action={status.connected ? <Badge tone="success">Connected</Badge> : status.broken ? <Badge tone="warning">Needs reconnecting</Badge> : <Badge>Not connected</Badge>}
      />
      <div className="space-y-3 p-4 text-sm">
        {result.gmail === "connected" && <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-success">Gmail is connected.</p>}
        {result.gmail === "denied" && <p className="rounded-md bg-warning-soft px-3 py-2 text-warning">Google sign-in was cancelled, so Gmail isn&apos;t connected.</p>}
        {result.gmail === "error" && <FormError message={gmailConnectMessage(result.reason, status.companyDomain)} />}
        {!status.configured ? (
          <div className="space-y-2">
            <p className="font-medium">One-time setup in Google (about 10 minutes, signed in as info@):</p>
            <ol className="list-decimal space-y-1 pl-5 text-muted">
              <li>console.cloud.google.com → create a project called &ldquo;Grandview OS&rdquo;.</li>
              <li>APIs &amp; Services → Library → turn on <b>Gmail API</b>.</li>
              <li>OAuth consent screen → <b>Internal</b> (or External with info@ as a test user).</li>
              <li>
                Credentials → Create credentials → OAuth client ID → Web application. Authorized redirect URI:
                <code className="mt-1 block break-all rounded bg-surface-2 p-2 font-mono text-xs text-text">{(status.redirectUri ?? "https://grandviewpainting.app/api/integrations/google/callback")}</code>
              </li>
              <li>Put the Client ID and Client secret into Vercel → Settings → Environment Variables as <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>, then redeploy. Don&apos;t paste them in a chat or email.</li>
            </ol>
          </div>
        ) : status.connected ? (
          <>
            <p>
              Sending from <b>{status.email}</b>
              {status.connectedByName ? `, connected by ${status.connectedByName}` : ""}
              {status.connectedAt ? ` on ${day(status.connectedAt)}` : ""}.
            </p>
            <ul className="space-y-1 text-muted">
              <li>
                {status.lastSyncAt
                  ? `Last checked ${day(status.lastSyncAt)}${status.lastResult && !status.lastResult.error ? `: looked at ${status.lastResult.checked} ${status.lastResult.checked === 1 ? "email" : "emails"}, ${status.lastResult.imported} from customers.` : "."}`
                  : "Not checked yet. It checks every 10 minutes, or press the button below."}
              </li>
              <li>{status.importedTotal} customer {status.importedTotal === 1 ? "email" : "emails"} copied into customer files so far.</li>
              {status.catchingUp && <li>Still bringing in the last 60 days of customer emails, about 100 emails per check.</li>}
              <li>Only emails from an address saved on a customer or one of their contacts are copied in; everything else stays in Gmail only.</li>
            </ul>
            {status.lastResult?.error && <p className="rounded-md bg-warning-soft px-3 py-2 text-warning">The last check didn&apos;t work: {status.lastResult.error}</p>}
            {(status.onCompanyDomain === false || status.connectedByOwner === false) && (
              <p className="rounded-md bg-warning-soft px-3 py-2 text-warning">
                {status.onCompanyDomain === false ? `${status.email} isn't on @${status.companyDomain}, the company email's domain. ` : "This mailbox wasn't connected by the owner. "}
                Password-reset emails go out through it, so the owner should disconnect it and connect the company mailbox.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await syncGmailAction();
                    if (r.ok) setSynced(`${r.imported ? `${r.imported} customer ${r.imported === 1 ? "email" : "emails"} added.` : "No new customer emails."}${r.catchingUp ? " Still catching up on older ones – press again or wait for the next check." : ""}`);
                    else setState(r);
                  })
                }
              >
                {pending ? "Checking…" : "Check for customer emails now"}
              </Button>
              {canConnect && (
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm("Disconnect Gmail? Emails will stop going out from it until it's connected again.")) start(async () => setState(await disconnectGmailAction()));
                  }}
                >
                  Disconnect
                </Button>
              )}
            </div>
            {!canConnect && <p className="text-muted">Only the owner can connect or disconnect Gmail.</p>}
            {synced && <p role="status" className="text-success">{synced}</p>}
          </>
        ) : (
          <>
            {status.broken && <p className="rounded-md bg-warning-soft px-3 py-2 text-warning">Google stopped accepting the connection{status.email ? ` for ${status.email}` : ""}. Connect again; until then, emails can&apos;t go out.</p>}
            {!canConnect ? (
              <p className="text-muted">Only the owner can connect Gmail.</p>
            ) : !status.companyDomain ? (
              <p className="text-muted">Add the company email in the Company tab first. Gmail can only be connected to a mailbox on the same domain.</p>
            ) : (
              <>
                <p className="text-muted">
                  Sign in with the company mailbox emails should come from ({status.companyEmail}) and allow both Gmail permissions. Only a mailbox on @{status.companyDomain} can be connected.
                </p>
                {/* A full page visit: Google's sign-in isn't a request the app can make for you. */}
                <a href="/api/integrations/google/start" className="inline-flex h-10 items-center rounded-lg bg-brand px-4 font-medium text-brand-contrast shadow-card hover:bg-brand-hover">
                  Connect Gmail
                </a>
              </>
            )}
          </>
        )}
        <Saved state={state} />
      </div>
    </Card>
  );
}

export function CompanyCamSettings({ status }: { status: { connected: boolean; unreadable: boolean; companyName: string | null; connectedAt: string | null; connectedByName: string | null } }) {
  const [token, setToken] = useState("");
  const [state, setState] = useState<{ ok: boolean; error?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card role="region" aria-label="CompanyCam">
      <CardHeader
        title="CompanyCam"
        description="Shows the crew's CompanyCam photos on estimates, jobs and work orders, and creates CompanyCam projects from jobs."
        action={status.connected ? <Badge tone="success">Connected</Badge> : <Badge>Not connected</Badge>}
      />
      <div className="space-y-3 p-4 text-sm">
        {status.connected ? (
          <>
            <p>
              Connected{status.companyName ? ` to ${status.companyName}` : ""}
              {status.connectedByName ? ` by ${status.connectedByName}` : ""}
              {status.connectedAt ? ` on ${formatDate(status.connectedAt)}` : ""}.
            </p>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                if (window.confirm("Disconnect CompanyCam? Photos stop showing until it's connected again. Links between jobs and CompanyCam projects are kept.")) start(async () => setState(await disconnectCompanyCamAction()));
              }}
            >
              Disconnect
            </Button>
          </>
        ) : (
          <>
            {status.unreadable && <p className="rounded-md bg-warning-soft px-3 py-2 text-warning">The saved token can&apos;t be read any more (the server&apos;s secret changed). Paste it again.</p>}
            <ol className="list-decimal space-y-1 pl-5 text-muted">
              <li>
                Create a Personal Access Token in CompanyCam, signed in as an admin (CompanyCam&apos;s guide:{" "}
                <a href="https://developers.companycam.com/access-token-setup" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">Setting up your personal access token</a>). API access needs CompanyCam&apos;s Pro plan or higher.
              </li>
              <li>Paste it here. It&apos;s checked with CompanyCam, then stored encrypted. Don&apos;t send it by email or chat.</li>
            </ol>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const r = await connectCompanyCamAction(token);
                  setState(r);
                  if (r.ok) setToken("");
                });
              }}
            >
              <Input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="CompanyCam access token" aria-label="CompanyCam access token" className="min-w-0 flex-1" />
              <Button type="submit" disabled={pending || token.trim().length < 10}>{pending ? "Checking…" : "Connect"}</Button>
            </form>
          </>
        )}
        <Saved state={state} />
      </div>
    </Card>
  );
}

export function IntegrationsInfo({ appUrl }: { appUrl: string }) {
  return (
    <div className="max-w-3xl space-y-4 text-sm">
      <Card>
        <CardHeader title="YouCanBook.me → Estimate Booked" />
        <div className="space-y-2 p-4 text-muted">
          <p>In YouCanBook.me, add a webhook notification for new bookings and cancellations that posts JSON to:</p>
          <code className="block break-all rounded bg-surface-2 p-2 font-mono text-xs text-text">{appUrl || "https://your-domain"}/api/inbound/youcanbookme?key=YOUR_YCBM_WEBHOOK_SECRET</code>
          <p>The secret is the <code>YCBM_WEBHOOK_SECRET</code> server setting. See <code>docs/integrations/youcanbookme.md</code> for the JSON template.</p>
        </div>
      </Card>
      <Card>
        <CardHeader title="Website form → New Lead" />
        <div className="space-y-2 p-4 text-muted">
          <p>Point your website form (or a Zapier step) at:</p>
          <code className="block break-all rounded bg-surface-2 p-2 font-mono text-xs text-text">{appUrl || "https://your-domain"}/api/inbound/form?key=YOUR_FORM_WEBHOOK_SECRET</code>
          <p>Use the <code>FORM_WEBHOOK_SECRET</code> server setting. Send it from the website server (for example the Gravity Forms Webhooks add-on), never from browser code. Accepts JSON or regular form posts with fields like name, email, phone, address, city, service, message.</p>
        </div>
      </Card>
      <Card>
        <CardHeader title="Email" />
        <p className="p-4 text-muted">Outgoing email is sent through Resend from your domain once <code>RESEND_API_KEY</code> is configured. Until then, messages are logged on the lead timeline but not delivered.</p>
      </Card>
    </div>
  );
}
