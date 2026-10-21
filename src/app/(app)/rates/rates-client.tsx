"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Badge, Button, Card, Field, FormError, Input, Select, Table, Textarea, td, th } from "@/components/ui";
import { UNIT_LABELS, type RateUnit } from "@/lib/estimating/engine";
import { formatCAD } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { deleteFactorAction, rateHistoryAction, saveFactorAction, saveMaterialAction, saveRateAction, setRateActiveAction } from "./actions";

export interface RateRowView {
  id: string;
  code: string;
  name: string;
  customerLabel: string;
  proposalGroup: string;
  category: string;
  unit: string;
  basis: string;
  dimensionSource: string;
  active: boolean;
  version: number;
  productionRate: string;
  additionalCoatFactor: string;
  defaultCoats: number;
  laborCostPerHour: string;
  billingRatePerHour: string;
  materialId: string;
  materialName: string;
  coverageOverride: string;
  materialWastePct: string;
  otherCostPerUnit: string;
  prepNotes: string;
  crewNotes: string;
  changeNote: string;
}

const VALUE_KEYS = ["productionRate", "additionalCoatFactor", "defaultCoats", "laborCostPerHour", "billingRatePerHour", "materialId", "coverageOverride", "materialWastePct", "otherCostPerUnit", "prepNotes", "crewNotes"] as const;

export function rateLabel(r: { productionRate: string; unit: string; basis: string }) {
  const u = UNIT_LABELS[r.unit as RateUnit] ?? r.unit;
  if (r.unit === "hour") return "hourly";
  return r.basis === "hours_per_unit" ? `${Number(r.productionRate)} hr / ${u === "each" ? "item" : u}` : `${Number(r.productionRate)} ${u} / hr`;
}

const BLANK: RateRowView = {
  id: "", code: "", name: "", customerLabel: "", proposalGroup: "", category: "Interior", unit: "sqft", basis: "units_per_hour", dimensionSource: "manual", active: true,
  version: 0, productionRate: "", additionalCoatFactor: "1", defaultCoats: 2, laborCostPerHour: "", billingRatePerHour: "", materialId: "", materialName: "",
  coverageOverride: "", materialWastePct: "0.10", otherCostPerUnit: "0", prepNotes: "", crewNotes: "", changeNote: "",
};

export function RatesTable({ rows, materials, canEdit, showArchived }: { rows: RateRowView[]; materials: { id: string; label: string }[]; canEdit: boolean; showArchived: boolean }) {
  const [editing, setEditing] = useState<RateRowView | null>(null);
  const [q, setQ] = useState("");
  const filtered = rows.filter((r) => !q || `${r.code} ${r.name} ${r.category}`.toLowerCase().includes(q.toLowerCase()));
  const groups = useMemo(() => {
    const m = new Map<string, RateRowView[]>();
    for (const r of filtered) m.set(r.category, [...(m.get(r.category) ?? []), r]);
    return [...m.entries()];
  }, [filtered]);
  const categories = [...new Set(rows.map((r) => r.category))];
  const proposalGroups = [...new Set(rows.map((r) => r.proposalGroup).filter(Boolean))];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter rates…" className="max-w-xs" />
        <Link href={showArchived ? "/rates" : "/rates?archived=1"} className="text-sm text-muted hover:text-text">{showArchived ? "Hide archived" : "Show archived"}</Link>
        <span className="flex-1" />
        {canEdit && <Button onClick={() => setEditing({ ...BLANK })}><Plus className="size-4" /> New rate</Button>}
      </div>
      <div className="space-y-4">
        {groups.map(([cat, list]) => (
          <Card key={cat}>
            <div className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">{cat}</div>
            <Table>
              <thead><tr>
                <th className={th}>Rate</th><th className={th}>Production</th><th className={`${th} hidden sm:table-cell`}>Coats</th>
                <th className={`${th} hidden md:table-cell`}>Material</th><th className={`${th} hidden lg:table-cell`}>Labour $/h</th><th className={`${th} hidden lg:table-cell`}>Ver.</th>
              </tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className={canEdit ? "cursor-pointer hover:bg-surface-2" : ""} onClick={() => canEdit && setEditing(r)}>
                    <td className={td}><span className="font-mono text-xs text-subtle">{r.code}</span> <span className="font-medium">{r.name}</span>{!r.active && <Badge className="ml-2">archived</Badge>}</td>
                    <td className={`${td} tabular`}>{rateLabel(r)}</td>
                    <td className={`${td} hidden sm:table-cell tabular`}>{r.defaultCoats}</td>
                    <td className={`${td} hidden max-w-56 truncate text-muted md:table-cell`}>{r.materialName || "—"}</td>
                    <td className={`${td} hidden tabular text-muted lg:table-cell`}>{r.laborCostPerHour ? formatCAD(r.laborCostPerHour) : "default"}</td>
                    <td className={`${td} hidden text-muted lg:table-cell`} title={r.changeNote}>v{r.version}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ))}
      </div>
      {editing && <RateEditor rate={editing} materials={materials} categories={categories} groups={proposalGroups} onClose={() => setEditing(null)} />}
    </>
  );
}

function RateEditor({ rate, materials, categories, groups, onClose }: { rate: RateRowView; materials: { id: string; label: string }[]; categories: string[]; groups: string[]; onClose: () => void }) {
  const [form, setForm] = useState(rate);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [history, setHistory] = useState<Awaited<ReturnType<typeof rateHistoryAction>> | null>(null);
  const set = (k: keyof RateRowView, v: string | number) => setForm((f) => ({ ...f, [k]: v }));
  const valuesChanged = !rate.id || VALUE_KEYS.some((k) => String(form[k] ?? "") !== String(rate[k] ?? ""));

  function save() {
    start(async () => {
      const r = await saveRateAction({
        id: rate.id || null,
        identity: { code: form.code, name: form.name, customerLabel: form.customerLabel, proposalGroup: form.proposalGroup, category: form.category, unit: form.unit, basis: form.unit === "hour" ? "units_per_hour" : form.basis, dimensionSource: form.dimensionSource },
        values: { ...Object.fromEntries(VALUE_KEYS.map((k) => [k, form[k]])), productionRate: form.unit === "hour" ? "1" : form.productionRate, changeNote: form.changeNote },
        valuesChanged,
      });
      if (r.ok) onClose();
      else setError(r.error);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:pt-12" role="dialog" aria-modal>
      <div className="w-full max-w-2xl rounded-lg bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-semibold">{rate.id ? `Edit ${rate.code}` : "New production rate"}</h2>
          {rate.id && <span className="text-xs text-muted">Current version v{rate.version}</span>}
        </div>
        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Code"><Input value={form.code} onChange={(e) => set("code", e.target.value)} /></Field>
            <Field label="Name" className="sm:col-span-3"><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Category" className="sm:col-span-2">
              <Input list="rate-categories" value={form.category} onChange={(e) => set("category", e.target.value)} />
              <datalist id="rate-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="Customer-facing name" className="sm:col-span-2"><Input value={form.customerLabel} onChange={(e) => set("customerLabel", e.target.value)} placeholder="Defaults to name" /></Field>
            <Field label="Proposal group" hint="Lines in the same group share one “Paint …” line on the proposal, e.g. Walls, Trim, Siding. Leave empty for prep and repairs." className="sm:col-span-2">
              <Input list="proposal-groups" value={form.proposalGroup} onChange={(e) => set("proposalGroup", e.target.value)} />
              <datalist id="proposal-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
            </Field>
          </div>
          <div className="grid gap-3 rounded-md bg-surface-2 p-3 sm:grid-cols-4">
            <Field label="Measured in">
              <Select value={form.unit} onChange={(e) => set("unit", e.target.value)}>
                <option value="sqft">Square feet</option><option value="lnft">Linear feet</option><option value="each">Items</option><option value="hour">Hours</option>
              </Select>
            </Field>
            {form.unit !== "hour" && (
              <>
                <Field label="Rate is">
                  <Select value={form.basis} onChange={(e) => set("basis", e.target.value)}>
                    <option value="units_per_hour">Units per hour</option><option value="hours_per_unit">Hours per unit</option>
                  </Select>
                </Field>
                <Field label={form.basis === "units_per_hour" ? `${UNIT_LABELS[form.unit as RateUnit]} per hour` : "Hours per unit"} hint="First coat">
                  <Input inputMode="decimal" value={form.productionRate} onChange={(e) => set("productionRate", e.target.value)} />
                </Field>
                <Field label="Extra coat time" hint="1 = same as first, 0.8 = 20% faster">
                  <Input inputMode="decimal" value={form.additionalCoatFactor} onChange={(e) => set("additionalCoatFactor", e.target.value)} />
                </Field>
                <Field label="Default coats"><Input type="number" min={0} max={6} value={form.defaultCoats} onChange={(e) => set("defaultCoats", Number(e.target.value))} /></Field>
                <Field label="Auto quantity from room" className="sm:col-span-3">
                  <Select value={form.dimensionSource} onChange={(e) => set("dimensionSource", e.target.value)}>
                    <option value="manual">Enter manually</option><option value="walls">Wall area (perimeter × height)</option>
                    <option value="ceiling">Ceiling area (L × W)</option><option value="floor">Floor area (L × W)</option><option value="perimeter">Perimeter (baseboards)</option>
                  </Select>
                </Field>
              </>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Labour cost $/h" hint="Blank = estimate default"><Input inputMode="decimal" value={form.laborCostPerHour} onChange={(e) => set("laborCostPerHour", e.target.value)} /></Field>
            <Field label="Billing rate $/h" hint="Blank = estimate default"><Input inputMode="decimal" value={form.billingRatePerHour} onChange={(e) => set("billingRatePerHour", e.target.value)} /></Field>
            <Field label="Other cost / unit" hint="Sundries, equipment"><Input inputMode="decimal" value={form.otherCostPerUnit} onChange={(e) => set("otherCostPerUnit", e.target.value)} /></Field>
            <Field label="Waste allowance" hint="0.10 = 10%"><Input inputMode="decimal" value={form.materialWastePct} onChange={(e) => set("materialWastePct", e.target.value)} /></Field>
            <Field label="Default product" className="sm:col-span-3">
              <Select value={form.materialId} onChange={(e) => set("materialId", e.target.value)}>
                <option value="">No material</option>
                {materials.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </Select>
            </Field>
            <Field label="Coverage override" hint="sq ft / gal"><Input inputMode="decimal" value={form.coverageOverride} onChange={(e) => set("coverageOverride", e.target.value)} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Prep notes (customer-facing)"><Textarea rows={2} value={form.prepNotes} onChange={(e) => set("prepNotes", e.target.value)} /></Field>
            <Field label="Crew notes (work order)"><Textarea rows={2} value={form.crewNotes} onChange={(e) => set("crewNotes", e.target.value)} /></Field>
          </div>
          {valuesChanged && rate.id && (
            <Field label="What changed and why?" hint="Saved with the new version so you can see the history later.">
              <Input value={form.changeNote} onChange={(e) => set("changeNote", e.target.value)} placeholder="e.g. Updated from crew actuals, Oct 2026" />
            </Field>
          )}
          {rate.id && (
            <div className="text-sm">
              {!history ? (
                <button type="button" className="text-brand hover:underline" onClick={async () => setHistory(await rateHistoryAction(rate.id))}>Show version history</button>
              ) : (
                <ul className="space-y-1 text-xs text-muted">
                  {history.map((h) => <li key={h.version}>v{h.version} · {formatDate(h.createdAt)} · rate {Number(h.productionRate)} · {h.defaultCoats} coats{h.changeNote ? ` · ${h.changeNote}` : ""}</li>)}
                </ul>
              )}
            </div>
          )}
          <FormError message={error} />
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          {rate.id ? (
            <Button variant="ghost" onClick={() => start(async () => { await setRateActiveAction(rate.id, !rate.active); onClose(); })}>{rate.active ? "Archive" : "Restore"}</Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={pending}>{pending ? "Saving…" : valuesChanged && rate.id ? `Save as v${rate.version + 1}` : "Save"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface MaterialView {
  id: string;
  manufacturer: string;
  name: string;
  finish: string;
  category: string;
  containerGallons: string;
  pricePerGallon: string;
  coverage: string;
  supplier: string;
  sku: string;
  notes: string;
  updatedAt: string;
}

export function MaterialsTable({ rows, canEdit }: { rows: MaterialView[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<Partial<MaterialView> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fields: [keyof MaterialView, string, string?][] = [
    ["manufacturer", "Manufacturer"], ["name", "Product"], ["finish", "Finish / sheen"], ["category", "Category"],
    ["pricePerGallon", "Price per gallon", "Your cost"], ["coverage", "Coverage", "sq ft per gallon per coat"], ["containerGallons", "Container size", "Gallons (1 = gallon, 5 = pail)"],
    ["supplier", "Supplier"], ["sku", "SKU"], ["notes", "Notes"],
  ];
  return (
    <>
      {canEdit && <div className="mb-3 flex justify-end"><Button onClick={() => setEditing({ category: "paint", containerGallons: "1", coverage: "350" })}><Plus className="size-4" /> New material</Button></div>}
      <Card>
        <Table>
          <thead><tr><th className={th}>Product</th><th className={th}>$ / gal</th><th className={`${th} hidden sm:table-cell`}>Coverage</th><th className={`${th} hidden md:table-cell`}>Supplier</th><th className={`${th} hidden lg:table-cell`}>Updated</th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className={canEdit ? "cursor-pointer hover:bg-surface-2" : ""} onClick={() => canEdit && setEditing(m)}>
                <td className={td}><span className="text-muted">{m.manufacturer}</span> <span className="font-medium">{m.name}</span>{m.finish && <span className="text-muted"> · {m.finish}</span>}</td>
                <td className={`${td} tabular`}>{formatCAD(m.pricePerGallon)}</td>
                <td className={`${td} hidden tabular sm:table-cell`}>{Number(m.coverage)} sq ft</td>
                <td className={`${td} hidden text-muted md:table-cell`}>{m.supplier || "—"}</td>
                <td className={`${td} hidden text-muted lg:table-cell`}>{formatDate(m.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {editing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:pt-12" role="dialog" aria-modal>
          <div className="w-full max-w-lg space-y-3 rounded-lg bg-surface p-5 shadow-xl">
            <h2 className="font-semibold">{editing.id ? "Edit material" : "New material"}</h2>
            <p className="text-xs text-muted">Price changes are kept in history. Existing estimates are not affected.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map(([k, label, hint]) => (
                <Field key={k} label={label} hint={hint}>
                  <Input value={String(editing[k] ?? "")} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} />
                </Field>
              ))}
            </div>
            <FormError message={error} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setEditing(null); setError(null); }}>Cancel</Button>
              <Button disabled={pending} onClick={() => start(async () => {
                const { id, updatedAt: _u, ...values } = editing;
                const r = await saveMaterialAction(id ?? null, values as Record<string, string>);
                if (r.ok) setEditing(null); else setError(r.error);
              })}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const KIND_LABELS: Record<string, string> = { prep: "Preparation", difficulty: "Difficulty", condition: "Surface condition", access: "Height / access" };

export function FactorsEditor({ rows, canEdit }: { rows: { id: string; kind: string; label: string; value: string }[]; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <p className="text-sm text-muted md:col-span-2">Multipliers adjust labour hours on a line. 1.00 = no change, 1.25 = 25% more time. They stack: prep × difficulty × condition × access.</p>
      {Object.entries(KIND_LABELS).map(([kind, title]) => (
        <Card key={kind}>
          <div className="border-b border-border px-4 py-2 text-sm font-semibold">{title}</div>
          <ul className="divide-y divide-border">
            {rows.filter((r) => r.kind === kind).map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-4 py-2">
                {canEdit ? (
                  <form className="flex flex-1 items-center gap-2" action={(f) => start(async () => {
                    const res = await saveFactorAction(r.id, { kind, label: String(f.get("label")), value: String(f.get("value")) });
                    setError(res.ok ? null : res.error);
                  })}>
                    <Input name="label" defaultValue={r.label} aria-label="Label" className="h-8 flex-1" />
                    <Input name="value" defaultValue={Number(r.value).toFixed(2)} aria-label="Multiplier" className="h-8 w-20 text-right tabular" inputMode="decimal" />
                    <Button size="sm" variant="secondary" type="submit" disabled={pending}>Save</Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (confirm(`Remove "${r.label}"? Existing estimates keep their values.`)) start(async () => { await deleteFactorAction(r.id); }); }}>Remove</Button>
                  </form>
                ) : (
                  <><span className="flex-1 text-sm">{r.label}</span><span className="tabular text-sm">× {Number(r.value).toFixed(2)}</span></>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <form className="flex gap-2 border-t border-border p-3" action={(f) => start(async () => {
              const res = await saveFactorAction(null, { kind, label: String(f.get("label")), value: String(f.get("value")) });
              setError(res.ok ? null : res.error);
            })}>
              <Input name="label" placeholder="New option" aria-label="New option label" className="h-8 flex-1" required />
              <Input name="value" placeholder="1.00" aria-label="New option multiplier" className="h-8 w-20" inputMode="decimal" required />
              <Button size="sm" type="submit" disabled={pending}>Add</Button>
            </form>
          )}
        </Card>
      ))}
      <FormError message={error} />
    </div>
  );
}
