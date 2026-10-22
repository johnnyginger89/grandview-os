"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Ellipsis, Eye, History, Plus, Trash2, Undo2 } from "lucide-react";
import { Popover, popoverItem } from "@/components/app-shell/popover";
import { Dialog } from "@/components/dialog";
import { Badge, Button, buttonClass, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { calculateDoc, type DocArea, type DocCostItem, type DocLine, type EstimateDoc } from "@/lib/estimating/document";
import type { EstimateResult } from "@/lib/estimating/engine";
import { categoryOrder, presetGroupFor, type EstimatingPresets } from "@/lib/estimating/presets";
import { formatCAD, formatNum, formatPct } from "@/lib/money";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { STATUS_TONE } from "../status";
import { createRevisionAction, duplicateAction, restoreRevisionAction, saveEstimateAction, saveTemplateAction, setStatusAction, templatePartsAction } from "../actions";
import { AddRoom, type NewSurface } from "./add-room";
import { chip, NumInput, Section } from "./editor-parts";
import type { FactorOption, MaterialOption, RateOption, Revision } from "./editor-types";
import { useHideCosts } from "./hide-costs";
import type { ProposalProps } from "./proposal-types";
import { RoomCard, surfaceGroup, type ColourChoices, type RoomApi } from "./room-card";
import { proposalStatusText, SendControls, SentProposals } from "./send-proposal";
import { EstimateBar, TotalsPanel, type TotalsProps } from "./totals-panel";

type SaveState = "saved" | "dirty" | "saving" | "error";

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
  presets,
  recentColours,
  materials,
  proposals,
}: {
  estimate: { id: string; number: number; status: string; revision: number; customerId: string; customerName: string; address: string | null; opportunityId: string | null; validUntil: string | null; updatedAt: string; project: { id: string; number: number | null } | null };
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
  presets: EstimatingPresets;
  /** Colours used on other estimates lately. */
  recentColours: string[];
  /** Paint products to swap onto a surface; only for logins that may see costs. */
  materials: MaterialOption[];
  proposals: ProposalProps;
}) {
  const [doc, setDocState] = useState<EstimateDoc>(initialDoc);
  const [undoStack, setUndoStack] = useState<{ doc: EstimateDoc; label: string }[]>([]);
  // What the server has; anything else on screen is unsaved.
  const [savedDoc, setSavedDoc] = useState<EstimateDoc>(initialDoc);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [openRooms, setOpenRooms] = useState<Set<string>>(() => new Set(initialDoc.areas.length ? [initialDoc.areas[0].id] : []));
  const [expandedLine, setExpandedLine] = useState<string | null>(null);
  const [crewSize, setCrewSize] = useState(3);
  const [addingRoom, setAddingRoom] = useState(canEdit && initialDoc.areas.length === 0 && initialDoc.lines.length === 0);
  const [sheet, setSheet] = useState<"totals" | "versions" | "template" | null>(null);
  const [hideCosts] = useHideCosts();
  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);
  const saveState: SaveState = saveError ? "error" : saving ? "saving" : doc !== savedDoc ? "dirty" : "saved";

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
    if (!canEdit || doc === savedDoc) return;
    const t = setTimeout(async () => {
      const sending = docRef.current;
      setSaving(true);
      const r = await saveEstimateAction(estimate.id, sending);
      setSaving(false);
      if (r.ok) {
        setSavedDoc(sending);
        setSaveError(null);
      } else setSaveError(r.error);
    }, 1200);
    return () => clearTimeout(t);
  }, [doc, savedDoc, canEdit, estimate.id]);

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
  const categories = useMemo(() => categoryOrder(doc.jobType), [doc.jobType]);
  const outside = presetGroupFor(doc.jobType) === "outside";
  const roomPresets = useMemo(() => presets.rooms.filter((r) => r.group === presetGroupFor(doc.jobType) || (doc.jobType === "interior_exterior" && r.group === "outside")), [presets.rooms, doc.jobType]);

  const colours: ColourChoices = useMemo(() => {
    const areaName = new Map(doc.areas.map((a) => [a.id, a.name]));
    const seen = new Map<string, { colour: string; where: string }>();
    for (const l of doc.lines) {
      const c = l.colour?.trim();
      if (!c || seen.has(c.toLowerCase())) continue;
      seen.set(c.toLowerCase(), { colour: c, where: [l.areaId ? areaName.get(l.areaId) : null, surfaceGroup(l).toLowerCase()].filter(Boolean).join(" ") });
    }
    return { onEstimate: [...seen.values()], favourites: presets.favouriteColours, recent: recentColours, sheens: presets.sheens };
  }, [doc.lines, doc.areas, presets.favouriteColours, presets.sheens, recentColours]);

  // ---- changes ---------------------------------------------------------
  const setSettings = (patch: Partial<EstimateDoc["settings"]>) => update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  const setCost = (id: string, patch: Partial<DocCostItem>) => update((d) => ({ ...d, costItems: d.costItems.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  function makeLine(rate: RateOption, areaId: string | null, quantity: string, source: DocLine["quantitySource"]): DocLine {
    return {
      id: uid(),
      areaId,
      description: rate.snapshot.name,
      customerDescription: null,
      rateSnapshot: rate.snapshot,
      quantity,
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
  }

  const openOnly = (id: string) => setOpenRooms(new Set([id]));

  function addRoom(area: Omit<DocArea, "id">, surfaces: NewSurface[]) {
    const id = uid();
    const lines = surfaces.map((s) => makeLine(s.rate, id, s.quantity, s.from ?? "manual"));
    update((d) => ({ ...d, areas: [...d.areas, { ...area, id }], lines: [...d.lines, ...lines] }));
    openOnly(id);
  }

  const api: RoomApi = {
    setArea: (id, patch) => update((d) => ({ ...d, areas: d.areas.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
    setLine: (id, patch) => update((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
    setLines: (ids, patch, label) => {
      const set = new Set(ids);
      update((d) => ({ ...d, lines: d.lines.map((l) => (set.has(l.id) ? { ...l, ...patch(l) } : l)) }), label);
    },
    setGroup: (group, patch, label) => update((d) => ({ ...d, lines: d.lines.map((l) => (surfaceGroup(l) === group ? { ...l, ...patch(l) } : l)) }), label),
    addLine: (areaId, rateId) => {
      const rate = rates.find((r) => r.id === rateId);
      if (!rate) return;
      const area = areaId ? doc.areas.find((a) => a.id === areaId) : undefined;
      // Follows the room size even if it's typed later; typing a number makes it manual.
      const source = area && (area.kind === "room" || area.kind === "building") && rate.dimensionSource !== "manual" ? (rate.dimensionSource as DocLine["quantitySource"]) : "manual";
      const line = makeLine(rate, areaId, rate.snapshot.unit === "each" ? "1" : "0", source);
      update((d) => ({ ...d, lines: [...d.lines, line] }));
    },
    duplicateLine: (id) =>
      update((d) => {
        const i = d.lines.findIndex((l) => l.id === id);
        if (i < 0) return d;
        return { ...d, lines: [...d.lines.slice(0, i + 1), { ...d.lines[i], id: uid() }, ...d.lines.slice(i + 1)] };
      }),
    removeLine: (id) => {
      const name = doc.lines.find((l) => l.id === id)?.description ?? "Item";
      update((d) => ({ ...d, lines: d.lines.filter((l) => l.id !== id) }), `"${name}" removed`);
    },
    copyArea: (id) => {
      const copyId = uid();
      update((d) => {
        const src = d.areas.find((a) => a.id === id);
        if (!src) return d;
        const copy = { ...src, id: copyId, name: `${src.name} (copy)` };
        const lines = d.lines.filter((l) => l.areaId === id).map((l) => ({ ...l, id: uid(), areaId: copyId }));
        const idx = d.areas.indexOf(src);
        return { ...d, areas: [...d.areas.slice(0, idx + 1), copy, ...d.areas.slice(idx + 1)], lines: [...d.lines, ...lines] };
      }, "Room copied – check the name, size and counts");
      openOnly(copyId);
    },
    removeArea: (id) => {
      const name = doc.areas.find((a) => a.id === id)?.name ?? "Area";
      update((d) => ({ ...d, areas: d.areas.filter((a) => a.id !== id && a.parentId !== id), lines: d.lines.filter((l) => l.areaId !== id) }), `"${name}" deleted`);
    },
    /** Re-pull the current master rate into a line (explicit; never automatic). A paint picked by hand stays. */
    refreshRate: (id) => {
      const line = doc.lines.find((l) => l.id === id);
      const rate = rates.find((r) => r.id === line?.rateSnapshot.rateId);
      if (!line || !rate) return;
      const keep = line.rateSnapshot.materialOverridden ? { material: line.rateSnapshot.material, materialOverridden: true } : {};
      api.setLine(id, { rateSnapshot: { ...rate.snapshot, ...keep } });
      setToast(`Updated to current rate v${rate.snapshot.rateVersion}`);
    },
  };

  function addCostItem(kind: DocCostItem["kind"]) {
    const labels = { subcontractor: "Subcontractor", equipment: "Equipment rental", material: "Additional materials", other: "Other cost" };
    update((d) => ({ ...d, costItems: [...d.costItems, { id: uid(), kind, description: labels[kind], cost: "0", markupPct: null, overridePrice: null, isOptional: false, optionSelected: false }] }));
  }

  async function applyTemplate(templateId: string) {
    const parts = await templatePartsAction(templateId);
    update((d) => ({ ...d, areas: [...d.areas, ...parts.areas], lines: [...d.lines, ...parts.lines], costItems: [...d.costItems, ...parts.costItems] }), "Template added");
    if (parts.areas[0]) openOnly(parts.areas[0].id);
  }

  // ---- rendering -------------------------------------------------------
  const ro = !canEdit;
  // Logins without costing never see costs; "Hide costs" hides them from everyone else.
  const costs = showCosting && !hideCosts;
  const standard = proposalText[doc.jobType] ?? proposalText.default ?? { preparation: "", areasExcluded: "" };
  const t = result?.totals;
  const staleRates = doc.lines.filter((l) => {
    const r = rates.find((x) => x.id === l.rateSnapshot.rateId);
    return r && r.snapshot.rateVersion !== l.rateSnapshot.rateVersion;
  }).length;
  const options = doc.lines.filter((l) => l.isOptional);
  const optionsValue = options.reduce((s, l) => s + Number(lineResults.get(l.id)?.price ?? 0), 0);
  const extrasTotal = (result?.costItems ?? []).filter((c) => c.included).reduce((s, c) => s + Number(c.price), 0);
  const general = doc.lines.filter((l) => !l.areaId);
  const lastHeight = [...doc.areas].reverse().find((a) => a.kind === "room" && a.height)?.height ?? null;
  const statusText = proposalStatusText(proposals.rows);
  const totalsProps: TotalsProps = {
    doc,
    result,
    showCosting,
    ro,
    hoursPerDay,
    crewSize,
    setCrewSize,
    setSettings,
    setContractType: (v) => update((dd) => ({ ...dd, contractType: v })),
  };
  const roomCard = (area: DocArea | null, lines: DocLine[]) => {
    const key = area?.id ?? "general";
    return (
      <RoomCard
        key={key}
        area={area}
        lines={lines}
        lineResults={lineResults}
        rates={rates}
        categories={categories}
        factors={factors}
        colours={colours}
        materials={materials}
        showCosting={showCosting}
        ro={ro}
        open={openRooms.has(key)}
        onToggle={() => setOpenRooms((s) => {
          const n = new Set(s);
          if (n.has(key)) n.delete(key);
          else n.add(key);
          return n;
        })}
        expandedLine={expandedLine}
        setExpandedLine={setExpandedLine}
        api={api}
      />
    );
  };

  return (
    <div className="pb-24 xl:pb-8">
      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
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
          <p className="mt-1 text-sm text-muted">
            <Link href={`/customers/${estimate.customerId}`} className="hover:text-text hover:underline">{estimate.customerName}</Link>
            {estimate.address ? ` · ${estimate.address}` : ""}
            {estimate.validUntil ? ` · valid until ${formatDate(estimate.validUntil)}` : ""}
            {statusText && <> · <a href="#proposals" className="text-brand hover:underline">{statusText}</a></>}
          </p>
          {estimate.project && (
            <Link href={`/projects/${estimate.project.id}`} className="mt-2 inline-block rounded-md bg-success-soft px-3 py-1.5 text-sm text-success hover:underline">
              Accepted – job #{estimate.project.number} was created. Open the job →
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("text-xs", saveState === "error" ? "text-danger" : "text-subtle")} role="status">
            {ro ? (estimate.status === "accepted" ? "Accepted – locked" : "Read only") : saveState === "saved" ? "All changes saved" : saveState === "saving" ? "Saving…" : saveState === "dirty" ? "Unsaved changes" : "Save failed"}
          </span>
          {!ro && <Button size="sm" variant="ghost" disabled={!undoStack.length} onClick={undo} title="Undo (Ctrl+Z)"><Undo2 className="size-4" aria-hidden /> Undo</Button>}
          <a href={`/estimates/${estimate.id}/proposal-preview`} target="_blank" rel="noopener" className={buttonClass("secondary", "sm")}>
            <Eye className="size-4" aria-hidden /> Preview
          </a>
          <div className="hidden xl:block">
            <SendControls estimateId={estimate.id} status={estimate.status} proposals={proposals} />
          </div>
          <EstimateMenu estimateId={estimate.id} status={estimate.status} canEdit={canEdit} onVersions={() => setSheet("versions")} onSaveTemplate={() => setSheet("template")} />
        </div>
      </div>
      <FormError message={saveError} />
      {calc.error && <FormError message={calc.error} />}
      {staleRates > 0 && !ro && (
        <p className="mb-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          {staleRates} line{staleRates > 1 ? "s use" : " uses"} an older version of a production rate. Prices stay as estimated unless you choose “Use current rate” on the line.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-3">
          {/* Job type: picks the rooms offered, the rate order and the proposal wording */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-muted">Job type</span>
            {/* Phones get one dropdown instead of three rows of chips */}
            <Select aria-label="Job type (phone)" disabled={ro} value={doc.jobType} onChange={(e) => update((p) => ({ ...p, jobType: e.target.value }))} className="h-10 w-auto sm:hidden">
              {JOB_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            {JOB_TYPES.map(([v, l]) => (
              <button key={v} type="button" disabled={ro} aria-pressed={doc.jobType === v} onClick={() => update((p) => ({ ...p, jobType: v }))} className={cn(chip(doc.jobType === v), "hidden min-h-8 text-xs disabled:opacity-60 sm:inline-flex")}>
                {l}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-subtle">{outside ? "Areas" : "Rooms"} ({doc.areas.length})</h2>
            {doc.areas.length > 1 && (
              <button type="button" className="min-h-9 text-sm text-brand hover:underline" onClick={() => setOpenRooms(openRooms.size >= doc.areas.length ? new Set() : new Set(doc.areas.map((a) => a.id)))}>
                {openRooms.size >= doc.areas.length ? "Close all" : "Open all"}
              </button>
            )}
          </div>

          {doc.areas.map((area) => roomCard(area, doc.lines.filter((l) => l.areaId === area.id)))}
          {general.length > 0 && roomCard(null, general)}

          {!ro &&
            (addingRoom ? (
              <AddRoom presets={roomPresets} rates={rates} categories={categories} lastHeight={lastHeight} outside={outside} onAdd={addRoom} onClose={() => setAddingRoom(false)} />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => setAddingRoom(true)}>
                  <Plus className="size-4" aria-hidden /> Add {outside ? "area" : "room"}
                </Button>
                {templates.length > 0 && (
                  <Select aria-label="Apply template" value="" onChange={(e) => { if (e.target.value) void applyTemplate(e.target.value); }} className="h-10 w-auto">
                    <option value="">Add rooms from a template…</option>
                    {templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
                  </Select>
                )}
                {general.length === 0 && (
                  <Select aria-label="Add a general item" value="" onChange={(e) => { if (e.target.value) api.addLine(null, e.target.value); }} className="h-10 w-auto">
                    <option value="">+ Item not in a room…</option>
                    {rates.map((r) => <option key={r.id} value={r.id}>{r.snapshot.name}</option>)}
                  </Select>
                )}
              </div>
            ))}

          <Section title="Extras" summary={`subcontractors, equipment, other · ${formatCAD(extrasTotal)}`} defaultOpen={doc.costItems.length > 0}>
            {doc.costItems.map((c) => {
              const r = result?.costItems.find((x) => x.id === c.id);
              return (
                <div key={c.id} className="grid grid-cols-12 items-center gap-2 border-t border-border px-3 py-2 text-sm first:border-t-0">
                  <Select disabled={ro} value={c.kind} onChange={(e) => setCost(c.id, { kind: e.target.value as DocCostItem["kind"] })} className="col-span-4 h-9 text-xs md:col-span-2">
                    <option value="subcontractor">Subcontractor</option><option value="equipment">Equipment</option><option value="material">Material</option><option value="other">Other</option>
                  </Select>
                  <Input disabled={ro} value={c.description} onChange={(e) => setCost(c.id, { description: e.target.value })} className="col-span-8 h-9 md:col-span-4" aria-label="Description" />
                  {costs && (
                    <>
                      <div className="col-span-4 md:col-span-2"><NumInput ariaLabel="Cost" disabled={ro} value={c.cost} placeholder="Cost" onCommit={(v) => setCost(c.id, { cost: v || "0" })} /></div>
                      <div className="col-span-3 md:col-span-1"><NumInput ariaLabel="Markup %" disabled={ro} value={c.markupPct ? String(Number(c.markupPct) * 100) : ""} placeholder="mk%" onCommit={(v) => setCost(c.id, { markupPct: v ? String(Number(v) / 100) : null })} /></div>
                    </>
                  )}
                  <span className={cn("text-right font-medium tabular", costs ? "col-span-3 md:col-span-2" : "col-span-10 md:col-span-5")}>{r ? formatCAD(r.price) : "—"}</span>
                  <div className="col-span-2 flex justify-end md:col-span-1">
                    {!ro && <button type="button" onClick={() => update((dd) => ({ ...dd, costItems: dd.costItems.filter((x) => x.id !== c.id) }), "Cost item removed")} className="grid size-11 place-items-center rounded-md text-subtle hover:bg-danger-soft hover:text-danger sm:size-8" aria-label="Remove cost item"><Trash2 className="size-3.5" aria-hidden /></button>}
                  </div>
                  <Input disabled={ro} value={c.customerDescription ?? ""} onChange={(e) => setCost(c.id, { customerDescription: e.target.value || null })} className="col-span-12 h-9 text-xs" aria-label="Customer description" placeholder="Customer description – leave empty to keep this cost off the proposal (it's still in the price)" />
                </div>
              );
            })}
            {!ro && (
              <div className="flex flex-wrap gap-2 border-t border-border px-3 py-2">
                <Button size="sm" variant="ghost" onClick={() => addCostItem("subcontractor")}><Plus className="size-3.5" aria-hidden /> Subcontractor</Button>
                <Button size="sm" variant="ghost" onClick={() => addCostItem("equipment")}><Plus className="size-3.5" aria-hidden /> Equipment</Button>
                <Button size="sm" variant="ghost" onClick={() => addCostItem("other")}><Plus className="size-3.5" aria-hidden /> Other</Button>
              </div>
            )}
            {costs && <p className="border-t border-border px-3 py-2 text-xs text-subtle">Leave markup blank to price these the same way as the rest of the estimate.</p>}
          </Section>

          <Section title="Options the customer can add" summary={options.length ? `${options.length} · ${formatCAD(optionsValue)}` : "none yet"} defaultOpen={options.length > 0}>
            {options.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted">Open any surface and tick “Optional upgrade”. The customer can add it on the proposal; it isn&apos;t in the total unless pre-selected.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {options.map((l) => {
                  const room = doc.areas.find((a) => a.id === l.areaId)?.name;
                  return (
                    <li key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1">{[room, l.customerDescription || l.description].filter(Boolean).join(" – ")}</span>
                      <label className="flex min-h-9 items-center gap-2 text-xs text-muted">
                        <input type="checkbox" className="size-4" disabled={ro} checked={l.optionSelected} onChange={(e) => api.setLine(l.id, { optionSelected: e.target.checked })} /> Pre-selected
                      </label>
                      <span className="w-20 text-right font-medium tabular">{formatCAD(lineResults.get(l.id)?.price ?? 0)}</span>
                      {!ro && <button type="button" className="min-h-9 text-xs text-muted hover:text-text" onClick={() => api.setLine(l.id, { isOptional: false, optionSelected: false })}>Include in price</button>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section
            title="Proposal wording & notes"
            summary={[JOB_TYPES.find(([v]) => v === doc.jobType)?.[1], doc.preparationOverride == null ? "standard preparation" : "custom preparation", doc.internalNotes ? "internal notes" : null].filter(Boolean).join(" · ")}
          >
            <div className="grid gap-4 p-4 md:grid-cols-2">
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
          </Section>

          <SentProposals estimateId={estimate.id} proposals={proposals} />
        </div>

        {/* Big screens: the totals stay beside the estimate */}
        <aside className="hidden xl:sticky xl:top-[calc(var(--app-top)+1rem)] xl:block xl:self-start">
          <TotalsPanel {...totalsProps} />
        </aside>
      </div>

      <EstimateBar result={result} onOpen={() => setSheet("totals")} send={<SendControls estimateId={estimate.id} status={estimate.status} proposals={proposals} compact />} />

      <Dialog open={sheet === "totals"} onClose={() => setSheet(null)} title="Totals" className="w-[min(28rem,calc(100vw-1rem))]">
        <TotalsPanel {...totalsProps} />
      </Dialog>
      <Dialog open={sheet === "versions"} onClose={() => setSheet(null)} title={<span className="flex items-center gap-1.5"><History className="size-4" aria-hidden /> Versions</span>} className="w-[min(36rem,calc(100vw-2rem))]">
        <Revisions estimateId={estimate.id} revisions={revisions} current={t ? { price: t.price.toFixed(2), totalCost: t.totalCost.toFixed(2), hours: t.hours.toFixed(2), grossMargin: t.grossMargin.toFixed(4) } : null} canEdit={canEdit} showCosting={costs} />
      </Dialog>
      {sheet === "template" && <SaveTemplateDialog estimateId={estimate.id} onClose={() => setSheet(null)} onSaved={() => setToast("Saved as a template")} />}

      {toast && (
        <div className="fixed bottom-[calc(var(--app-bottom)+5rem)] left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-navy px-4 py-2.5 text-sm text-white shadow-lg xl:bottom-6" role="status">
          {toast}
          {undoStack.length > 0 && <button type="button" className="font-semibold text-accent hover:underline" onClick={undo}>Undo</button>}
        </div>
      )}
    </div>
  );
}

function EstimateMenu({ estimateId, status, canEdit, onVersions, onSaveTemplate }: { estimateId: string; status: string; canEdit: boolean; onVersions: () => void; onSaveTemplate: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => { const r = await fn(); setError(r.ok ? null : (r.error ?? "Failed")); });
  return (
    <div className="flex items-center gap-2">
      <Popover label="Estimate menu" align="right" buttonClassName="grid size-9 place-items-center rounded-lg border border-border-strong bg-surface text-muted hover:bg-surface-2" button={<Ellipsis className="size-4" aria-hidden />}>
        {(close) => (
          <>
            <button type="button" className={popoverItem} disabled={pending} onClick={() => { close(); act(() => duplicateAction(estimateId)); }}>Duplicate estimate</button>
            {canEdit && <button type="button" className={popoverItem} onClick={() => { close(); onSaveTemplate(); }}>Save as template</button>}
            <button type="button" className={popoverItem} onClick={() => { close(); onVersions(); }}>Versions</button>
            {canEdit && status === "sent" && <button type="button" className={popoverItem} disabled={pending} onClick={() => { close(); act(() => setStatusAction(estimateId, "declined")); }}>Mark declined</button>}
            {canEdit && status !== "draft" && status !== "accepted" && <button type="button" className={popoverItem} disabled={pending} onClick={() => { close(); act(() => setStatusAction(estimateId, "draft")); }}>Back to draft</button>}
          </>
        )}
      </Popover>
      {error && <span role="alert" className="text-sm text-danger">{error}</span>}
    </div>
  );
}

function SaveTemplateDialog({ estimateId, onClose, onSaved }: { estimateId: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog
      open
      onClose={onClose}
      title="Save as template"
      description="The rooms, surfaces and extras, without sizes you'd change. New estimates can start from it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button
            disabled={pending || !name.trim()}
            onClick={() =>
              start(async () => {
                const r = await saveTemplateAction(estimateId, name.trim());
                if (!r.ok) return setError(r.error ?? "Couldn't save the template");
                onSaved();
                onClose();
              })
            }
          >
            {pending ? "Saving…" : "Save template"}
          </Button>
        </>
      }
    >
      <Field label="Template name" hint="e.g. Interior repaint – 3 bed">
        <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-autofocus />
      </Field>
      <FormError message={error} />
    </Dialog>
  );
}

function Revisions({ estimateId, revisions, current, canEdit, showCosting }: { estimateId: string; revisions: Revision[]; current: Record<string, string> | null; canEdit: boolean; showCosting: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="What changed? (optional)" className="min-w-48 flex-1"><Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
          <Button variant="secondary" disabled={pending} onClick={() => start(async () => { const r = await createRevisionAction(estimateId, reason); setError(r.ok ? null : r.error); if (r.ok) setReason(""); })}>Save a version</Button>
        </div>
      )}
      {revisions.length === 0 ? (
        <p className="text-sm text-muted">No saved versions. One is saved automatically when the estimate is sent.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-subtle"><th className="px-2 py-1.5">Version</th><th className="px-2 py-1.5 text-right">Price</th>{showCosting && <th className="px-2 py-1.5 text-right">Margin</th>}<th className="px-2 py-1.5 text-right">Hours</th><th /></tr></thead>
            <tbody>
              {current && (
                <tr className="border-t border-border bg-brand-soft/40"><td className="px-2 py-1.5 font-medium">Now</td><td className="px-2 py-1.5 text-right tabular">{formatCAD(current.price)}</td>{showCosting && <td className="px-2 py-1.5 text-right tabular">{formatPct(current.grossMargin)}</td>}<td className="px-2 py-1.5 text-right tabular">{formatNum(current.hours, 1)}</td><td /></tr>
              )}
              {revisions.map((r) => (
                <tr key={r.revision} className="border-t border-border" title={r.reason ?? undefined}>
                  <td className="px-2 py-1.5">{r.revision}<span className="block text-subtle">{formatDateTime(r.createdAt)}</span>{r.reason && <span className="block max-w-40 truncate text-subtle">{r.reason}</span>}</td>
                  <td className="px-2 py-1.5 text-right tabular">{formatCAD(r.totals.price)}</td>
                  {showCosting && <td className="px-2 py-1.5 text-right tabular">{formatPct(r.totals.grossMargin)}</td>}
                  <td className="px-2 py-1.5 text-right tabular">{formatNum(r.totals.hours, 1)}</td>
                  <td className="px-2 py-1.5 text-right">{canEdit && <button type="button" disabled={pending} className="min-h-8 text-brand hover:underline" onClick={() => { if (confirm(`Go back to version ${r.revision}? The current one is saved as a new version first.`)) start(async () => { const res = await restoreRevisionAction(estimateId, r.revision); if (res.ok) window.location.reload(); else setError(res.error); }); }}>Restore</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <FormError message={error} />
    </div>
  );
}
