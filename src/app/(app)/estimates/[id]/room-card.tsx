"use client";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Copy, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";
import { Badge, Field, Input, Select, Textarea } from "@/components/ui";
import { resolvedQuantity, type DocArea, type DocLine } from "@/lib/estimating/document";
import { areaQuantities, quantityFromDimensions, UNIT_LABELS, type LineResult } from "@/lib/estimating/engine";
import { d, formatCAD, formatNum, formatPct } from "@/lib/money";
import { cn } from "@/lib/utils";
import { NumInput, Segmented, Stepper } from "./editor-parts";
import { FACTOR_FIELD, FACTOR_KINDS, type FactorOption, type MaterialOption, type RateOption, type SizeSource } from "./editor-types";

export interface ColourChoices {
  /** Colours already on this estimate, with where they're used ("Living room walls"). */
  onEstimate: { colour: string; where: string }[];
  favourites: string[];
  recent: string[];
  sheens: string[];
}

export interface RoomApi {
  setArea: (id: string, patch: Partial<DocArea>) => void;
  setLine: (id: string, patch: Partial<DocLine>) => void;
  /** One undoable change to several lines. */
  setLines: (ids: string[], patch: (l: DocLine) => Partial<DocLine>, label: string) => void;
  /** One undoable change to every line of a kind on the whole estimate ("all walls"). */
  setGroup: (group: string, patch: (l: DocLine) => Partial<DocLine>, label: string) => void;
  addLine: (areaId: string | null, rateId: string) => void;
  duplicateLine: (id: string) => void;
  removeLine: (id: string) => void;
  copyArea: (id: string) => void;
  removeArea: (id: string) => void;
  refreshRate: (id: string) => void;
}

const SOURCES: { value: DocLine["quantitySource"]; label: string }[] = [
  { value: "walls", label: "Walls" },
  { value: "ceiling", label: "Ceiling" },
  { value: "floor", label: "Floor" },
  { value: "perimeter", label: "Perimeter" },
  { value: "manual", label: "Typed" },
];

/** Lines that are "the same kind of surface": walls with walls, trim with trim. */
export const surfaceGroup = (l: DocLine) => l.rateSnapshot.proposalGroup || l.rateSnapshot.name;

const plural = (s: string) => (/s$/i.test(s) ? s : `${s}s`).toLowerCase();

function factorLabel(factors: FactorOption[], kind: string, value: string) {
  const f = factors.find((x) => x.kind === kind && Number(x.value) === Number(value));
  return f ? f.label : `×${Number(value).toFixed(2)}`;
}

/** "normal", "Heavy prep · Ladder" or "mixed" for a set of lines. */
export function conditionsSummary(lines: DocLine[], factors: FactorOption[]): string {
  if (!lines.length) return "normal";
  const parts: string[] = [];
  for (const { kind, label } of FACTOR_KINDS) {
    const values = new Set(lines.map((l) => Number(l[FACTOR_FIELD[kind]])));
    if (values.size > 1) return "mixed";
    const v = [...values][0];
    const def = factors.find((f) => f.kind === kind && f.isDefault);
    if (def && Number(def.value) === v) continue;
    parts.push(`${factorLabel(factors, kind, String(v))}${kind === "prep" ? " prep" : kind === "condition" ? ` ${label.toLowerCase()}` : ""}`);
  }
  return parts.join(" · ") || "normal";
}

function ConditionsPicker({ lines, factors, disabled, onChange }: { lines: DocLine[]; factors: FactorOption[]; disabled: boolean; onChange: (kind: keyof typeof FACTOR_FIELD, value: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {FACTOR_KINDS.map(({ kind, label }) => {
        const values = new Set(lines.map((l) => Number(l[FACTOR_FIELD[kind]])));
        const current = values.size === 1 ? factors.find((f) => f.kind === kind && Number(f.value) === [...values][0])?.value ?? null : null;
        return (
          <div key={kind}>
            <p className="mb-1 text-xs font-medium text-muted">{label}</p>
            <Segmented label={label} disabled={disabled} value={current} options={factors.filter((f) => f.kind === kind).map((f) => ({ value: f.value, label: f.label }))} onChange={(v) => onChange(kind, v)} />
          </div>
        );
      })}
    </div>
  );
}

export function RoomCard({
  area,
  lines,
  lineResults,
  rates,
  categories,
  factors,
  colours,
  materials,
  showCosting,
  ro,
  open,
  onToggle,
  expandedLine,
  setExpandedLine,
  api,
}: {
  area: DocArea | null;
  lines: DocLine[];
  lineResults: Map<string, LineResult>;
  rates: RateOption[];
  categories: string[];
  factors: FactorOption[];
  colours: ColourChoices;
  materials: MaterialOption[];
  showCosting: boolean;
  ro: boolean;
  open: boolean;
  onToggle: () => void;
  expandedLine: string | null;
  setExpandedLine: (id: string | null) => void;
  api: RoomApi;
}) {
  const [showConditions, setShowConditions] = useState(false);
  const sized = !!area && (area.kind === "room" || area.kind === "building");
  const dims = area ? areaQuantities(area) : null;
  const total = lines.reduce(
    (s, l) => {
      const r = lineResults.get(l.id);
      return r && r.included ? { price: s.price.plus(r.price), hours: s.hours.plus(r.hours) } : s;
    },
    { price: d(0), hours: d(0) },
  );
  const conditions = conditionsSummary(lines, factors);
  const name = area?.name ?? "General items";

  /** Up to 8 quick-add surfaces: this job's own kind of work first, ones already in the room left out. */
  const quick = useMemo(() => {
    const have = new Set(lines.map((l) => l.rateSnapshot.rateId));
    const rank = (c: string) => {
      const i = categories.indexOf(c);
      return i < 0 ? categories.length : i;
    };
    return rates
      .filter((r) => !have.has(r.id) && rank(r.category) === 0)
      .slice(0, 8);
  }, [rates, lines, categories]);
  const grouped = useMemo(() => {
    const m = new Map<string, RateOption[]>();
    const rank = (c: string) => {
      const i = categories.indexOf(c);
      return i < 0 ? categories.length : i;
    };
    for (const r of [...rates].sort((a, b) => rank(a.category) - rank(b.category))) m.set(r.category, [...(m.get(r.category) ?? []), r]);
    return [...m.entries()];
  }, [rates, categories]);

  return (
    <section aria-label={name} className="rounded-lg border border-border bg-surface shadow-card">
      {/* Room header: one line when closed */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
        <button type="button" onClick={onToggle} className="-ml-1 grid size-11 shrink-0 place-items-center rounded-md text-subtle hover:bg-surface-2 sm:size-9" aria-label={open ? `Close ${name}` : `Open ${name}`} aria-expanded={open}>
          {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
        </button>
        {area ? (
          <input
            aria-label="Area name"
            disabled={ro}
            value={area.name}
            onChange={(e) => api.setArea(area.id, { name: e.target.value })}
            className="min-w-28 flex-1 basis-32 rounded border border-transparent bg-transparent px-1 py-1 font-semibold hover:border-border focus:border-ring focus:outline-none disabled:hover:border-transparent"
          />
        ) : (
          <span className="flex-1 px-1 font-semibold">{name}</span>
        )}
        {area && sized && (
          <div className="flex items-center gap-1 text-xs text-muted">
            <span className="w-16"><NumInput ariaLabel="Length (ft)" value={area.length} placeholder="L" disabled={ro} onCommit={(v) => api.setArea(area.id, { length: v || null })} /></span>×
            <span className="w-16"><NumInput ariaLabel="Width (ft)" value={area.width} placeholder="W" disabled={ro} onCommit={(v) => api.setArea(area.id, { width: v || null })} /></span>×
            <span className="w-16"><NumInput ariaLabel="Height (ft)" value={area.height} placeholder="H" disabled={ro} onCommit={(v) => api.setArea(area.id, { height: v || null })} /></span>
            <span>ft</span>
          </div>
        )}
        <span className="ml-auto text-sm tabular text-muted">
          {formatNum(total.hours, 1)} h · <span className="font-semibold text-text">{formatCAD(total.price)}</span>
        </span>
        {area && !ro && (
          <span className="flex">
            <button type="button" onClick={() => api.copyArea(area.id)} className="grid size-11 place-items-center rounded-md text-subtle hover:bg-surface-2 hover:text-text sm:size-9" aria-label="Duplicate area" title="Copy room">
              <Copy className="size-4" aria-hidden />
            </button>
            <button type="button" onClick={() => api.removeArea(area.id)} className="grid size-11 place-items-center rounded-md text-subtle hover:bg-danger-soft hover:text-danger sm:size-9" aria-label="Delete area" title="Delete room">
              <Trash2 className="size-4" aria-hidden />
            </button>
          </span>
        )}
        {!open && (
          <p className="w-full pl-10 text-xs text-subtle sm:pl-11">
            {lines.length ? lines.slice(0, 4).map((l) => l.description).join(", ") + (lines.length > 4 ? ` +${lines.length - 4} more` : "") : "No surfaces yet"}
          </p>
        )}
      </div>

      {open && (
        <>
          {area && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-xs text-muted">
              {sized && dims && dims.walls.gt(0) && (
                <span>
                  walls {formatNum(dims.walls, 0)} · {area.kind === "building" ? "footprint" : "ceiling"} {formatNum(dims.ceiling, 0)} sq ft · {area.kind === "building" ? "perimeter" : "baseboard"} {formatNum(dims.perimeter, 0)} lin ft
                </span>
              )}
              {lines.length > 0 && (
                <button type="button" onClick={() => setShowConditions((s) => !s)} aria-expanded={showConditions} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border px-3 hover:border-brand hover:text-brand">
                  <SlidersHorizontal className="size-3.5" aria-hidden /> Conditions: {conditions}
                </button>
              )}
            </div>
          )}
          {showConditions && area && (
            <div className="border-t border-border bg-surface-2 px-3 py-3">
              <p className="mb-2 text-xs text-muted">Sets every surface in {area.name}. Change one surface on its own in its details.</p>
              <ConditionsPicker
                lines={lines}
                factors={factors}
                disabled={ro}
                onChange={(kind, value) => api.setLines(lines.map((l) => l.id), () => ({ [FACTOR_FIELD[kind]]: value }), `Conditions changed for ${area.name}`)}
              />
            </div>
          )}
          {area && (
            <div className="border-t border-border px-3 py-1.5">
              <input
                aria-label={`Description for the customer: ${area.name}`}
                disabled={ro}
                value={area.customerDescription ?? ""}
                onChange={(e) => api.setArea(area.id, { customerDescription: e.target.value || null })}
                placeholder="Description for the customer (optional), e.g. Walls, ceiling and trim"
                className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-sm text-muted placeholder:text-subtle hover:border-border focus:border-ring focus:outline-none disabled:hover:border-transparent"
              />
            </div>
          )}
          {lines.map((l) => (
            <SurfaceRow
              key={l.id}
              line={l}
              area={area ?? undefined}
              roomLines={lines}
              result={lineResults.get(l.id)}
              rates={rates}
              factors={factors}
              colours={colours}
              materials={materials}
              showCosting={showCosting}
              ro={ro}
              expanded={expandedLine === l.id}
              onToggle={() => setExpandedLine(expandedLine === l.id ? null : l.id)}
              api={api}
            />
          ))}
          {lines.length === 0 && <p className="border-t border-border px-3 py-3 text-sm text-subtle">No surfaces yet. Add one below.</p>}
          {!ro && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
              <span className="text-xs text-muted">Add:</span>
              {quick.map((r) => (
                <button key={r.id} type="button" onClick={() => api.addLine(area?.id ?? null, r.id)} className="min-h-9 rounded-full border border-dashed border-border-strong px-3 text-sm text-muted hover:border-brand hover:text-brand">
                  + {r.snapshot.name}
                </button>
              ))}
              <select
                aria-label="Add item"
                value=""
                onChange={(e) => {
                  if (e.target.value) api.addLine(area?.id ?? null, e.target.value);
                }}
                className="h-11 max-w-56 rounded-full border border-dashed border-border-strong bg-surface px-3 text-sm text-muted focus:border-ring focus:outline-none sm:h-9"
              >
                <option value="">More…</option>
                {grouped.map(([cat, list]) => (
                  <optgroup key={cat} label={cat}>
                    {list.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.snapshot.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SurfaceRow({
  line,
  area,
  roomLines,
  result: r,
  rates,
  factors,
  colours,
  materials,
  showCosting,
  ro,
  expanded,
  onToggle,
  api,
}: {
  line: DocLine;
  area: DocArea | undefined;
  roomLines: DocLine[];
  result: LineResult | undefined;
  rates: RateOption[];
  factors: FactorOption[];
  colours: ColourChoices;
  materials: MaterialOption[];
  showCosting: boolean;
  ro: boolean;
  expanded: boolean;
  onToggle: () => void;
  api: RoomApi;
}) {
  const unit = UNIT_LABELS[line.rateSnapshot.unit];
  const qty = resolvedQuantity(line, area);
  const auto = line.quantitySource !== "manual";
  const hourly = line.rateSnapshot.unit === "hour";
  const masterRate = rates.find((x) => x.id === line.rateSnapshot.rateId);
  const outdated = masterRate && masterRate.snapshot.rateVersion !== line.rateSnapshot.rateVersion;
  // The rate's own size source, to offer "↺ room size" after typing over it.
  const sizeFrom = (masterRate?.dimensionSource && masterRate.dimensionSource !== "manual" ? masterRate.dimensionSource : null) as SizeSource | null;
  const canFollowSize = !!area && !auto && !!sizeFrom && (quantityFromDimensions(sizeFrom, area)?.gt(0) ?? false);
  const lineConditions = conditionsSummary([line], factors);
  const roomConditions = conditionsSummary(roomLines, factors);
  const differs = roomConditions === "mixed" && lineConditions !== "normal";

  return (
    <div className={cn("border-t border-border px-3 py-2", line.isOptional && "border-l-4 border-l-info bg-info-soft/30")}>
      <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button type="button" onClick={onToggle} className="flex min-h-11 min-w-0 flex-1 items-center gap-1 text-left sm:min-h-9" aria-expanded={expanded}>
            {expanded ? <ChevronDown className="size-3.5 shrink-0 text-subtle" aria-hidden /> : <ChevronRight className="size-3.5 shrink-0 text-subtle" aria-hidden />}
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{line.description}</span>
              {line.rateSnapshot.material && <span className="block truncate text-xs text-subtle">{line.rateSnapshot.material.productName}</span>}
            </span>
            {line.isOptional && <Badge tone="info" className="ml-1 shrink-0">option</Badge>}
            {differs && <Badge className="ml-1 shrink-0">{lineConditions}</Badge>}
            {outdated && <Badge tone="warning" className="ml-1 shrink-0" title="The master rate has changed since this line was added">rate changed</Badge>}
          </button>
          {/* Phone: hours and price on the name line */}
          <span className="shrink-0 text-right text-sm tabular md:hidden">
            <span className="text-xs text-muted">{r ? formatNum(r.hours, 1) : "—"} h · </span>
            <span className={cn("font-semibold", r?.priceOverridden && "text-warning", line.isOptional && !line.optionSelected && "text-muted")}>{r ? formatCAD(r.price) : "—"}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 pl-5 md:flex-nowrap md:pl-0">
          <div className="flex items-center gap-1">
            <span className="w-20">
              <NumInput
                ariaLabel="Quantity"
                sums
                value={qty}
                disabled={ro}
                title={auto ? "Worked out from the room size. Type a number to set it yourself." : "Sums work, e.g. 12*8+10*8"}
                onCommit={(v) => v !== qty && api.setLine(line.id, { quantity: v || "0", quantitySource: "manual" })}
              />
            </span>
            <span className="w-11 text-xs text-muted">
              {unit}
              {auto && <span className="block text-[10px] text-subtle">from size</span>}
            </span>
            {canFollowSize && !ro && (
              <button type="button" onClick={() => api.setLine(line.id, { quantitySource: sizeFrom! })} className="grid size-11 place-items-center rounded-md text-brand hover:bg-brand-soft sm:size-8" aria-label="Use the room size again" title="Use the room size again">
                <RotateCcw className="size-3.5" aria-hidden />
              </button>
            )}
          </div>

          {!hourly && <Stepper label="Coats" value={line.coats} disabled={ro} onChange={(n) => api.setLine(line.id, { coats: n })} />}

          {!hourly && line.rateSnapshot.material && (
            <button type="button" onClick={onToggle} className="inline-flex min-h-9 min-w-0 max-w-40 flex-1 items-center gap-1.5 rounded-full border border-border px-3 text-xs hover:border-brand md:flex-none" title="Colour and sheen">
              <span className={cn("size-2.5 shrink-0 rounded-full", line.colour ? "bg-brand" : "border border-dashed border-subtle")} aria-hidden />
              <span className="truncate">{line.colour ? `${line.colour}${line.sheen ? ` · ${line.sheen}` : ""}` : "Choose colour"}</span>
            </button>
          )}

          <span className={cn("hidden w-12 text-right text-sm tabular text-muted md:inline", r?.hoursOverridden && "text-warning")} title="Labour hours">
            {r ? formatNum(r.hours, 1) : "—"} h
          </span>
          <span className={cn("hidden w-20 text-right text-sm font-semibold tabular md:inline", r?.priceOverridden && "text-warning", line.isOptional && !line.optionSelected && "text-muted")} title={line.isOptional && !line.optionSelected ? "Option – not in the total unless the customer adds it" : undefined}>
            {r ? formatCAD(r.price) : "—"}
          </span>
          {!ro && (
            <span className="hidden md:flex">
              <button type="button" onClick={() => api.duplicateLine(line.id)} className="grid size-8 place-items-center rounded-md text-subtle hover:bg-surface-2 hover:text-text" aria-label="Duplicate line">
                <Copy className="size-3.5" aria-hidden />
              </button>
              <button type="button" onClick={() => api.removeLine(line.id)} className="grid size-8 place-items-center rounded-md text-subtle hover:bg-danger-soft hover:text-danger" aria-label="Remove line">
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </span>
          )}
        </div>
      </div>

      {expanded && <LineDetails line={line} area={area} roomLines={roomLines} result={r} masterRate={masterRate} outdated={!!outdated} factors={factors} colours={colours} materials={materials} showCosting={showCosting} ro={ro} api={api} />}
    </div>
  );
}

function LineDetails({
  line,
  area,
  roomLines,
  result: r,
  masterRate,
  outdated,
  factors,
  colours,
  materials,
  showCosting,
  ro,
  api,
}: {
  line: DocLine;
  area: DocArea | undefined;
  roomLines: DocLine[];
  result: LineResult | undefined;
  masterRate: RateOption | undefined;
  outdated: boolean;
  factors: FactorOption[];
  colours: ColourChoices;
  materials: MaterialOption[];
  showCosting: boolean;
  ro: boolean;
  api: RoomApi;
}) {
  const unit = UNIT_LABELS[line.rateSnapshot.unit];
  const group = surfaceGroup(line);
  const listId = `colours-${line.id}`;
  const painted = !!line.rateSnapshot.material && line.rateSnapshot.unit !== "hour";
  const sameInRoom = roomLines.filter((l) => surfaceGroup(l) === group && l.id !== line.id).map((l) => l.id);
  const everythingInRoom = roomLines.filter((l) => l.id !== line.id && l.rateSnapshot.material).map((l) => l.id);
  const applyColour = (ids: string[], where: string) =>
    api.setLines(ids, () => ({ colour: line.colour ?? null, sheen: line.sheen ?? null }), `${line.colour || "Colour"} applied to ${where}`);
  const productOptions = materials;
  const currentProduct = line.rateSnapshot.material?.productId ?? "";

  return (
    <div className="mt-2 space-y-4 rounded-md bg-surface-2 p-3 text-sm">
      {painted && (
        <div className="space-y-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Colour">
              <Input disabled={ro} value={line.colour ?? ""} list={listId} onChange={(e) => api.setLine(line.id, { colour: e.target.value || null })} placeholder="e.g. SW 7008 Alabaster" />
            </Field>
            <datalist id={listId}>
              {[...new Set([...colours.onEstimate.map((c) => c.colour), ...colours.favourites, ...colours.recent])].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <div>
              <p className="mb-1.5 text-sm font-medium">Sheen</p>
              <Segmented label="Sheen" disabled={ro} value={line.sheen ?? null} options={colours.sheens.map((s) => ({ value: s, label: s }))} onChange={(v) => api.setLine(line.id, { sheen: line.sheen === v ? null : v })} />
            </div>
          </div>
          {!ro && (colours.onEstimate.length > 0 || colours.favourites.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {colours.onEstimate.slice(0, 4).map((c) => (
                <button key={`e-${c.colour}`} type="button" onClick={() => api.setLine(line.id, { colour: c.colour })} className="min-h-8 rounded-full border border-border bg-surface px-2.5 text-xs hover:border-brand" title={`Used on ${c.where}`}>
                  {c.colour}
                </button>
              ))}
              {colours.favourites
                .filter((f) => !colours.onEstimate.some((c) => c.colour.toLowerCase() === f.toLowerCase()))
                .slice(0, 6)
                .map((f) => (
                  <button key={`f-${f}`} type="button" onClick={() => api.setLine(line.id, { colour: f })} className="min-h-8 rounded-full border border-border bg-surface px-2.5 text-xs text-muted hover:border-brand hover:text-text">
                    ★ {f}
                  </button>
                ))}
            </div>
          )}
          {!ro && line.colour && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted">Use this colour on:</span>
              {sameInRoom.length > 0 && (
                <button type="button" className="text-brand hover:underline" onClick={() => applyColour(sameInRoom, `all ${plural(group)} in ${area?.name ?? "this area"}`)}>
                  all {plural(group)} in this room
                </button>
              )}
              <ApplyEverywhere line={line} group={group} api={api} />
              {everythingInRoom.length > 0 && (
                <button type="button" className="text-brand hover:underline" onClick={() => applyColour(everythingInRoom, `everything in ${area?.name ?? "this area"}`)}>
                  everything in this room
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {showCosting && painted && productOptions.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Paint product">
            <Select
              disabled={ro}
              value={currentProduct}
              onChange={(e) => {
                const m = productOptions.find((x) => x.id === e.target.value);
                if (m) api.setLine(line.id, { rateSnapshot: { ...line.rateSnapshot, material: m.snapshot, materialOverridden: true } });
              }}
            >
              {!productOptions.some((m) => m.id === currentProduct) && <option value={currentProduct}>{line.rateSnapshot.material?.productName}</option>}
              {productOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} · {formatCAD(m.snapshot.pricePerGallon)}/gal
                </option>
              ))}
            </Select>
          </Field>
          {!ro && (
            <div className="flex items-end">
              <ApplyProduct line={line} group={group} api={api} />
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Item name">
          <Input disabled={ro} value={line.description} onChange={(e) => api.setLine(line.id, { description: e.target.value })} />
        </Field>
        <Field label="Customer description">
          <Input disabled={ro} value={line.customerDescription ?? ""} onChange={(e) => api.setLine(line.id, { customerDescription: e.target.value || null })} placeholder="Shown on the proposal instead of the item name" />
        </Field>
        <Field label="Details for the customer" hint="For optional upgrades: what's included. Start lines with “- ” for bullets." className="sm:col-span-2">
          <Textarea disabled={ro} rows={2} value={line.customerDetail ?? ""} onChange={(e) => api.setLine(line.id, { customerDetail: e.target.value || null })} />
        </Field>
      </div>

      {area && line.rateSnapshot.unit !== "each" && line.rateSnapshot.unit !== "hour" && (
        <div>
          <p className="mb-1.5 text-sm font-medium">Quantity from</p>
          <Segmented label="Quantity from" disabled={ro} value={line.quantitySource} options={SOURCES} onChange={(v) => api.setLine(line.id, { quantitySource: v })} />
        </div>
      )}

      <div>
        <p className="mb-1.5 text-sm font-medium">Conditions for this surface only</p>
        <ConditionsPicker lines={[line]} factors={factors} disabled={ro} onChange={(kind, value) => api.setLine(line.id, { [FACTOR_FIELD[kind]]: value })} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Override hours" hint={r ? `Calculated ${formatNum(r.calculatedHours, 2)} h` : undefined}>
          <NumInput ariaLabel="Override hours" disabled={ro} value={line.overrideHours} placeholder="—" onCommit={(v) => api.setLine(line.id, { overrideHours: v || null })} />
        </Field>
        <Field label="Override price" hint={r ? `Calculated ${formatCAD(r.calculatedPrice)}` : undefined}>
          <NumInput ariaLabel="Override price" disabled={ro} value={line.overridePrice} placeholder="—" onCommit={(v) => api.setLine(line.id, { overridePrice: v || null })} />
        </Field>
        <div className="flex flex-col justify-end gap-2">
          <label className="flex min-h-9 items-center gap-2">
            <input type="checkbox" className="size-4" disabled={ro} checked={line.isOptional} onChange={(e) => api.setLine(line.id, { isOptional: e.target.checked, optionSelected: false })} /> Optional upgrade
          </label>
          {line.isOptional && (
            <label className="flex min-h-9 items-center gap-2">
              <input type="checkbox" className="size-4" disabled={ro} checked={line.optionSelected} onChange={(e) => api.setLine(line.id, { optionSelected: e.target.checked })} /> Pre-selected (in the total)
            </label>
          )}
        </div>
      </div>

      {!ro && (
        <div className="flex gap-2 md:hidden">
          <button type="button" onClick={() => api.duplicateLine(line.id)} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 text-sm">
            <Copy className="size-4" aria-hidden /> Copy surface
          </button>
          <button type="button" onClick={() => api.removeLine(line.id)} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-danger">
            <Trash2 className="size-4" aria-hidden /> Remove
          </button>
        </div>
      )}

      {showCosting && r && (
        <p className="text-xs text-muted">
          Rate: {line.rateSnapshot.basis === "hours_per_unit" ? `${Number(line.rateSnapshot.productionRate)} h/${unit}` : `${Number(line.rateSnapshot.productionRate)} ${unit}/h`} (v{line.rateSnapshot.rateVersion ?? "–"}) · Labour {formatCAD(r.laborCost)} @ {formatCAD(r.laborRate)}/h · Paint {formatNum(r.gallons, 2)} gal {formatCAD(r.materialCost)} · Other {formatCAD(r.otherCost)} · Cost {formatCAD(r.cost)} · Margin {formatPct(r.margin)}
          {outdated && !ro && (
            <button type="button" onClick={() => api.refreshRate(line.id)} className="ml-2 text-brand hover:underline">
              Use current rate (v{masterRate?.snapshot.rateVersion})
            </button>
          )}
        </p>
      )}
    </div>
  );
}

function ApplyEverywhere({ line, group, api }: { line: DocLine; group: string; api: RoomApi }) {
  return (
    <button
      type="button"
      className="text-brand hover:underline"
      onClick={() =>
        api.setGroup(
          group,
          () => ({ colour: line.colour ?? null, sheen: line.sheen ?? null }),
          `${line.colour} applied to all ${plural(group)} on this estimate`,
        )
      }
    >
      all {plural(group)} on this estimate
    </button>
  );
}

function ApplyProduct({ line, group, api }: { line: DocLine; group: string; api: RoomApi }) {
  const material = line.rateSnapshot.material;
  if (!material) return null;
  return (
    <button
      type="button"
      className="min-h-9 text-sm text-brand hover:underline"
      onClick={() =>
        api.setGroup(
          group,
          (l) => ({ rateSnapshot: { ...l.rateSnapshot, material, materialOverridden: true } }),
          `${material.productName} used on all ${plural(group)}`,
        )
      }
    >
      Use this paint on all {plural(group)}
    </button>
  );
}
