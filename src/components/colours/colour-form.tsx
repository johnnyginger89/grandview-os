"use client";
import { AlertTriangle, CheckCircle2, Plus, Printer, Trash2 } from "lucide-react";
import Image from "next/image";
import { useId, useState, useTransition } from "react";
import { SignaturePad } from "@/components/proposal/signature-pad";
import { Button, Field, FormError, Input, Textarea } from "@/components/ui";
import type { ColourClient, ColourRow } from "@/db/schema/colours";
import { colourLabel, type ColourDraftInput, type ColourSignInput } from "@/lib/colours/schemas";
import { formatDateTime } from "@/lib/utils";
import type { ColourFormData } from "@/server/colour-selections";

/*
 * The colour selection form: the customer's details, a row per surface (room, surface,
 * colour, code, sheen), the two warnings to agree to and a signature. The same form for
 * the customer's link, the office and the colour consultant (who hands the device to the
 * customer to sign). Once signed it shows the signed copy, ready to print.
 */

type Result = { ok: true; message?: string } | { ok: false; error: string };

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2, 14));
const blankRow = (room = ""): ColourRow => ({ id: newId(), room, surface: "", colour: "", code: "", sheen: "", lineId: null });

export function ColourForm({
  data,
  mode,
  save,
  sign,
}: {
  data: ColourFormData;
  /** "customer" = their own link; "staff" = office or colour consultant, with the customer signing on this device. */
  mode: "customer" | "staff";
  save?: (input: ColourDraftInput) => Promise<Result>;
  sign?: (input: ColourSignInput) => Promise<Result>;
}) {
  const ids = useId();
  const [rows, setRows] = useState<ColourRow[]>(data.rows.length ? data.rows : [blankRow()]);
  const [client, setClient] = useState<ColourClient>(data.client);
  const [notes, setNotes] = useState(data.notes ?? "");
  const [agreeChange, setAgreeChange] = useState(false);
  const [agreeCoverage, setAgreeCoverage] = useState(false);
  const [signedName, setSignedName] = useState(data.client.name);
  const [signature, setSignature] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const done = data.signed;

  const setRow = (i: number, patch: Partial<ColourRow>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const draft = (): ColourDraftInput => ({ rows, client, notes });

  if (done) return <SignedCopy data={data} />;

  const onSave = () =>
    save &&
    start(async () => {
      const r = await save(draft());
      setResult(r.ok ? { ok: true, message: r.message ?? (mode === "customer" ? "Saved. You can come back to this link to finish." : "Saved.") } : r);
      if (r.ok) setDirty(false);
    });

  const onSign = () => {
    if (!sign) return;
    setResult(null);
    start(async () => {
      const r = await sign({ ...draft(), signedName, signature, agreeChange: agreeChange as true, agreeCoverage: agreeCoverage as true });
      setResult(r);
      if (r.ok) setDirty(false);
    });
  };

  const field = (key: keyof ColourClient, label: string, type = "text", autoComplete?: string) => (
    <Field label={label}>
      <Input
        type={type}
        autoComplete={autoComplete}
        value={client[key]}
        onChange={(e) => {
          setClient((c) => ({ ...c, [key]: e.target.value }));
          setDirty(true);
        }}
      />
    </Field>
  );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <Header data={data} />

      <section aria-labelledby={`${ids}-you`} className="rounded-xl border border-border bg-surface p-4 sm:p-6">
        <h2 id={`${ids}-you`} className="text-lg font-semibold text-heading">{mode === "customer" ? "Your details" : "Customer"}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {field("name", "Name", "text", "name")}
          {field("phone", "Phone", "tel", "tel")}
          {field("email", "Email", "email", "email")}
          {field("address", "Address", "text", "street-address")}
        </div>
      </section>

      <section aria-labelledby={`${ids}-colours`} className="rounded-xl border border-border bg-surface p-4 sm:p-6">
        <h2 id={`${ids}-colours`} className="text-lg font-semibold text-heading">Colours</h2>
        <p className="mt-1 text-sm text-muted">One line for each surface: the room, what&apos;s being painted, the colour name and code, and the sheen.</p>
        <datalist id={`${ids}-rooms`}>{data.rooms.map((r) => <option key={r} value={r} />)}</datalist>
        <datalist id={`${ids}-surfaces`}>{data.surfaces.map((s) => <option key={s} value={s} />)}</datalist>
        <datalist id={`${ids}-sheens`}>{data.sheens.map((s) => <option key={s} value={s} />)}</datalist>
        <ol className="mt-4 space-y-3" aria-label="Colour rows">
          {rows.map((r, i) => (
            <li key={r.id} className="rounded-lg border border-border bg-surface-2/40 p-3" data-testid="colour-row">
              <div className="grid gap-2 sm:grid-cols-[1.1fr_1fr_1.1fr_0.8fr_0.8fr_auto] sm:items-end">
                <Field label="Room"><Input list={`${ids}-rooms`} value={r.room} placeholder="e.g. Kitchen" onChange={(e) => setRow(i, { room: e.target.value })} aria-label={`Room, line ${i + 1}`} /></Field>
                <Field label="Surface"><Input list={`${ids}-surfaces`} value={r.surface} placeholder="e.g. Walls" onChange={(e) => setRow(i, { surface: e.target.value })} aria-label={`Surface, line ${i + 1}`} /></Field>
                <Field label="Colour"><Input value={r.colour} placeholder="e.g. Alabaster" onChange={(e) => setRow(i, { colour: e.target.value })} aria-label={`Colour, line ${i + 1}`} /></Field>
                <Field label="Code"><Input value={r.code} placeholder="e.g. SW 7008" onChange={(e) => setRow(i, { code: e.target.value })} aria-label={`Colour code, line ${i + 1}`} /></Field>
                <Field label="Sheen"><Input list={`${ids}-sheens`} value={r.sheen} placeholder="e.g. Eggshell" onChange={(e) => setRow(i, { sheen: e.target.value })} aria-label={`Sheen, line ${i + 1}`} /></Field>
                <button
                  type="button"
                  onClick={() => {
                    setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [blankRow()]));
                    setDirty(true);
                  }}
                  aria-label={`Remove line ${i + 1}`}
                  className="grid size-11 place-items-center justify-self-end rounded-md text-muted hover:bg-danger-soft hover:text-danger sm:size-10"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ol>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => {
            setRows((rs) => [...rs, blankRow(rs.at(-1)?.room ?? "")]);
            setDirty(true);
          }}
        >
          <Plus className="size-4" aria-hidden /> Add a line
        </Button>
        <Field label="Anything else? (optional)" className="mt-4">
          <Textarea rows={3} maxLength={2000} value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} placeholder="e.g. Keep the front door as it is" />
        </Field>
      </section>

      <section aria-labelledby={`${ids}-sign`} className="rounded-xl border border-border bg-surface p-4 sm:p-6">
        <h2 id={`${ids}-sign`} className="text-lg font-semibold text-heading">Please read and sign</h2>
        <div className="mt-3 space-y-3">
          <Warning id={`${ids}-w1`} text={data.warnings.change} checked={agreeChange} onChange={setAgreeChange} />
          <Warning id={`${ids}-w2`} text={data.warnings.coverage} checked={agreeCoverage} onChange={setAgreeCoverage} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label={mode === "customer" ? "Your full name" : "Customer's full name"}>
            <Input value={signedName} autoComplete="name" onChange={(e) => setSignedName(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3">
          <span className="mb-1 block text-sm font-medium">{mode === "customer" ? "Your signature" : "Customer's signature"}</span>
          <SignaturePad onChange={setSignature} />
        </div>

        {result && !result.ok && <div className="mt-3"><FormError message={result.error} /></div>}
        {result?.ok && result.message && <p role="status" className="mt-3 rounded-md bg-success-soft px-3 py-2 text-sm text-success">{result.message}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={onSign} disabled={pending || !sign}>{pending ? "Saving…" : "Sign and submit colours"}</Button>
          {save && (
            <Button variant="secondary" onClick={onSave} disabled={pending}>
              {mode === "customer" ? "Save and finish later" : "Save"}
            </Button>
          )}
          {dirty && !pending && <span className="self-center text-xs text-muted">Not saved yet</span>}
        </div>
      </section>
    </div>
  );
}

function Warning({ id, text, checked, onChange }: { id: string; text: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning-soft/60 p-3">
      <p className="flex gap-2 text-sm text-text">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <span>{text}</span>
      </p>
      <label htmlFor={id} className="mt-2 flex min-h-11 items-center gap-2 text-sm font-medium">
        <input id={id} type="checkbox" className="size-5" checked={checked} onChange={(e) => onChange(e.target.checked)} /> I understand
      </label>
    </div>
  );
}

function Header({ data }: { data: ColourFormData }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-surface p-4 sm:p-6">
      <div>
        <Image src="/brand/logo-blue.png" alt={data.company.name || "Grandview Painting"} width={160} height={80} className="h-auto w-28 sm:w-36" loading="eager" />
      </div>
      <div className="text-right">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold uppercase tracking-wide text-brand">Colour selections</h1>
        <p className="font-medium">{data.jobTitle}</p>
        <p className="text-sm text-muted">Job #{data.projectNumber}{data.address ? ` · ${data.address}` : ""}</p>
      </div>
    </header>
  );
}

/** The signed, read-only copy (also what prints). */
export function SignedCopy({ data }: { data: ColourFormData }) {
  const s = data.signed!;
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <Header data={data} />
      <p role="status" className="flex items-center gap-2 rounded-lg bg-success-soft px-4 py-3 text-sm text-success print:hidden">
        <CheckCircle2 className="size-5 shrink-0" aria-hidden />
        <span>
          Signed by {s.name} on {formatDateTime(s.at)}.{data.status === "replaced" ? " These colours were later changed; this copy is kept for the record." : " Thank you!"}
        </span>
      </p>
      <section className="rounded-xl border border-border bg-surface p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-heading">Customer</h2>
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_1fr]">
          {(["name", "phone", "email", "address"] as const).map((k) => (
            <div key={k} className="contents">
              <dt className="text-muted capitalize">{k}</dt>
              <dd>{data.client[k] || "—"}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="rounded-xl border border-border bg-surface p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-heading">Colours</h2>
        <table className="mt-3 w-full text-sm" aria-label="Signed colours">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-subtle">
              <th className="py-2 pr-3">Room</th>
              <th className="py-2 pr-3">Surface</th>
              <th className="py-2 pr-3">Colour</th>
              <th className="py-2">Sheen</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-b-0">
                <td className="py-2 pr-3 align-top">{r.room || "—"}</td>
                <td className="py-2 pr-3 align-top">{r.surface || "—"}</td>
                <td className="py-2 pr-3 align-top font-medium">{colourLabel(r) || "—"}</td>
                <td className="py-2 align-top">{r.sheen || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.notes && <p className="mt-3 whitespace-pre-line text-sm"><span className="font-medium">Notes:</span> {data.notes}</p>}
      </section>
      <section className="rounded-xl border border-border bg-surface p-4 sm:p-6 print:break-inside-avoid">
        <h2 className="text-lg font-semibold text-heading">Agreed</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>{data.warnings.change}</li>
          <li>{data.warnings.coverage}</li>
        </ul>
        {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the signature pad */}
        {s.signature && <img src={s.signature} alt={`Signature of ${s.name}`} className="mt-4 h-24 rounded border border-border bg-white" />}
        <p className="mt-2 text-sm">
          {s.name} · {formatDateTime(s.at)} · {s.via === "device" ? "signed in person" : "signed online"}
        </p>
        <p className="mt-1 break-all text-xs text-subtle">Record {s.hash.slice(0, 16)}</p>
      </section>
      <div className="print:hidden">
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden /> Print or save as PDF
        </Button>
      </div>
    </div>
  );
}

