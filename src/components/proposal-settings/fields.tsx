"use client";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { allowedTokens, type ImageRef } from "@/lib/proposal-template/schema";
import { ImageListField, ImagePicker } from "./image-picker";

/** Declarative description of one editable field; paths are relative to the section value. */
export type FieldSpec =
  | { kind: "heading"; label: string; hint?: string }
  | { kind: "text"; path: string; label: string; hint?: string }
  | { kind: "prose"; path: string; label: string; hint?: string; rows?: number }
  | { kind: "strings"; path: string; label: string; hint?: string }
  | { kind: "bool"; path: string; label: string; hint?: string }
  | { kind: "number"; path: string; label: string; hint?: string }
  | { kind: "select"; path: string; label: string; options: { value: string; label: string }[]; numeric?: boolean }
  | { kind: "block"; path: string; label: string }
  | { kind: "banner"; path: string; label: string }
  | { kind: "link"; path: string; label: string }
  | { kind: "href"; path: string; label: string; hint?: string }
  | { kind: "image"; path: string; label: string; aspect?: string; decorative?: boolean; nullable?: boolean; hint?: string }
  | { kind: "images"; path: string; label: string; max?: number }
  | { kind: "list"; path: string; label: string; itemLabel: string; titlePath?: string; fields: FieldSpec[]; newItem: Record<string, unknown>; min?: number; max?: number; hint?: string };

type Obj = Record<string, unknown>;

export function getAt(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Obj)[k]), obj);
}

export function setAt<T>(obj: T, path: string, value: unknown): T {
  const [k, ...rest] = path.split(".");
  const base: Obj | unknown[] = Array.isArray(obj) ? [...obj] : { ...((obj as Obj) ?? {}) };
  (base as Obj)[k] = rest.length ? setAt((obj as Obj | undefined)?.[k], rest.join("."), value) : value;
  return base as T;
}

export function unsetAt<T>(obj: T, path: string): T {
  const [k, ...rest] = path.split(".");
  if (obj == null) return obj;
  const base = { ...(obj as Obj) };
  if (rest.length) base[k] = unsetAt(base[k], rest.join("."));
  else delete base[k];
  return base as T;
}

const join = (base: string, path: string) => (base ? `${base}.${path}` : path);

export interface FieldCtx {
  value: unknown;
  set: (path: string, v: unknown) => void;
  defaults?: unknown;
  /** Section key plus any prefix, for working out which {placeholders} a field accepts. */
  tokenBase: string;
}

function Labelled({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </div>
  );
}

function ProseField({ id, label, hint, rows = 4, value, onChange, tokens }: { id: string; label: string; hint?: string; rows?: number; value: string; onChange: (v: string) => void; tokens: string[] }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (t: string) => {
    const el = ref.current;
    const at = el?.selectionStart ?? value.length;
    onChange(`${value.slice(0, at)}{${t}}${value.slice(el?.selectionEnd ?? at)}`);
    requestAnimationFrame(() => el?.focus());
  };
  return (
    <Labelled label={label} htmlFor={id} hint={hint ?? "Blank line = new paragraph · start a line with “- ” for a bullet point"}>
      <Textarea id={id} ref={ref} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
      {tokens.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          Insert:
          {tokens.map((t) => (
            <button key={t} type="button" onClick={() => insert(t)} className="rounded-full border border-border-strong px-2 py-0.5 font-mono hover:bg-surface-2">{`{${t}}`}</button>
          ))}
        </p>
      )}
    </Labelled>
  );
}

let itemSeq = 0;
/** Stable ids for list items the owner adds (lowercase, matches the template schema). */
const newItemId = () => `item-${Date.now().toString(36)}${(++itemSeq).toString(36)}`;

export function Field({ spec, base, ctx }: { spec: FieldSpec; base: string; ctx: FieldCtx }) {
  const id = useId();
  if (spec.kind === "heading")
    return (
      <div className="border-t border-border pt-4 first:border-0 first:pt-0">
        <h3 className="font-semibold">{spec.label}</h3>
        {spec.hint && <p className="text-sm text-muted">{spec.hint}</p>}
      </div>
    );
  const path = join(base, spec.path);
  const v = getAt(ctx.value, path);
  const set = (x: unknown) => ctx.set(path, x);
  const tokens = allowedTokens(join(ctx.tokenBase, path)).filter((t) => t !== "companyPhone");

  switch (spec.kind) {
    case "text":
      return (
        <Labelled label={spec.label} hint={spec.hint} htmlFor={id}>
          <Input id={id} value={String(v ?? "")} onChange={(e) => set(e.target.value)} />
        </Labelled>
      );
    case "prose":
      return <ProseField id={id} label={spec.label} hint={spec.hint} rows={spec.rows} value={String(v ?? "")} onChange={set} tokens={tokens} />;
    case "strings":
      return (
        <Labelled label={spec.label} hint={spec.hint ?? "One per line"} htmlFor={id}>
          <Textarea
            id={id}
            rows={Math.min(12, Math.max(3, ((v as string[]) ?? []).length + 1))}
            value={((v as string[]) ?? []).join("\n")}
            onChange={(e) => set(e.target.value.split("\n"))}
            onBlur={(e) => set(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
          />
        </Labelled>
      );
    case "bool":
      return (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4" checked={!!v} onChange={(e) => set(e.target.checked)} />
          <span><span className="font-medium">{spec.label}</span>{spec.hint && <span className="block text-xs text-subtle">{spec.hint}</span>}</span>
        </label>
      );
    case "number":
      return (
        <Labelled label={spec.label} hint={spec.hint} htmlFor={id}>
          <Input id={id} inputMode="numeric" className="w-32" value={v === undefined || v === null ? "" : String(v)} onChange={(e) => set(e.target.value === "" ? undefined : Number(e.target.value.replace(/[^0-9]/g, "")))} />
        </Labelled>
      );
    case "select":
      return (
        <Labelled label={spec.label} htmlFor={id}>
          <Select id={id} value={String(v ?? "")} onChange={(e) => set(spec.numeric ? Number(e.target.value) : e.target.value)}>
            {spec.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Labelled>
      );
    case "banner": {
      const b = (v as { title: string; subtitle: string }) ?? { title: "", subtitle: "" };
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Labelled label={`${spec.label}: title`} htmlFor={`${id}-t`}><Input id={`${id}-t`} value={b.title} onChange={(e) => set({ ...b, title: e.target.value })} /></Labelled>
          <Labelled label="Subtitle" htmlFor={`${id}-s`}><Input id={`${id}-s`} value={b.subtitle} onChange={(e) => set({ ...b, subtitle: e.target.value })} /></Labelled>
        </div>
      );
    }
    case "block": {
      const b = (v as { title: string; body: string }) ?? { title: "", body: "" };
      return (
        <div className="space-y-3">
          <Labelled label={`${spec.label}: heading`} htmlFor={`${id}-t`}><Input id={`${id}-t`} value={b.title} onChange={(e) => set({ ...b, title: e.target.value })} /></Labelled>
          <ProseField id={`${id}-b`} label="Text" value={b.body} onChange={(body) => set({ ...b, body })} tokens={allowedTokens(join(ctx.tokenBase, `${path}.body`)).filter((t) => t !== "companyPhone")} />
        </div>
      );
    }
    case "link": {
      const l = (v as { label: string; href: string }) ?? { label: "", href: "" };
      return (
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <Labelled label={`${spec.label}: button text`} htmlFor={`${id}-l`}><Input id={`${id}-l`} value={l.label} onChange={(e) => set({ ...l, label: e.target.value })} /></Labelled>
          <Labelled label="Link" htmlFor={`${id}-h`}>
            <div className="flex gap-2">
              <Input id={`${id}-h`} value={l.href} onChange={(e) => set({ ...l, href: e.target.value })} placeholder="https://" />
              {/^https:\/\//.test(l.href) && <a href={l.href} target="_blank" rel="noopener" className="inline-flex h-10 items-center rounded-md border border-border-strong px-3 text-sm hover:bg-surface-2">Open</a>}
            </div>
          </Labelled>
        </div>
      );
    }
    case "href":
      return (
        <Labelled label={spec.label} hint={spec.hint} htmlFor={id}>
          <div className="flex gap-2">
            <Input id={id} value={String(v ?? "")} onChange={(e) => set(e.target.value)} placeholder="https://" />
            {/^https:\/\//.test(String(v ?? "")) && <a href={String(v)} target="_blank" rel="noopener" className="inline-flex h-10 items-center rounded-md border border-border-strong px-3 text-sm hover:bg-surface-2">Open</a>}
          </div>
        </Labelled>
      );
    case "image":
      return (
        <ImagePicker
          label={spec.label}
          value={(v as ImageRef | null) ?? null}
          onChange={set}
          defaultValue={getAt(ctx.defaults, path) as ImageRef | undefined}
          aspect={spec.aspect}
          decorative={spec.decorative}
          nullable={spec.nullable}
          hint={spec.hint}
        />
      );
    case "images":
      return <ImageListField label={spec.label} value={(v as ImageRef[]) ?? []} onChange={set} max={spec.max} />;
    case "list":
      return <ListField spec={spec} path={path} ctx={ctx} />;
  }
}

function ListField({ spec, path, ctx }: { spec: Extract<FieldSpec, { kind: "list" }>; path: string; ctx: FieldCtx }) {
  const items = (getAt(ctx.value, path) as Obj[]) ?? [];
  const max = spec.max ?? 40;
  const move = (i: number, by: number) => {
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x);
    ctx.set(path, next);
  };
  const add = () => {
    const item = { ...spec.newItem };
    if ("id" in item) item.id = newItemId();
    ctx.set(path, [...items, item]);
  };
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{spec.label}</p>
        {spec.hint && <p className="text-xs text-subtle">{spec.hint}</p>}
      </div>
      <ol className="space-y-3">
        {items.map((item, i) => (
          <li key={String(item.id ?? i)} className="rounded-lg border border-border bg-surface-2/40 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium text-muted">
                {spec.itemLabel} {i + 1}
                {spec.titlePath && getAt(item, spec.titlePath) ? `: ${String(getAt(item, spec.titlePath)).slice(0, 60)}` : ""}
              </p>
              <span className="flex shrink-0 gap-1">
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="grid size-8 place-items-center rounded hover:bg-surface-2 disabled:opacity-30" aria-label={`Move ${spec.itemLabel.toLowerCase()} ${i + 1} up`}><ArrowUp className="size-4" /></button>
                <button type="button" disabled={i === items.length - 1} onClick={() => move(i, 1)} className="grid size-8 place-items-center rounded hover:bg-surface-2 disabled:opacity-30" aria-label={`Move ${spec.itemLabel.toLowerCase()} ${i + 1} down`}><ArrowDown className="size-4" /></button>
                <button
                  type="button"
                  disabled={items.length <= (spec.min ?? 0)}
                  onClick={() => ctx.set(path, items.filter((_, j) => j !== i))}
                  className="grid size-8 place-items-center rounded text-danger hover:bg-danger-soft disabled:opacity-30"
                  aria-label={`Remove ${spec.itemLabel.toLowerCase()} ${i + 1}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </span>
            </div>
            <div className="space-y-3">
              {spec.fields.map((f, k) => <Field key={k} spec={f} base={`${path}.${i}`} ctx={ctx} />)}
            </div>
          </li>
        ))}
      </ol>
      {items.length < max && <Button size="sm" variant="secondary" onClick={add}><Plus className="size-4" /> Add {spec.itemLabel.toLowerCase()}</Button>}
    </div>
  );
}

export function Fields({ specs, base = "", ctx }: { specs: FieldSpec[]; base?: string; ctx: FieldCtx }) {
  return (
    <div className="space-y-5">
      {specs.map((s, i) => <Field key={i} spec={s} base={base} ctx={ctx} />)}
    </div>
  );
}
