"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Copy, Eye, History, Plus, Trash2, Undo2 } from "lucide-react";
import { Badge, Button, buttonClass, Card, CardHeader, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { calculateDoc, resolvedQuantity, type DocArea, type DocCostItem, type DocLine, type EstimateDoc } from "@/lib/estimating/document";
import { areaQuantities, crewDurationDays, UNIT_LABELS, type EstimateResult, type RateSnapshot } from "@/lib/estimating/engine";
import { d, formatCAD, formatNum, formatPct, marginToMarkup, priceForMargin } from "@/lib/money";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { STATUS_TONE } from "../status";
import {
  createRevisionAction,
  duplicateAction,
  restoreRevisionAction,
  saveEstimateAction,
  saveTemplateAction,
  setStatusAction,
  templatePartsAction,
} from "../actions";

interface RateOption {
  id: string;
  code: string;
  category: string;
  dimensionSource: string;
  snapshot: RateSnapshot;
}
interface FactorOption {
  kind: string;
  label: string;
  value: string;
  isDefault: boolean;
}
interface Revision {
  revision: number;
  reason: string | null;
  totals: Record<string, string>;
  createdAt: string;
}

type SaveState = "saved" | "dirty" | "saving" | "error";

const AREA_PRESETS: Record<string, string[]> = {
  room: ["Living room", "Dining room", "Kitchen", "Primary bedroom", "Bedroom", "Bathroom", "Hallway", "Stairwell", "Entry", "Family room", "Office", "Laundry"],
  elevation: ["Front elevation", "Rear elevation", "Left elevation", "Right elevation", "Garage", "Deck", "Fence"],
};

const uid = () => crypto.randomUUID();

const JOB_TYPES = [
  ["interior", "Interior"],
  ["exterior", "Exterior"],
  ["interior_exterior", "Interior & exterior"],
  ["cabinets", "Cabinets"],
  ["staining", "Deck / fence staining"],
  ["commercial", "Commercial"],
  ["strata", "Strata"],
  ["repairs", "Repairs"],
] as const;

/** Text input that only commits valid numbers, so half-typed values never break the maths. */
function NumInput({ value, onCommit, disabled, className, placeholder, ariaLabel }: { value: string | null | undefined; onCommit: (v: string) => void; disabled?: boolean; className?: string; placeholder?: string; ariaLabel: string }) {
  const [text, setText] = useState(value ?? "");
  const [focused, setFocused] = useState(false);
  return (
    <input
      aria-label={ariaLabel}
      inputMode="decimal"
      disabled={disabled}
      placeholder={placeholder}
      value={focused ? text : value ? String(Number(value)) : ""}
      onFocus={(e) => { setFocused(true); setText(value ? String(Number(value)) : ""); e.target.select(); }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const t = e.target.value.replace(/[^0-9.]/g, "");
        setText(t);
        if (t === "") onCommit("");
        else if (/^\d*\.?\d+$|^\d+\.?$/.test(t)) onCommit(t.endsWith(".") ? t.slice(0, -1) : t);
      }}
      className={cn("h-8 w-full rounded border border-border-strong bg-surface px-2 text-right text-sm tabular focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:border-transparent disabled:bg-transparent", className)}
    />
  );
}

function FactorSelect({ kind, value, factors, onChange, disabled }: { kind: string; value: string; factors: FactorOption[]; onChange: (v: string) => void; disabled?: boolean }) {
  const opts = factors.filter((f) => f.kind === kind);
  const match = opts.find((o) => Number(o.value) === Number(value));
  return (
    <select
      aria-label={kind}
      disabled={disabled}
      value={match ? match.value : value}
      onChange={(e) => onChange(e.target.value)}
      title={match ? `${match.label} ×${Number(match.value).toFixed(2)}` : `Custom ×${Number(value).toFixed(2)}`}
      className="h-8 w-full rounded border border-border-strong bg-surface px-1 text-xs focus:border-ring focus:outline-none disabled:border-transparent disabled:bg-transparent disabled:appearance-none"
    >
      {!match && <option value={value}>×{Number(value).toFixed(2)}</option>}
      {opts.map((o) => <option key={o.label} value={o.value}>{o.label} ×{Number(o.value).toFixed(2)}</option>)}
    </select>
  );
}

export function EstimateEditor({
  estimate,
  initialDoc,
  rates,
  factors,
  templates,
  revisions,
  hoursPerDay,
  canEdit,
  showCosting,
  proposalText,
  canEditWording,
}: {
  estimate: { id: string; number: number; status: string; revision: number; customerName: string; address: string | null; opportunityId: string | null; validUntil: string | null; updatedAt: string };
  initialDoc: EstimateDoc;
  rates: RateOption[];
  factors: FactorOption[];
  templates: { id: string; name: string }[];
  revisions: Revision[];
  hoursPerDay: string;
  canEdit: boolean;
  showCosting: boolean;
  /** Standard proposal wording per job type, shown as the starting point for per-job edits. */
  proposalText: Record<string, { preparation: string; areasExcluded: string }>;
  canEditWording: boolean;
}) {
  const [doc, setDocState] = useState<EstimateDoc>(initialDoc);
  const [undoStack, setUndoStack] = useState<{ doc: EstimateDoc; label: string }[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedLine, setExpandedLine] = useState<string | null>(null);
  const [crewSize, setCrewSize] = useState(3);
  const [targetMarginInput, setTargetMarginInput] = useState("");
  const [, startTransition] = useTransition();
  const firstRender = useRef(true);
  const docRef = useRef(doc);
  docRef.current = doc;

  const defaultFactor = useCallback((kind: string) => factors.find((f) => f.kind === kind && f.isDefault)?.value ?? "1", [factors]);

  /** Apply a change. Pass a label to make it undoable with a visible toast. */
  const update = useCallback((fn: (d: EstimateDoc) => EstimateDoc, undoLabel?: string) => {
    setDocState((prev) => {
      const next = fn(prev);
      setUndoStack((s) => [...s.slice(-49), { doc: prev, label: undoLabel ?? "change" }]);
      return next;
    });
    if (undoLabel) setToast(undoLabel);
  }, []);

  const undo = useCallback(() => {
    setUndoStack((s) => {
      const last = s.at(-1);
      if (!last) return s;
      setDocState(last.doc);
      setToast(null);
      return s.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey && canEdit) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, canEdit]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // Debounced autosave.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!canEdit) return;
    setSaveState("dirty");
    const t = setTimeout(async () => {
      setSaveState("saving");
      const r = await saveEstimateAction(estimate.id, docRef.current);
      if (r.ok) {
        setSaveState("saved");
        setSaveError(null);
      } else {
        setSaveState("error");
        setSaveError(r.error);
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [doc, canEdit, estimate.id]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveState === "dirty" || saveState === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveState]);

  const calc = useMemo((): { result: EstimateResult | null; error: string | null } => {
    try {
      return { result: calculateDoc(doc), error: null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : "Calculation error" };
    }
  }, [doc]);
  const result = calc.result;
  const lineResults = useMemo(() => new Map(result?.lines.map((l) => [l.id, l]) ?? []), [result]);

  const ratesByCategory = useMemo(() => {
    const m = new Map<string, RateOption[]>();
    for (const r of rates) m.set(r.category, [...(m.get(r.category) ?? []), r]);
    return [...m.entries()];
  }, [rates]);

  // ---- mutations -------------------------------------------------------
  const setSettings = (patch: Partial<EstimateDoc["settings"]>) => update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  const setArea = (id: string, patch: Partial<DocArea>) => update((d) => ({ ...d, areas: d.areas.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  const setLine = (id: string, patch: Partial<DocLine>) => update((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const setCost = (id: string, patch: Partial<DocCostItem>) => update((d) => ({ ...d, costItems: d.costItems.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  function addArea(name: string, kind: DocArea["kind"]) {
    const area: DocArea = { id: uid(), parentId: null, name, kind, length: null, width: null, height: kind === "room" ? "8" : null, notes: null };
    update((d) => ({ ...d, areas: [...d.areas, area] }));
  }

  function duplicateArea(id: string) {
    update((d) => {
      const src = d.areas.find((a) => a.id === id);
      if (!src) return d;
      const copy = { ...src, id: uid(), name: `${src.name} (copy)` };
      const lines = d.lines.filter((l) => l.areaId === id).map((l) => ({ ...l, id: uid(), areaId: copy.id }));
      const idx = d.areas.indexOf(src);
      return { ...d, areas: [...d.areas.slice(0, idx + 1), copy, ...d.areas.slice(idx + 1)], lines: [...d.lines, ...lines] };
    }, "Area duplicated");
  }

  function removeArea(id: string) {
    const name = doc.areas.find((a) => a.id === id)?.name ?? "Area";
    update((d) => ({ ...d, areas: d.areas.filter((a) => a.id !== id && a.parentId !== id), lines: d.lines.filter((l) => l.areaId !== id) }), `"${name}" deleted`);
  }

  function addLine(areaId: string | null, rateId: string) {
    const rate = rates.find((r) => r.id === rateId);
    if (!rate) return;
    const area = areaId ? doc.areas.find((a) => a.id === areaId) : undefined;
    const hasDims = area && d(area.length).gt(0) && d(area.width).gt(0);
    const source = hasDims && rate.dimensionSource !== "manual" ? (rate.dimensionSource as DocLine["quantitySource"]) : "manual";
    const line: DocLine = {
      id: uid(),
      areaId,
      description: rate.snapshot.name,
      customerDescription: null,
      rateSnapshot: rate.snapshot,
      quantity: "0",
      quantitySource: source,
      coats: rate.snapshot.defaultCoats,
      prepFactor: defaultFactor("prep"),
      difficultyFactor: defaultFactor("difficulty"),
      conditionFactor: defaultFactor("condition"),
      accessFactor: defaultFactor("access"),
      colour: null,
      sheen: null,
      overrideHours: null,
      overridePrice: null,
      isOptional: false,
      optionSelected: false,
    };
    update((dd) => ({ ...dd, lines: [...dd.lines, line] }));
  }

  function duplicateLine(id: string) {
    update((d) => {
      const i = d.lines.findIndex((l) => l.id === id);
      if (i < 0) return d;
      const copy = { ...d.lines[i], id: uid() };
      return { ...d, lines: [...d.lines.slice(0, i + 1), copy, ...d.lines.slice(i + 1)] };
    });
  }

  function removeLine(id: string) {
    const name = doc.lines.find((l) => l.id === id)?.description ?? "Item";
    update((d) => ({ ...d, lines: d.lines.filter((l) => l.id !== id) }), `"${name}" removed`);
  }

  /** Re-pull the current master rate into a line (explicit; never automatic). */
  function refreshRate(id: string) {
    const line = doc.lines.find((l) => l.id === id);
    const rate = rates.find((r) => r.id === line?.rateSnapshot.rateId);
    if (!line || !rate) return;
    setLine(id, { rateSnapshot: rate.snapshot });
    setToast(`Updated to current rate v${rate.snapshot.rateVersion}`);
  }

  function addCostItem(kind: DocCostItem["kind"]) {
    const labels = { subcontractor: "Subcontractor", equipment: "Equipment rental", material: "Additional materials", other: "Other cost" };
    update((d) => ({ ...d, costItems: [...d.costItems, { id: uid(), kind, description: labels[kind], cost: "0", markupPct: null, overridePrice: null, isOptional: false, optionSelected: false }] }));
  }

  async function applyTemplate(templateId: string) {
    const parts = await templatePartsAction(templateId);
    update((d) => ({ ...d, areas: [...d.areas, ...parts.areas], lines: [...d.lines, ...parts.lines], costItems: [...d.costItems, ...parts.costItems] }), "Template added");
  }

  // ---- rendering -------------------------------------------------------
  const ro = !canEdit;
  const standard = proposalText[doc.jobType] ?? proposalText.default ?? { preparation: "", areasExcluded: "" };
  const t = result?.totals;
  const staleRates = doc.lines.filter((l) => {
    const r = rates.find((x) => x.id === l.rateSnapshot.rateId);
    return r && r.snapshot.rateVersion !== l.rateSnapshot.rateVersion;
  }).length;

  const renderLine = (line: DocLine, area?: DocArea) => {
    const r = lineResults.get(line.id);
    const unit = UNIT_LABELS[line.rateSnapshot.unit];
    const qty = resolvedQuantity(line, area);
    const auto = line.quantitySource !== "manual";
    const expanded = expandedLine === line.id;
    const masterRate = rates.find((x) => x.id === line.rateSnapshot.rateId);
    const outdated = masterRate && masterRate.snapshot.rateVersion !== line.rateSnapshot.rateVersion;
    return (
      <div key={line.id} className={cn("border-t border-border px-3 py-2", line.isOptional && "bg-info-soft/40")}>
        <div className="grid grid-cols-12 items-center gap-2">
          <button type="button" onClick={() => setExpandedLine(expanded ? null : line.id)} className="col-span-12 flex min-w-0 items-center gap-1 text-left text-sm md:col-span-3" aria-expanded={expanded}>
            {expanded ? <ChevronDown className="size-3.5 shrink-0 text-subtle" /> : <ChevronRight className="size-3.5 shrink-0 text-subtle" />}
            <span className="truncate font-medium">{line.description}</span>
            {line.isOptional && <Badge tone="info" className="ml-1">option</Badge>}
            {outdated && <Badge tone="warning" className="ml-1" title="The master rate has changed since this line was added">rate changed</Badge>}
          </button>
          <div className="col-span-4 flex items-center gap-1 md:col-span-2">
            <NumInput ariaLabel="Quantity" value={qty} disabled={ro || auto} onCommit={(v) => setLine(line.id, { quantity: v || "0", quantitySource: "manual" })} />
            <span className="w-10 shrink-0 text-xs text-muted">{unit}</span>
          </div>
          <div className="col-span-2 md:col-span-1">
            <NumInput ariaLabel="Coats" value={String(line.coats)} disabled={ro || line.rateSnapshot.unit === "hour"} onCommit={(v) => setLine(line.id, { coats: Math.min(10, Math.max(0, Math.round(Number(v || 0)))) })} />
          </div>
          <div className="col-span-6 grid grid-cols-2 gap-1 md:col-span-3">
            <FactorSelect kind="prep" value={line.prepFactor} factors={factors} disabled={ro} onChange={(v) => setLine(line.id, { prepFactor: v })} />
            <FactorSelect kind="difficulty" value={line.difficultyFactor} factors={factors} disabled={ro} onChange={(v) => setLine(line.id, { difficultyFactor: v })} />
            <FactorSelect kind="condition" value={line.conditionFactor} factors={factors} disabled={ro} onChange={(v) => setLine(line.id, { conditionFactor: v })} />
            <FactorSelect kind="access" value={line.accessFactor} factors={factors} disabled={ro} onChange={(v) => setLine(line.id, { accessFactor: v })} />
          </div>
          <div className={cn("col-span-5 text-right text-sm tabular md:col-span-1", r?.hoursOverridden && "text-warning")} title="Labour hours">{r ? formatNum(r.hours, 1) : "—"} h</div>
          <div className={cn("col-span-5 text-right text-sm font-medium tabular md:col-span-1", r?.priceOverridden && "text-warning")}>{r ? formatCAD(r.price) : "—"}</div>
          <div className="col-span-2 flex justify-end gap-0.5 md:col-span-1">
            {!ro && (
              <>
                <button type="button" onClick={() => duplicateLine(line.id)} className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-text" aria-label="Duplicate line"><Copy className="size-3.5" /></button>
                <button type="button" onClick={() => removeLine(line.id)} className="rounded p-1 text-subtle hover:bg-danger-soft hover:text-danger" aria-label="Remove line"><Trash2 className="size-3.5" /></button>
              </>
            )}
          </div>
        </div>
        {expanded && (
          <div className="mt-2 grid gap-3 rounded-md bg-surface-2 p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Item name" className="sm:col-span-2"><Input disabled={ro} value={line.description} onChange={(e) => setLine(line.id, { description: e.target.value })} /></Field>
            <Field label="Colour"><Input disabled={ro} value={line.colour ?? ""} onChange={(e) => setLine(line.id, { colour: e.target.value || null })} placeholder="e.g. SW 7008 Alabaster" /></Field>
            <Field label="Sheen"><Input disabled={ro} value={line.sheen ?? ""} onChange={(e) => setLine(line.id, { sheen: e.target.value || null })} placeholder="e.g. Eggshell" /></Field>
            <Field label="Customer description" className="sm:col-span-2 lg:col-span-4"><Input disabled={ro} value={line.customerDescription ?? ""} onChange={(e) => setLine(line.id, { customerDescription: e.target.value || null })} placeholder="Shown on the proposal instead of the item name" /></Field>
            <Field label="Details for the customer" hint="For optional upgrades: what's included. Start lines with “- ” for bullets." className="sm:col-span-2 lg:col-span-4">
              <Textarea disabled={ro} rows={2} value={line.customerDetail ?? ""} onChange={(e) => setLine(line.id, { customerDetail: e.target.value || null })} />
            </Field>
            {area && line.rateSnapshot.unit !== "each" && line.rateSnapshot.unit !== "hour" && (
              <Field label="Quantity from room">
                <Select disabled={ro} value={line.quantitySource} onChange={(e) => setLine(line.id, { quantitySource: e.target.value as DocLine["quantitySource"] })}>
                  <option value="manual">Enter manually</option><option value="walls">Walls</option><option value="ceiling">Ceiling</option><option value="floor">Floor</option><option value="perimeter">Perimeter</option>
                </Select>
              </Field>
            )}
            <Field label="Override hours" hint={r ? `Calculated ${formatNum(r.calculatedHours, 2)} h` : undefined}><NumInput ariaLabel="Override hours" disabled={ro} value={line.overrideHours} placeholder="—" onCommit={(v) => setLine(line.id, { overrideHours: v || null })} /></Field>
            <Field label="Override price" hint={r ? `Calculated ${formatCAD(r.calculatedPrice)}` : undefined}><NumInput ariaLabel="Override price" disabled={ro} value={line.overridePrice} placeholder="—" onCommit={(v) => setLine(line.id, { overridePrice: v || null })} /></Field>
            <div className="flex flex-col justify-end gap-1">
              <label className="flex items-center gap-2"><input type="checkbox" disabled={ro} checked={line.isOptional} onChange={(e) => setLine(line.id, { isOptional: e.target.checked, optionSelected: false })} /> Optional upgrade</label>
              {line.isOptional && <label className="flex items-center gap-2"><input type="checkbox" disabled={ro} checked={line.optionSelected} onChange={(e) => setLine(line.id, { optionSelected: e.target.checked })} /> Customer accepted</label>}
            </div>
            {showCosting && r && (
              <div className="text-xs text-muted sm:col-span-2 lg:col-span-4">
                Rate: {line.rateSnapshot.basis === "hours_per_unit" ? `${Number(line.rateSnapshot.productionRate)} h/${unit}` : `${Number(line.rateSnapshot.productionRate)} ${unit}/h`} (v{line.rateSnapshot.rateVersion ?? "–"}) ·
                Labour {formatCAD(r.laborCost)} @ {formatCAD(r.laborRate)}/h · Material {formatNum(r.gallons, 2)} gal {formatCAD(r.materialCost)}{line.rateSnapshot.material ? ` (${line.rateSnapshot.material.productName})` : ""} · Other {formatCAD(r.otherCost)} · Cost {formatCAD(r.cost)} · Margin {formatPct(r.margin)}
                {outdated && !ro && <button type="button" onClick={() => refreshRate(line.id)} className="ml-2 text-brand hover:underline">Use current rate (v{masterRate?.snapshot.rateVersion})</button>}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const addLineSelect = (areaId: string | null) =>
    !ro && (
      <div className="border-t border-border px-3 py-2">
        <select
          aria-label="Add item"
          value=""
          onChange={(e) => { if (e.target.value) addLine(areaId, e.target.value); }}
          className="h-8 w-full max-w-xs rounded border border-dashed border-border-strong bg-surface px-2 text-sm text-muted focus:border-ring focus:outline-none"
        >
          <option value="">+ Add item…</option>
          {ratesByCategory.map(([cat, list]) => (
            <optgroup key={cat} label={cat}>{list.map((r) => <option key={r.id} value={r.id}>{r.snapshot.name}</option>)}</optgroup>
          ))}
        </select>
      </div>
    );

  const areaTotal = (areaId: string) =>
    doc.lines.filter((l) => l.areaId === areaId).reduce((s, l) => {
      const r = lineResults.get(l.id);
      return r && r.included ? { price: s.price.plus(r.price), hours: s.hours.plus(r.hours) } : s;
    }, { price: d(0), hours: d(0) });

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-subtle tabular">#{estimate.number}</span>
            <input
              aria-label="Estimate title"
              disabled={ro}
              value={doc.title}
              onChange={(e) => setDocState((p) => ({ ...p, title: e.target.value }))}
              className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-xl font-semibold tracking-tight hover:border-border focus:border-ring focus:outline-none disabled:hover:border-transparent"
            />
            <Badge tone={STATUS_TONE[estimate.status]}>{estimate.status}</Badge>
            {estimate.revision > 0 && <Badge>rev {estimate.revision}</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">{estimate.customerName}{estimate.address ? ` · ${estimate.address}` : ""}{estimate.validUntil ? ` · valid until ${formatDate(estimate.validUntil)}` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("text-xs", saveState === "error" ? "text-danger" : "text-subtle")} role="status">
            {ro ? (estimate.status === "accepted" ? "Accepted – locked" : "Read only") : saveState === "saved" ? "All changes saved" : saveState === "saving" ? "Saving…" : saveState === "dirty" ? "Unsaved changes" : "Save failed"}
          </span>
          {!ro && <Button size="sm" variant="ghost" disabled={!undoStack.length} onClick={undo} title="Undo (Ctrl+Z)"><Undo2 className="size-4" /> Undo</Button>}
          <EstimateMenu estimateId={estimate.id} status={estimate.status} canEdit={canEdit} templates={templates} onApplyTemplate={applyTemplate} />
        </div>
      </div>
      <FormError message={saveError} />
      {calc.error && <FormError message={calc.error} />}
      {staleRates > 0 && !ro && (
        <p className="mb-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">{staleRates} line{staleRates > 1 ? "s use" : " uses"} an older version of a production rate. Prices stay as estimated unless you choose “Use current rate” on the line.</p>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        {/* Main column */}
        <div className="min-w-0 space-y-3">
          <div className="hidden grid-cols-12 gap-2 px-3 text-xs font-medium uppercase tracking-wide text-subtle md:grid">
            <span className="col-span-3">Item</span><span className="col-span-2">Quantity</span><span className="col-span-1">Coats</span>
            <span className="col-span-3">Prep · Difficulty · Condition · Access</span><span className="col-span-1 text-right">Hours</span><span className="col-span-1 text-right">Price</span>
          </div>

          {doc.areas.map((area) => {
            const isCollapsed = collapsed.has(area.id);
            const dims = areaQuantities(area);
            const tot = areaTotal(area.id);
            const lines = doc.lines.filter((l) => l.areaId === area.id);
            return (
              <Card key={area.id}>
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <button type="button" onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(area.id)) n.delete(area.id); else n.add(area.id); return n; })} className="rounded p-1 text-subtle hover:bg-surface-2" aria-label={isCollapsed ? "Expand area" : "Collapse area"}>
                    {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                  </button>
                  <input aria-label="Area name" disabled={ro} value={area.name} onChange={(e) => setArea(area.id, { name: e.target.value })} className="min-w-32 flex-1 rounded border border-transparent bg-transparent px-1 font-semibold hover:border-border focus:border-ring focus:outline-none disabled:hover:border-transparent" />
                  {area.kind === "room" && (
                    <div className="flex items-center gap-1 text-xs text-muted">
                      <span className="w-14"><NumInput ariaLabel="Length (ft)" value={area.length} placeholder="L" disabled={ro} onCommit={(v) => setArea(area.id, { length: v || null })} /></span>×
                      <span className="w-14"><NumInput ariaLabel="Width (ft)" value={area.width} placeholder="W" disabled={ro} onCommit={(v) => setArea(area.id, { width: v || null })} /></span>×
                      <span className="w-14"><NumInput ariaLabel="Height (ft)" value={area.height} placeholder="H" disabled={ro} onCommit={(v) => setArea(area.id, { height: v || null })} /></span>
                      <span className="hidden sm:inline">ft</span>
                      {dims.walls.gt(0) && <span className="ml-1 hidden text-subtle lg:inline">walls {formatNum(dims.walls, 0)} · ceiling {formatNum(dims.ceiling, 0)} sq ft</span>}
                    </div>
                  )}
                  <span className="ml-auto text-sm tabular text-muted">{formatNum(tot.hours, 1)} h · <span className="font-medium text-text">{formatCAD(tot.price)}</span></span>
                  {!ro && (
                    <>
                      <button type="button" onClick={() => duplicateArea(area.id)} className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-text" aria-label="Duplicate area" title="Duplicate area"><Copy className="size-4" /></button>
                      <button type="button" onClick={() => removeArea(area.id)} className="rounded p-1 text-subtle hover:bg-danger-soft hover:text-danger" aria-label="Delete area" title="Delete area"><Trash2 className="size-4" /></button>
                    </>
                  )}
                </div>
                {!isCollapsed && (
                  <>
                    <div className="border-t border-border px-3 py-1.5">
                      <input
                        aria-label={`Description for the customer: ${area.name}`}
                        disabled={ro}
                        value={area.customerDescription ?? ""}
                        onChange={(e) => setArea(area.id, { customerDescription: e.target.value || null })}
                        placeholder="Description for the customer (optional), e.g. Walls, ceiling and trim"
                        className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-sm text-muted placeholder:text-subtle hover:border-border focus:border-ring focus:outline-none disabled:hover:border-transparent"
                      />
                    </div>
                    {lines.map((l) => renderLine(l, area))}
                    {lines.length === 0 && <p className="border-t border-border px-3 py-2 text-sm text-subtle">No items yet.</p>}
                    {addLineSelect(area.id)}
                  </>
                )}
              </Card>
            );
          })}

          {(doc.lines.some((l) => !l.areaId) || doc.areas.length === 0) && (
            <Card>
              <div className="px-3 py-2 font-semibold">General items</div>
              {doc.lines.filter((l) => !l.areaId).map((l) => renderLine(l))}
              {addLineSelect(null)}
            </Card>
          )}

          {!ro && <AddAreaBar onAdd={addArea} />}

          <Card>
            <CardHeader title="Subcontractors, equipment & other costs" />
            {doc.costItems.map((c) => {
              const r = result?.costItems.find((x) => x.id === c.id);
              return (
                <div key={c.id} className="grid grid-cols-12 items-center gap-2 border-t border-border px-3 py-2 text-sm">
                  <Select disabled={ro} value={c.kind} onChange={(e) => setCost(c.id, { kind: e.target.value as DocCostItem["kind"] })} className="col-span-4 h-8 text-xs md:col-span-2">
                    <option value="subcontractor">Subcontractor</option><option value="equipment">Equipment</option><option value="material">Material</option><option value="other">Other</option>
                  </Select>
                  <Input disabled={ro} value={c.description} onChange={(e) => setCost(c.id, { description: e.target.value })} className="col-span-8 h-8 md:col-span-4" aria-label="Description" />
                  <div className="col-span-4 md:col-span-2"><NumInput ariaLabel="Cost" disabled={ro} value={c.cost} placeholder="Cost" onCommit={(v) => setCost(c.id, { cost: v || "0" })} /></div>
                  <div className="col-span-3 md:col-span-1"><NumInput ariaLabel="Markup %" disabled={ro} value={c.markupPct ? String(Number(c.markupPct) * 100) : ""} placeholder="mk%" onCommit={(v) => setCost(c.id, { markupPct: v ? String(Number(v) / 100) : null })} /></div>
                  <span className="col-span-3 text-right font-medium tabular md:col-span-2">{r ? formatCAD(r.price) : "—"}</span>
                  <div className="col-span-2 flex justify-end gap-1 md:col-span-1">
                    {!ro && <button type="button" onClick={() => update((dd) => ({ ...dd, costItems: dd.costItems.filter((x) => x.id !== c.id) }), "Cost item removed")} className="rounded p-1 text-subtle hover:bg-danger-soft hover:text-danger" aria-label="Remove cost item"><Trash2 className="size-3.5" /></button>}
                  </div>
                  <Input
                    disabled={ro}
                    value={c.customerDescription ?? ""}
                    onChange={(e) => setCost(c.id, { customerDescription: e.target.value || null })}
                    className="col-span-12 h-8 text-xs"
                    aria-label="Customer description"
                    placeholder="Customer description – leave empty to keep this cost off the proposal (it's still in the price)"
                  />
                </div>
              );
            })}
            {!ro && (
              <div className="flex flex-wrap gap-2 border-t border-border px-3 py-2">
                <Button size="sm" variant="ghost" onClick={() => addCostItem("subcontractor")}><Plus className="size-3.5" /> Subcontractor</Button>
                <Button size="sm" variant="ghost" onClick={() => addCostItem("equipment")}><Plus className="size-3.5" /> Equipment</Button>
                <Button size="sm" variant="ghost" onClick={() => addCostItem("other")}><Plus className="size-3.5" /> Other</Button>
              </div>
            )}
            <p className="border-t border-border px-3 py-2 text-xs text-subtle">Leave markup blank to price these the same way as the rest of the estimate.</p>
          </Card>

          <Card>
            <CardHeader
              title="Proposal details"
              description="What the customer sees besides the items above."
              action={<a href={`/estimates/${estimate.id}/proposal-preview`} target="_blank" rel="noopener" className={buttonClass("secondary", "sm")}><Eye className="size-4" /> Preview proposal</a>}
            />
            <div className="grid gap-4 p-4 md:grid-cols-2">
              <Field label="Job type" hint="Picks the cover photo, wording and warranty">
                <Select disabled={ro} value={doc.jobType} onChange={(e) => update((p) => ({ ...p, jobType: e.target.value }))}>
                  {JOB_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
              <Field label="PO number" hint="Shown on the proposal only when filled"><Input disabled={ro} value={doc.poNumber ?? ""} onChange={(e) => setDocState((p) => ({ ...p, poNumber: e.target.value || null }))} /></Field>
              <div className="md:col-span-2">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">Preparation</span>
                  {!ro && (doc.preparationOverride == null ? (
                    <button type="button" className="text-sm text-brand hover:underline" onClick={() => update((p) => ({ ...p, preparationOverride: standard.preparation }))}>Write custom preparation for this job</button>
                  ) : (
                    <button type="button" className="text-sm text-brand hover:underline" onClick={() => update((p) => ({ ...p, preparationOverride: null }), "Preparation reset")}>Use standard text</button>
                  ))}
                </div>
                {doc.preparationOverride == null ? (
                  <p className="whitespace-pre-line rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">{standard.preparation || "No standard preparation text for this job type."}</p>
                ) : (
                  <Textarea aria-label="Preparation" disabled={ro} rows={5} value={doc.preparationOverride} onChange={(e) => setDocState((p) => ({ ...p, preparationOverride: e.target.value }))} />
                )}
              </div>
              <div className="md:col-span-2">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">Areas to be excluded</span>
                  {!ro && (doc.areasExcluded == null ? (
                    <button type="button" className="text-sm text-brand hover:underline" onClick={() => update((p) => ({ ...p, areasExcluded: standard.areasExcluded }))}>Edit for this job</button>
                  ) : (
                    <button type="button" className="text-sm text-brand hover:underline" onClick={() => update((p) => ({ ...p, areasExcluded: null }), "Exclusions reset")}>Reset to standard</button>
                  ))}
                </div>
                {doc.areasExcluded == null ? (
                  <p className="whitespace-pre-line rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">{standard.areasExcluded || "None"}</p>
                ) : (
                  <Textarea aria-label="Areas to be excluded" disabled={ro} rows={4} value={doc.areasExcluded} onChange={(e) => setDocState((p) => ({ ...p, areasExcluded: e.target.value }))} />
                )}
                <p className="mt-1 text-xs text-subtle">One per line. The proposal adds “Any other area not listed in line # N” automatically.</p>
              </div>
              <Field label="Notes for the customer"><Textarea disabled={ro} rows={4} value={doc.customerNotes ?? ""} onChange={(e) => setDocState((p) => ({ ...p, customerNotes: e.target.value }))} /></Field>
              <Field label="Internal notes (never shown to customer)"><Textarea disabled={ro} rows={4} value={doc.internalNotes ?? ""} onChange={(e) => setDocState((p) => ({ ...p, internalNotes: e.target.value }))} /></Field>
              {canEditWording && <Link href="/settings/proposals" className="text-sm text-brand hover:underline md:col-span-2">Edit the standard wording and pictures in Settings → Proposals</Link>}
            </div>
          </Card>
        </div>

        {/* Side panel */}
        <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
          <Card>
            <CardHeader title="Summary" />
            {t ? (
              <dl className="space-y-1 p-4 text-sm">
                <Row label="Labour hours" value={`${formatNum(t.hours, 1)} h`} />
                <Row label={`Duration (${crewSize} painters)`} value={
                  <span className="flex items-center gap-1">
                    <select aria-label="Crew size" value={crewSize} onChange={(e) => setCrewSize(Number(e.target.value))} className="rounded border border-border bg-surface text-xs">{[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n}>{n}</option>)}</select>
                    {(() => { const days = crewDurationDays(t.hours, crewSize, hoursPerDay); return `${formatNum(days, 1)} ${days.eq(1) ? "day" : "days"}`; })()}
                  </span>
                } />
                {showCosting && (
                  <>
                    <div className="my-2 border-t border-border" />
                    <Row label="Labour cost" value={formatCAD(t.laborCost)} />
                    <Row label="Materials" value={formatCAD(t.materialCost)} />
                    {t.otherCost.gt(0) && <Row label="Sundries / other" value={formatCAD(t.otherCost)} />}
                    {t.subcontractorCost.gt(0) && <Row label="Subcontractors" value={formatCAD(t.subcontractorCost)} />}
                    {t.equipmentCost.gt(0) && <Row label="Equipment" value={formatCAD(t.equipmentCost)} />}
                    <Row label="Total cost" value={formatCAD(t.totalCost)} strong />
                  </>
                )}
                <div className="my-2 border-t border-border" />
                <Row label="Items subtotal" value={formatCAD(t.subtotal)} />
                {t.minimumAdjustment.gt(0) && <Row label="Minimum job adjustment" value={formatCAD(t.minimumAdjustment)} />}
                {t.discount.gt(0) && <Row label="Discount" value={`−${formatCAD(t.discount)}`} />}
                {!t.overrideAdjustment.isZero() && <Row label="Price override adjustment" value={formatCAD(t.overrideAdjustment)} />}
                <Row label="Price before GST" value={formatCAD(t.price)} strong />
                <Row label={`GST (${formatPct(doc.settings.gstRate, 0)})`} value={formatCAD(t.gst)} />
                <Row label="Total" value={formatCAD(t.total)} strong large />
                <Row label={`Deposit (${formatPct(doc.settings.depositPct, 0)})`} value={formatCAD(t.deposit)} />
                {t.unselectedOptionsPrice.gt(0) && <Row label="Optional upgrades offered" value={formatCAD(t.unselectedOptionsPrice)} muted />}
                {showCosting && (
                  <>
                    <div className="my-2 border-t border-border" />
                    <Row label="Gross profit" value={formatCAD(t.grossProfit)} strong />
                    <Row label="Gross margin" value={<span className={cn(t.grossMargin.lt(d(doc.settings.targetMargin).minus(0.05)) && "text-danger")}>{formatPct(t.grossMargin)}</span>} />
                    <Row label="Markup on cost" value={formatPct(t.markup)} />
                    {t.hours.gt(0) && <Row label="Effective $/labour hour" value={formatCAD(t.price.div(t.hours))} muted />}
                  </>
                )}
              </dl>
            ) : <p className="p-4 text-sm text-danger">Fix the highlighted values to see totals.</p>}
          </Card>

          {showCosting && (
            <Card>
              <CardHeader title="Pricing" description="Copied from company defaults when this estimate was created." />
              <div className="grid grid-cols-2 gap-3 p-4 text-sm">
                <Field label="Method" className="col-span-2">
                  <Select disabled={ro} value={doc.settings.pricingMethod} onChange={(e) => setSettings({ pricingMethod: e.target.value as "billing_rate" })}>
                    <option value="billing_rate">Billing rate × hours + marked-up materials</option>
                    <option value="target_margin">Cost ÷ (1 − target margin)</option>
                  </Select>
                </Field>
                <Field label="Labour cost $/h"><NumInput ariaLabel="Labour cost per hour" disabled={ro} value={doc.settings.laborCostPerHour} onCommit={(v) => setSettings({ laborCostPerHour: v || "0" })} /></Field>
                {doc.settings.pricingMethod === "billing_rate" ? (
                  <>
                    <Field label="Billing rate $/h"><NumInput ariaLabel="Billing rate per hour" disabled={ro} value={doc.settings.billingRatePerHour} onCommit={(v) => setSettings({ billingRatePerHour: v || "0" })} /></Field>
                    <Field label="Material markup %"><NumInput ariaLabel="Material markup percent" disabled={ro} value={String(Number(doc.settings.materialMarkupPct) * 100)} onCommit={(v) => setSettings({ materialMarkupPct: String(Number(v || 0) / 100) })} /></Field>
                  </>
                ) : (
                  <Field label="Target margin %"><NumInput ariaLabel="Target margin percent" disabled={ro} value={String(Number(doc.settings.targetMargin) * 100)} onCommit={(v) => setSettings({ targetMargin: String(Math.min(95, Number(v || 0)) / 100) })} /></Field>
                )}
                <Field label="Minimum job $"><NumInput ariaLabel="Minimum job price" disabled={ro} value={doc.settings.minimumJobPrice} onCommit={(v) => setSettings({ minimumJobPrice: v || "0" })} /></Field>
                <Field label="Discount $"><NumInput ariaLabel="Discount" disabled={ro} value={doc.settings.discount} placeholder="0" onCommit={(v) => setSettings({ discount: v || null })} /></Field>
                <Field label="Deposit %"><NumInput ariaLabel="Deposit percent" disabled={ro} value={String(Number(doc.settings.depositPct) * 100)} onCommit={(v) => setSettings({ depositPct: String(Math.min(100, Number(v || 0)) / 100) })} /></Field>
                <Field label="Final price override $" className="col-span-2" hint="Leave blank to use the calculated price."><NumInput ariaLabel="Price override" disabled={ro} value={doc.settings.priceOverride} placeholder="—" onCommit={(v) => setSettings({ priceOverride: v || null })} /></Field>
                <Field label="Contract type" className="col-span-2">
                  <Select disabled={ro} value={doc.contractType} onChange={(e) => update((dd) => ({ ...dd, contractType: e.target.value as "fixed_price" }))}>
                    <option value="fixed_price">Fixed price</option><option value="time_and_materials">Time & materials</option>
                  </Select>
                </Field>
              </div>
              {t && (
                <div className="border-t border-border p-4 text-sm">
                  <p className="mb-2 font-medium">Target-margin calculator</p>
                  <div className="flex items-center gap-2">
                    <span className="w-20"><NumInput ariaLabel="Desired margin percent" value={targetMarginInput} placeholder="e.g. 50" onCommit={setTargetMarginInput} /></span>
                    <span className="text-muted">% margin</span>
                  </div>
                  {targetMarginInput && Number(targetMarginInput) < 95 && (
                    <div className="mt-2 space-y-1 text-muted">
                      <p>Price needed: <span className="font-medium text-text">{formatCAD(priceForMargin(t.totalCost, Number(targetMarginInput) / 100))}</span> (markup {formatPct(marginToMarkup(Number(targetMarginInput) / 100))})</p>
                      {!ro && <Button size="sm" variant="secondary" onClick={() => setSettings({ priceOverride: priceForMargin(t.totalCost, Number(targetMarginInput) / 100).toDecimalPlaces(2).toFixed(2) })}>Set as final price</Button>}
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          {result && result.materials.length > 0 && (
            <Card>
              <CardHeader title="Materials" />
              <ul className="divide-y divide-border text-sm">
                {result.materials.map((m) => (
                  <li key={m.productName} className="flex justify-between gap-2 px-4 py-2">
                    <span className="min-w-0 truncate" title={m.productName}>{m.productName}</span>
                    <span className="shrink-0 tabular text-muted" title={m.containers != null ? `${m.containers} container(s) of ${Number(m.containerGallons)} gal` : undefined}>{formatNum(m.gallons, 1)} gal{m.containers != null && ` · buy ${m.containers} × ${Number(m.containerGallons)} gal`}{showCosting && ` · ${formatCAD(m.cost)}`}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Revisions estimateId={estimate.id} revisions={revisions} current={t ? { price: t.price.toFixed(2), totalCost: t.totalCost.toFixed(2), hours: t.hours.toFixed(2), grossMargin: t.grossMargin.toFixed(4) } : null} canEdit={canEdit} showCosting={showCosting} />
        </aside>
      </div>

      {toast && (
        <div className="fixed bottom-[calc(var(--app-bottom)+1rem)] left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-navy px-4 py-2.5 text-sm text-white shadow-lg" role="status">
          {toast}
          {undoStack.length > 0 && <button type="button" className="font-semibold text-accent hover:underline" onClick={undo}>Undo</button>}
        </div>
      )}
    </div>
  );

  function Row({ label, value, strong, large, muted }: { label: string; value: React.ReactNode; strong?: boolean; large?: boolean; muted?: boolean }) {
    return (
      <div className={cn("flex items-center justify-between gap-2", muted && "text-muted")}>
        <dt className={cn(!strong && "text-muted")}>{label}</dt>
        <dd className={cn("tabular", strong && "font-semibold", large && "text-lg")}>{value}</dd>
      </div>
    );
  }
}

function AddAreaBar({ onAdd }: { onAdd: (name: string, kind: DocArea["kind"]) => void }) {
  const [kind, setKind] = useState<DocArea["kind"]>("room");
  const [name, setName] = useState("");
  const presets = AREA_PRESETS[kind] ?? [];
  return (
    <Card className="p-3">
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onAdd(name.trim(), kind); setName(""); } }}>
        <Select aria-label="Area type" value={kind} onChange={(e) => setKind(e.target.value as DocArea["kind"])} className="h-9 w-auto">
          <option value="room">Room</option><option value="elevation">Elevation</option><option value="area">Area</option><option value="building">Building</option><option value="phase">Phase</option>
        </Select>
        <Input aria-label="Area name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Area name" className="h-9 max-w-56" list="area-presets" />
        <datalist id="area-presets">{presets.map((p) => <option key={p} value={p} />)}</datalist>
        <Button type="submit" size="sm" disabled={!name.trim()}><Plus className="size-4" /> Add area</Button>
        <span className="flex flex-wrap gap-1">
          {presets.slice(0, 6).map((p) => <button key={p} type="button" onClick={() => onAdd(p, kind)} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted hover:border-brand hover:text-brand">{p}</button>)}
        </span>
      </form>
    </Card>
  );
}

function EstimateMenu({ estimateId, status, canEdit, templates, onApplyTemplate }: { estimateId: string; status: string; canEdit: boolean; templates: { id: string; name: string }[]; onApplyTemplate: (id: string) => Promise<void> }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!canEdit && status !== "accepted") return null;
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => { const r = await fn(); setError(r.ok ? null : (r.error ?? "Failed")); });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canEdit && templates.length > 0 && (
        <select aria-label="Apply template" value="" disabled={pending} onChange={(e) => { if (e.target.value) start(() => onApplyTemplate(e.target.value)); }} className="h-8 rounded-md border border-border-strong bg-surface px-2 text-sm">
          <option value="">Add from template…</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      {canEdit && <Button size="sm" variant="secondary" disabled={pending} onClick={() => { const name = prompt("Template name"); if (name) act(() => saveTemplateAction(estimateId, name)); }}>Save as template</Button>}
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => duplicateAction(estimateId))}>Duplicate</Button>
      {canEdit && status === "draft" && <Button size="sm" disabled={pending} onClick={() => { if (confirm("Mark this estimate as sent? A revision snapshot will be saved.")) act(() => setStatusAction(estimateId, "sent")); }}>Mark as sent</Button>}
      {canEdit && status === "sent" && <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => setStatusAction(estimateId, "declined"))}>Mark declined</Button>}
      {canEdit && status !== "draft" && status !== "accepted" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => setStatusAction(estimateId, "draft"))}>Back to draft</Button>}
      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  );
}

function Revisions({ estimateId, revisions, current, canEdit, showCosting }: { estimateId: string; revisions: Revision[]; current: Record<string, string> | null; canEdit: boolean; showCosting: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-1.5"><History className="size-4" /> Revisions</span>} action={canEdit && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => { const reason = prompt("What changed in this revision? (optional)") ?? ""; start(async () => { const r = await createRevisionAction(estimateId, reason); setError(r.ok ? null : r.error); }); }}>Save revision</Button>
      )} />
      {revisions.length === 0 ? <p className="p-4 text-sm text-muted">No saved revisions. A revision is saved automatically when the estimate is sent.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-subtle"><th className="px-3 py-1.5">Rev</th><th className="px-3 py-1.5 text-right">Price</th>{showCosting && <th className="px-3 py-1.5 text-right">Margin</th>}<th className="px-3 py-1.5 text-right">Hours</th><th /></tr></thead>
            <tbody>
              {current && (
                <tr className="border-t border-border bg-brand-soft/40"><td className="px-3 py-1.5 font-medium">Current</td><td className="px-3 py-1.5 text-right tabular">{formatCAD(current.price)}</td>{showCosting && <td className="px-3 py-1.5 text-right tabular">{formatPct(current.grossMargin)}</td>}<td className="px-3 py-1.5 text-right tabular">{formatNum(current.hours, 1)}</td><td /></tr>
              )}
              {revisions.map((r) => (
                <tr key={r.revision} className="border-t border-border" title={r.reason ?? undefined}>
                  <td className="px-3 py-1.5">{r.revision}<span className="block text-subtle">{formatDateTime(r.createdAt)}</span>{r.reason && <span className="block max-w-32 truncate text-subtle">{r.reason}</span>}</td>
                  <td className="px-3 py-1.5 text-right tabular">{formatCAD(r.totals.price)}</td>
                  {showCosting && <td className="px-3 py-1.5 text-right tabular">{formatPct(r.totals.grossMargin)}</td>}
                  <td className="px-3 py-1.5 text-right tabular">{formatNum(r.totals.hours, 1)}</td>
                  <td className="px-3 py-1.5 text-right">{canEdit && <button type="button" disabled={pending} className="text-brand hover:underline" onClick={() => { if (confirm(`Restore revision ${r.revision}? The current version is saved as a new revision first.`)) start(async () => { const res = await restoreRevisionAction(estimateId, r.revision); if (res.ok) window.location.reload(); else setError(res.error); }); }}>Restore</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <FormError message={error} />
    </Card>
  );
}
