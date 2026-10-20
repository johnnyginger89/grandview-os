"use client";
import { useActionState, useState, useTransition } from "react";
import { Badge, Button, Card, CardHeader, Field, FormError, Input, Select, Table, Textarea, td, th } from "@/components/ui";
import { ROLES } from "@/db/schema/auth";
import { ROLE_LABELS } from "@/lib/authz/permissions";
import { createUserAction, saveCompanyAction, saveListAction, savePricingAction, saveTemplateAction, updateUserAction } from "./actions";

function Saved({ state }: { state: { ok: boolean; error?: string } | null }) {
  if (!state) return null;
  return state.ok ? <span className="text-sm text-success">Saved</span> : <FormError message={state.error} />;
}

export function CompanyForm({ company }: { company: Record<string, string> }) {
  const [state, action, pending] = useActionState(saveCompanyAction, null);
  return (
    <form action={action} className="max-w-2xl">
      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label="Company name" className="sm:col-span-2"><Input name="name" defaultValue={company.name} required /></Field>
        <Field label="Email"><Input name="email" type="email" defaultValue={company.email} /></Field>
        <Field label="Phone"><Input name="phone" defaultValue={company.phone} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input name="address" defaultValue={company.address} /></Field>
        <Field label="GST number"><Input name="gstNumber" defaultValue={company.gstNumber} placeholder="123456789 RT0001" /></Field>
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
    <form action={action} className="max-w-2xl">
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
        <Field label="Estimates valid for (days)"><Input name="estimateValidDays" defaultValue={String(pricing.estimateValidDays)} inputMode="numeric" /></Field>
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
      <p className="text-sm text-muted">Placeholders: {"{{first_name}} {{project_types}} {{booking_url}} {{company_phone}} {{sender_name}}"}</p>
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

export function UsersPanel({ users, meId, isOwner }: { users: { id: string; name: string; email: string; role: string; active: boolean; mfa: boolean }[]; meId: string; isOwner: boolean }) {
  const [state, action, pending] = useActionState(createUserAction, null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const roles = ROLES.filter((r) => isOwner || r !== "owner");
  return (
    <div className="space-y-4">
      <Card>
        <Table>
          <thead><tr><th className={th}>Name</th><th className={th}>Role</th><th className={`${th} hidden sm:table-cell`}>2FA</th><th className={th}>Status</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className={td}><p className="font-medium">{u.name}</p><p className="text-xs text-muted">{u.email}</p></td>
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
                    <Button size="sm" variant={u.active ? "ghost" : "secondary"} disabled={busy} onClick={() => { if (!u.active || confirm(`Deactivate ${u.name}? They'll be signed out immediately.`)) start(async () => { const r = await updateUserAction(u.id, { active: !u.active }); setRowError(r.ok ? null : r.error); }); }}>
                      {u.active ? "Deactivate" : "Reactivate"}
                    </Button>
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
              <p className="mt-1 text-xs text-muted">Share it privately. It is shown only once; they should change it with “Forgot password”.</p>
            </div>
          )}
        </form>
      </Card>
    </div>
  );
}

export function IntegrationsInfo({ appUrl }: { appUrl: string }) {
  return (
    <div className="max-w-3xl space-y-4 text-sm">
      <Card>
        <CardHeader title="YouCanBook.me → Estimate Booked" />
        <div className="space-y-2 p-4 text-muted">
          <p>In YouCanBook.me, add a webhook notification for new bookings and cancellations that posts JSON to:</p>
          <code className="block break-all rounded bg-surface-2 p-2 font-mono text-xs text-text">{appUrl || "https://your-domain"}/api/inbound/youcanbookme?key=YOUR_WEBHOOK_SECRET</code>
          <p>The secret is the <code>INBOUND_WEBHOOK_SECRET</code> server setting. See <code>docs/integrations/youcanbookme.md</code> for the JSON template.</p>
        </div>
      </Card>
      <Card>
        <CardHeader title="Website form → New Lead" />
        <div className="space-y-2 p-4 text-muted">
          <p>Point your website form (or a Zapier step) at:</p>
          <code className="block break-all rounded bg-surface-2 p-2 font-mono text-xs text-text">{appUrl || "https://your-domain"}/api/inbound/form?key=YOUR_WEBHOOK_SECRET</code>
          <p>Accepts JSON or regular form posts with fields like name, email, phone, address, city, service, message.</p>
        </div>
      </Card>
      <Card>
        <CardHeader title="Email" />
        <p className="p-4 text-muted">Outgoing email is sent through Resend from your domain once <code>RESEND_API_KEY</code> is configured. Until then, messages are logged on the lead timeline but not delivered.</p>
      </Card>
    </div>
  );
}
