"use client";
/* eslint-disable @next/next/no-img-element -- editor thumbnails */
import { useState } from "react";
import { Card, CardHeader, Input } from "@/components/ui";
import { imageUrl } from "@/lib/proposal-template/images";
import { JOB_TYPE_KEYS, type ImageRef } from "@/lib/proposal-template/schema";
import { cn } from "@/lib/utils";
import { Field, getAt, setAt, unsetAt, type FieldSpec } from "./fields";
import { SaveBar, useSectionValue } from "./section-form";

export const JOB_TYPE_NAMES: Record<string, string> = {
  default: "Default",
  interior: "Interior",
  exterior: "Exterior",
  interior_exterior: "Interior & exterior",
  cabinets: "Cabinets",
  staining: "Deck / fence staining",
  commercial: "Commercial",
  strata: "Strata",
  repairs: "Repairs",
};

type JobTypes = Record<string, Record<string, unknown>>;

function inheritedFrom(value: JobTypes, key: string, path: string): { from: string; value: unknown } {
  const parent = String(value[key]?.inherits ?? "default");
  if (parent !== "default") {
    const v = getAt(value[parent], path);
    if (v !== undefined && v !== null) return { from: parent, value: v };
  }
  return { from: "default", value: getAt(value.default, path) };
}

function Preview({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    const imgs = value as ImageRef[];
    return (
      <span className="flex gap-1">
        {imgs.slice(0, 4).map((i, k) => <img key={k} src={imageUrl(i)} alt="" className="h-10 w-14 rounded object-cover" />)}
        <span className="self-center text-xs text-muted">{imgs.length} photos</span>
      </span>
    );
  }
  if (value && typeof value === "object" && "src" in (value as object)) return <img src={imageUrl(value as ImageRef)} alt="" className="h-14 w-20 rounded object-cover" />;
  if (value && typeof value === "object" && "title" in (value as object)) return <span className="line-clamp-2 text-sm text-muted">{String((value as { title: string }).title)}</span>;
  const s = String(value ?? "");
  return <span className="line-clamp-2 text-sm text-muted">{s || "(empty)"}</span>;
}

/**
 * Settings that change with the job type (cover, photos, warranty…). Each job type uses its
 * parent's value until the owner customizes it; "Use inherited" removes the override.
 */
export function JobTypesForm({ title, description, initial, defaults, specs }: { title: string; description?: string; initial: JobTypes; defaults: JobTypes; specs: FieldSpec[] }) {
  const s = useSectionValue<JobTypes>("jobTypes", initial, defaults);
  const keys = [...new Set([...JOB_TYPE_KEYS, ...Object.keys(s.value)])].filter((k) => k === "default" || s.value[k] !== null);
  const [key, setKey] = useState<string>("default");
  const entry = s.value[key] ?? {};
  const set = (path: string, v: unknown) => s.setValue((cur) => setAt(cur, path, v));

  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="px-4 pt-4">
        <div role="tablist" aria-label="Job type" className="scrollbar-none -mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-border px-4">
          {keys.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={k === key}
              onClick={() => setKey(k)}
              className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", k === key ? "border-brand text-brand" : "border-transparent text-muted hover:text-text")}
            >
              {JOB_TYPE_NAMES[k] ?? k}
            </button>
          ))}
        </div>

        {key === "default" ? (
          <div className="space-y-5">
            <p className="text-sm text-muted">Used by every job type that hasn&apos;t been customized.</p>
            {specs.map((f, i) => <Field key={i} spec={f} base="default" ctx={{ value: s.value, set, defaults, tokenBase: "jobTypes" }} />)}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-sm">
                <span className="mb-1 block font-medium">Word used in sentences</span>
                <Input className="w-56" value={String(entry.label ?? "")} onChange={(e) => set(`${key}.label`, e.target.value)} placeholder="interior" />
              </label>
              <p className="pb-2 text-sm text-muted">Falls back to: <strong>{JOB_TYPE_NAMES[String(entry.inherits ?? "default")]}</strong></p>
            </div>
            {specs.map((f, i) => {
              if (f.kind === "heading") return <Field key={i} spec={f} base="" ctx={{ value: s.value, set, tokenBase: "jobTypes" }} />;
              const own = getAt(entry, f.path);
              const inherited = inheritedFrom(s.value, key, f.path);
              if (own !== undefined && own !== null)
                return (
                  <div key={i} className="rounded-lg border border-brand/30 bg-brand-soft/30 p-3">
                    <Field spec={f} base={key} ctx={{ value: s.value, set, defaults: setAt({}, `${key}.${f.path}`, inherited.value), tokenBase: "jobTypes" }} />
                    <button type="button" onClick={() => s.setValue((cur) => unsetAt(cur, `${key}.${f.path}`))} className="mt-2 text-sm text-brand underline-offset-2 hover:underline">
                      Use {JOB_TYPE_NAMES[inherited.from]}&apos;s instead
                    </button>
                  </div>
                );
              return (
                <div key={i} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border-strong p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{f.label}</p>
                    <p className="text-xs text-subtle">Inherited from {JOB_TYPE_NAMES[inherited.from]}</p>
                    <div className="mt-1"><Preview value={inherited.value} /></div>
                  </div>
                  <button type="button" onClick={() => set(`${key}.${f.path}`, structuredClone(inherited.value))} className="h-9 rounded-md border border-border-strong px-3 text-sm font-medium hover:bg-surface-2">
                    Customize for {JOB_TYPE_NAMES[key] ?? key}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <SaveBar {...s} />
      </div>
    </Card>
  );
}
