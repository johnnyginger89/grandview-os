"use client";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, Card, CardHeader, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import type { EstimatingPresets, RoomPreset } from "@/lib/estimating/presets";
import { cn } from "@/lib/utils";
import { savePresetsAction } from "./actions";

type RateRef = { code: string; name: string; category: string; unit: string };

const GROUPS: { value: RoomPreset["group"]; label: string; hint: string }[] = [
  { value: "inside", label: "Inside rooms", hint: "Interior, commercial, strata and repairs jobs" },
  { value: "outside", label: "Outside areas", hint: "Exterior and staining jobs" },
  { value: "cabinets", label: "Cabinets", hint: "Cabinet jobs" },
];

/**
 * Settings → Rates → Room presets: the room names offered by "Add room", the height
 * filled in, and which surfaces come ticked (with counts for doors and windows).
 */
export function PresetsEditor({ initial, rates, canEdit }: { initial: EstimatingPresets; rates: RateRef[]; canEdit: boolean }) {
  const [presets, setPresets] = useState(initial);
  const [group, setGroup] = useState<RoomPreset["group"]>("inside");
  const [openRoom, setOpenRoom] = useState<number | null>(null);
  const [colours, setColours] = useState(initial.favouriteColours.join("\n"));
  const [state, setState] = useState<{ ok: boolean; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const byCode = new Map(rates.map((r) => [r.code, r]));

  const rooms = presets.rooms.map((r, i) => ({ r, i })).filter((x) => x.r.group === group);
  const setRoom = (i: number, patch: Partial<RoomPreset>) => {
    setState(null);
    setPresets((p) => ({ ...p, rooms: p.rooms.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  };
  const move = (i: number, dir: -1 | 1) => {
    const same = rooms.map((x) => x.i);
    const k = same.indexOf(i);
    const other = same[k + dir];
    if (other === undefined) return;
    setPresets((p) => {
      const next = [...p.rooms];
      [next[i], next[other]] = [next[other], next[i]];
      return { ...p, rooms: next };
    });
  };

  const save = () =>
    start(async () => {
      const r = await savePresetsAction({ ...presets, favouriteColours: colours.split("\n").map((c) => c.trim()).filter(Boolean) });
      setState(r);
    });

  return (
    <div className="space-y-4">
      <Card role="region" aria-label="Room presets">
        <CardHeader title="Room presets" description="What “Add room” offers on an estimate. Tap a room to choose which surfaces come ticked. Existing estimates don't change." />
        <div className="flex flex-wrap gap-2 border-b border-border px-4 pb-3" role="radiogroup" aria-label="Which rooms">
          {GROUPS.map((g) => (
            <button key={g.value} type="button" role="radio" aria-checked={group === g.value} title={g.hint} onClick={() => { setGroup(g.value); setOpenRoom(null); }} className={cn("min-h-9 rounded-full border px-3 text-sm", group === g.value ? "border-brand bg-brand-soft text-brand" : "border-border text-muted hover:border-brand")}>
              {g.label}
            </button>
          ))}
        </div>
        <ul className="divide-y divide-border">
          {rooms.map(({ r, i }) => (
            <li key={i} className="px-4 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setOpenRoom(openRoom === i ? null : i)} aria-expanded={openRoom === i} className="min-h-11 min-w-0 flex-1 text-left">
                  <span className="font-medium">{r.name || "(no name)"}</span>
                  <span className="block truncate text-xs text-muted">
                    {r.surfaces.map((s) => `${byCode.get(s.rateCode)?.name ?? `${s.rateCode} (missing rate)`}${s.quantity ? ` ×${s.quantity}` : ""}`).join(", ") || "No surfaces ticked"}
                  </span>
                </button>
                {canEdit && (
                  <span className="flex">
                    <button type="button" aria-label={`Move ${r.name} up`} onClick={() => move(i, -1)} className="grid size-11 place-items-center rounded-md text-subtle hover:bg-surface-2 sm:size-9"><ArrowUp className="size-4" aria-hidden /></button>
                    <button type="button" aria-label={`Move ${r.name} down`} onClick={() => move(i, 1)} className="grid size-11 place-items-center rounded-md text-subtle hover:bg-surface-2 sm:size-9"><ArrowDown className="size-4" aria-hidden /></button>
                    <button type="button" aria-label={`Remove ${r.name}`} onClick={() => setPresets((p) => ({ ...p, rooms: p.rooms.filter((_, j) => j !== i) }))} className="grid size-11 place-items-center rounded-md text-subtle hover:bg-danger-soft hover:text-danger sm:size-9"><Trash2 className="size-4" aria-hidden /></button>
                  </span>
                )}
              </div>
              {openRoom === i && (
                <div className="mt-2 space-y-3 rounded-md bg-surface-2 p-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Room name"><Input disabled={!canEdit} value={r.name} maxLength={60} onChange={(e) => setRoom(i, { name: e.target.value })} /></Field>
                    <Field label="Height (ft)" hint={r.kind === "building" ? "Wall height of the house" : undefined}>
                      <Input disabled={!canEdit} inputMode="decimal" value={r.height ?? ""} onChange={(e) => setRoom(i, { height: e.target.value.replace(/[^0-9.]/g, "") || null })} />
                    </Field>
                    <Field label="Sized by">
                      <Select disabled={!canEdit} value={r.kind} onChange={(e) => setRoom(i, { kind: e.target.value as RoomPreset["kind"] })}>
                        <option value="room">Length × width × height (a room)</option>
                        <option value="building">Footprint × wall height (a house)</option>
                        <option value="elevation">Square feet typed on each surface (one side)</option>
                        <option value="area">Square feet typed on each surface (other)</option>
                      </Select>
                    </Field>
                  </div>
                  <fieldset>
                    <legend className="mb-1.5 text-sm font-medium">Ticked when this room is added</legend>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {rates.map((rate) => {
                        const s = r.surfaces.find((x) => x.rateCode === rate.code);
                        const toggle = (on: boolean) =>
                          setRoom(i, { surfaces: on ? [...r.surfaces, { rateCode: rate.code, ...(rate.unit === "each" ? { quantity: "1" } : {}) }] : r.surfaces.filter((x) => x.rateCode !== rate.code) });
                        return (
                          <label key={rate.code} className="flex min-h-9 items-center gap-2 text-sm">
                            <input type="checkbox" className="size-4" disabled={!canEdit} checked={!!s} onChange={(e) => toggle(e.target.checked)} />
                            <span className="min-w-0 flex-1 truncate">{rate.name} <span className="text-xs text-subtle">{rate.category}</span></span>
                            {s && rate.unit === "each" && (
                              <input
                                aria-label={`${rate.name} count`}
                                inputMode="numeric"
                                disabled={!canEdit}
                                value={s.quantity ?? "1"}
                                onChange={(e) => setRoom(i, { surfaces: r.surfaces.map((x) => (x.rateCode === rate.code ? { ...x, quantity: e.target.value.replace(/\D/g, "").slice(0, 3) || "1" } : x)) })}
                                className="h-9 w-14 rounded-md border border-border-strong bg-surface px-2 text-right text-sm"
                              />
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                </div>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="border-t border-border px-4 py-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setPresets((p) => ({ ...p, rooms: [...p.rooms, { name: "New room", group, kind: group === "inside" ? "room" : "area", height: group === "inside" ? "8" : null, surfaces: [] }] }));
                setOpenRoom(presets.rooms.length);
              }}
            >
              <Plus className="size-4" aria-hidden /> Add a room name
            </Button>
          </div>
        )}
      </Card>

      <Card role="region" aria-label="Favourite colours">
        <CardHeader title="Favourite colours" description="Offered first when picking a colour on an estimate. One per line, e.g. SW 7008 Alabaster." />
        <div className="p-4">
          <Textarea aria-label="Favourite colours, one per line" disabled={!canEdit} rows={8} value={colours} onChange={(e) => { setColours(e.target.value); setState(null); }} />
        </div>
      </Card>

      {canEdit && (
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save room presets"}</Button>
          {state?.ok && <span role="status" className="text-sm text-success">Saved. New rooms on estimates use these now.</span>}
          {state && !state.ok && <FormError message={state.error ?? null} />}
        </div>
      )}
    </div>
  );
}
