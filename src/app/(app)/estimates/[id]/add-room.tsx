"use client";
import { useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { parseSize } from "@/lib/estimating/dims-parse";
import type { DocArea } from "@/lib/estimating/document";
import { areaQuantities, UNIT_LABELS } from "@/lib/estimating/engine";
import type { RoomPreset } from "@/lib/estimating/presets";
import { formatNum } from "@/lib/money";
import { cn } from "@/lib/utils";
import { chip, NumInput, Stepper } from "./editor-parts";
import type { RateOption, SizeSource } from "./editor-types";

export interface NewSurface {
  rate: RateOption;
  /** Count for things priced each; "0" for measured surfaces. */
  quantity: string;
  /** Where the quantity comes from; null = typed. */
  from: SizeSource | null;
}

interface Pick {
  rate: RateOption;
  on: boolean;
  count: number;
  from: SizeSource | null;
}

const sizeSource = (r: RateOption): SizeSource | null => (r.dimensionSource === "manual" ? null : (r.dimensionSource as SizeSource));

/**
 * "New room": tap a name, type the size, untick what isn't painted, Add room. The
 * room's usual surfaces come ticked from the presets in Settings.
 */
export function AddRoom({
  presets,
  rates,
  categories,
  lastHeight,
  outside,
  onAdd,
  onClose,
}: {
  presets: RoomPreset[];
  rates: RateOption[];
  /** Rate categories for this job type, most relevant first. */
  categories: string[];
  lastHeight: string | null;
  outside: boolean;
  onAdd: (area: Omit<DocArea, "id">, surfaces: NewSurface[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [other, setOther] = useState(false);
  const [kind, setKind] = useState<DocArea["kind"]>(outside ? "area" : "room");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState(lastHeight ?? (outside ? "" : "8"));
  const [picks, setPicks] = useState<Pick[]>([]);
  const lengthRef = useRef<HTMLInputElement>(null);
  const byCode = useMemo(() => new Map(rates.map((r) => [r.code, r])), [rates]);

  /** Surfaces the job type usually paints that fill in from a room size (walls, ceilings, baseboards). */
  const fallback = useMemo(() => {
    const cat = categories[0];
    return rates.filter((r) => r.category === cat && r.dimensionSource !== "manual");
  }, [rates, categories]);

  /** Every rate offered as a chip: the preset's, then the rest of this job type's own category. */
  function picksFor(preset: RoomPreset | null): Pick[] {
    const chosen: Pick[] = preset
      ? preset.surfaces.flatMap((s) => {
          const rate = byCode.get(s.rateCode);
          return rate ? [{ rate, on: true, count: Number(s.quantity ?? (rate.snapshot.unit === "each" ? 1 : 0)), from: s.from ?? sizeSource(rate) }] : [];
        })
      : fallback.map((rate) => ({ rate, on: true, count: 0, from: sizeSource(rate) }));
    const have = new Set(chosen.map((p) => p.rate.id));
    const extra = rates
      .filter((r) => r.category === categories[0] && !have.has(r.id))
      .slice(0, 10 - Math.min(chosen.length, 9))
      .map((rate) => ({ rate, on: false, count: rate.snapshot.unit === "each" ? 1 : 0, from: sizeSource(rate) }));
    return [...chosen, ...extra];
  }

  function choose(preset: RoomPreset | null, label: string) {
    setName(label);
    setOther(!preset);
    setKind(preset?.kind ?? (outside ? "area" : "room"));
    if (preset?.height) setHeight(preset.height);
    else if (preset && !preset.height) setHeight("");
    setPicks(picksFor(preset));
    setTimeout(() => lengthRef.current?.focus(), 0);
  }

  const sized = kind === "room" || kind === "building";
  const draft: DocArea = { id: "", parentId: null, name, kind, length: length || null, width: width || null, height: height || null, notes: null };
  const dims = areaQuantities(draft);

  function submit(next: boolean) {
    if (!name.trim()) return;
    const surfaces: NewSurface[] = picks
      .filter((p) => p.on)
      .map((p) => ({ rate: p.rate, quantity: p.rate.snapshot.unit === "each" ? String(p.count) : "0", from: sized ? p.from : null }));
    onAdd({ parentId: null, name: name.trim(), kind, length: sized ? length || null : null, width: sized ? width || null : null, height: sized ? height || null : null, notes: null }, surfaces);
    if (!next) return onClose();
    setName("");
    setOther(false);
    setLength("");
    setWidth("");
    setPicks([]);
  }

  return (
    <section aria-label="New room" className="rounded-lg border-2 border-brand/40 bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">{outside ? "New area" : "New room"}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 grid size-11 place-items-center rounded-md text-muted hover:bg-surface-2">
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Room name">
        {presets.map((p) => (
          <button key={p.name} type="button" aria-pressed={name === p.name && !other} onClick={() => choose(p, p.name)} className={chip(name === p.name && !other)}>
            {p.name}
          </button>
        ))}
        <button type="button" aria-pressed={other} onClick={() => choose(null, "")} className={chip(other)}>
          Other…
        </button>
      </div>
      {other && <Input aria-label="Room name" className="mt-2 max-w-xs" value={name} placeholder={outside ? "e.g. Shed" : "e.g. Mudroom"} onChange={(e) => setName(e.target.value)} autoFocus />}

      {name && (
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
        >
          {sized && (
            <div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="w-24 text-xs text-muted">
                  Length
                  <input
                    ref={lengthRef}
                    aria-label="Length in feet"
                    inputMode="decimal"
                    enterKeyHint="next"
                    value={length}
                    onChange={(e) => {
                      // "15 12 8" or "15x12x8" in one box fills all three.
                      const all = parseSize(e.target.value);
                      if (all) {
                        setLength(all.length);
                        setWidth(all.width);
                        if (all.height) setHeight(all.height);
                      } else setLength(e.target.value.replace(/[^0-9.]/g, ""));
                    }}
                    className="mt-1 h-11 w-full rounded-md border border-border-strong bg-surface px-2 text-right text-sm tabular focus:border-ring focus:outline-none"
                  />
                </label>
                <span className="pb-3 text-muted">×</span>
                <label className="w-24 text-xs text-muted">
                  Width
                  <NumInput ariaLabel="Width in feet" value={width} onCommit={setWidth} className="mt-1" />
                </label>
                <span className="pb-3 text-muted">×</span>
                <label className="w-24 text-xs text-muted">
                  {kind === "building" ? "Wall height" : "Height"}
                  <NumInput ariaLabel="Height in feet" value={height} onCommit={setHeight} className="mt-1" />
                </label>
                <span className="pb-3 text-sm text-muted">ft</span>
              </div>
              <p className="mt-1 text-xs text-subtle">
                {dims.walls.gt(0)
                  ? `= walls ${formatNum(dims.walls, 0)} · ${kind === "building" ? "footprint" : "ceiling"} ${formatNum(dims.ceiling, 0)} sq ft · ${kind === "building" ? "perimeter" : "baseboard"} ${formatNum(dims.perimeter, 0)} lin ft`
                  : "Tip: type “15 12 8” in Length to fill all three."}
              </p>
            </div>
          )}

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Paint in this {outside ? "area" : "room"}:</legend>
            <div className="flex flex-wrap gap-2">
              {picks.map((p, i) => {
                const counted = p.rate.snapshot.unit === "each";
                const toggle = () => setPicks((all) => all.map((x, j) => (j === i ? { ...x, on: !x.on } : x)));
                return (
                  <span key={p.rate.id} className={cn(chip(p.on), "pr-1")}>
                    <button type="button" aria-pressed={p.on} onClick={toggle} className="inline-flex min-h-9 items-center gap-1">
                      {p.on && <Check className="size-3.5" aria-hidden />}
                      {p.rate.snapshot.name}
                      {!counted && sized && p.from && <span className="text-xs text-subtle">({UNIT_LABELS[p.rate.snapshot.unit]})</span>}
                    </button>
                    {counted && p.on && (
                      <Stepper label={`${p.rate.snapshot.name} count`} value={p.count} min={1} max={99} onChange={(n) => setPicks((all) => all.map((x, j) => (j === i ? { ...x, count: n } : x)))} />
                    )}
                  </span>
                );
              })}
            </div>
            {!sized && <p className="mt-2 text-xs text-subtle">Type the square or linear feet on each surface after adding. Sums work, e.g. 40x18.</p>}
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <Button type="submit">Add {outside ? "area" : "room"}</Button>
            <Button type="button" variant="secondary" onClick={() => submit(true)}>
              Add &amp; next
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
