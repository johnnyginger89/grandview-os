"use client";
/* eslint-disable @next/next/no-img-element -- editor thumbnails of the owner's own uploads */
import { ArrowLeft, ArrowRight, ImagePlus, Images, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { listMediaAction } from "@/app/(app)/settings/proposals/media-actions";
import { Button, Input } from "@/components/ui";
import { IMAGE_ACCEPT } from "@/lib/media-limits";
import { imageUrl } from "@/lib/proposal-template/images";
import type { ImageRef } from "@/lib/proposal-template/schema";
import { cn } from "@/lib/utils";
import { useEditor, type LibraryImage } from "./editor-context";
import { uploadFile } from "./upload";

const ASPECT: Record<string, string> = { "3/2": "aspect-[3/2]", "4/5": "aspect-[4/5]", "1/1": "aspect-square", "21/9": "aspect-[21/9]" };

function LibraryDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (img: LibraryImage) => void }) {
  const { builtIn } = useEditor();
  const dialog = useRef<HTMLDialogElement>(null);
  const [uploads, setUploads] = useState<LibraryImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (open && uploads === null) {
      listMediaAction("image").then((r) => {
        if (r.ok) setUploads(r.items.map((i) => ({ src: i.src, url: i.url, alt: i.alt ?? "" })));
        else setError(r.error);
      });
    }
  }, [open, uploads]);

  const grid = (items: LibraryImage[]) => (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {items.map((i) => (
        <li key={i.src}>
          <button type="button" onClick={() => onPick(i)} className="block aspect-[3/2] w-full overflow-hidden rounded-md border border-border hover:ring-2 hover:ring-ring" title={i.alt || i.src}>
            <img src={i.url} alt={i.alt} className="size-full object-cover" loading="lazy" />
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <dialog ref={dialog} onClose={onClose} className="m-auto max-h-[85vh] w-[min(760px,94vw)] rounded-lg border border-border bg-surface p-0 text-text backdrop:bg-black/50">
      <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface px-4 py-3">
        <h3 className="font-semibold">Choose a picture</h3>
        <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-md hover:bg-surface-2" aria-label="Close"><X className="size-4" /></button>
      </div>
      <div className="space-y-5 p-4">
        <section>
          <h4 className="mb-2 text-sm font-medium">Your uploads</h4>
          {error && <p className="text-sm text-danger">{error}</p>}
          {uploads === null ? <p className="text-sm text-muted">Loading…</p> : uploads.length ? grid(uploads) : <p className="text-sm text-muted">Nothing uploaded yet.</p>}
        </section>
        <section>
          <h4 className="mb-2 text-sm font-medium">Built-in pictures</h4>
          {grid(builtIn)}
        </section>
      </div>
    </dialog>
  );
}

/** Upload a new picture; returns the image reference or an error. */
function useImageUpload() {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function upload(file: File, alt: string): Promise<ImageRef | null> {
    setError(null);
    setProgress(0);
    const r = await uploadFile(file, { kind: "image", purpose: "proposal_image", alt }, setProgress);
    setProgress(null);
    if (!r.ok) {
      setError(r.error);
      return null;
    }
    return { src: r.src, alt, focalX: 50, focalY: 50 };
  }
  return { upload, progress, error, setError };
}

export function ImagePicker({
  label,
  value,
  onChange,
  defaultValue,
  aspect = "3/2",
  decorative,
  nullable,
  hint,
}: {
  label: string;
  value: ImageRef | null;
  onChange: (v: ImageRef | null) => void;
  defaultValue?: ImageRef | null;
  aspect?: string;
  decorative?: boolean;
  nullable?: boolean;
  hint?: string;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [library, setLibrary] = useState(false);
  const { upload, progress, error } = useImageUpload();
  const isDefault = !!defaultValue && !!value && value.src === defaultValue.src;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        {value ? (
          <button
            type="button"
            title="Click the most important part of the picture to keep it in view when cropped"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onChange({ ...value, focalX: Math.round(((e.clientX - r.left) / r.width) * 100), focalY: Math.round(((e.clientY - r.top) / r.height) * 100) });
            }}
            className={cn("relative w-full shrink-0 cursor-crosshair overflow-hidden rounded-md border border-border bg-surface-2 sm:w-56", decorative ? "aspect-square sm:w-28" : (ASPECT[aspect] ?? ASPECT["3/2"]))}
          >
            <img src={imageUrl(value)} alt="" className={cn("size-full", decorative ? "object-contain p-2" : "object-cover")} style={{ objectPosition: `${value.focalX}% ${value.focalY}%` }} />
            {!decorative && (
              <span className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand/70 shadow" style={{ left: `${value.focalX}%`, top: `${value.focalY}%` }} />
            )}
          </button>
        ) : (
          <div className="grid aspect-[3/2] w-full place-items-center rounded-md border border-dashed border-border-strong text-sm text-muted sm:w-56">No picture</div>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => file.current?.click()} disabled={progress !== null}><Upload className="size-4" /> {value ? "Replace" : "Upload"}</Button>
            <Button size="sm" variant="secondary" onClick={() => setLibrary(true)}><Images className="size-4" /> Choose from library</Button>
            {defaultValue && !isDefault && <Button size="sm" variant="ghost" onClick={() => onChange(defaultValue)}><RotateCcw className="size-4" /> Default</Button>}
            {nullable && value && <Button size="sm" variant="ghost" onClick={() => onChange(null)}><Trash2 className="size-4" /> Remove</Button>}
          </div>
          {progress !== null && <p className="text-sm text-muted">Uploading… {Math.round(progress * 100)}%</p>}
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          {value && !decorative && (
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Description for screen readers</span>
              <Input value={value.alt} maxLength={300} onChange={(e) => onChange({ ...value, alt: e.target.value })} placeholder="What the picture shows" />
            </label>
          )}
          <p className="text-xs text-subtle">{hint ?? (decorative ? "Square PNG with a transparent background, at least 256 px." : "JPG or PNG up to 3 MB, at least 1600 px wide. Click the picture to set the part that stays in view.")}</p>
        </div>
      </div>
      <input
        ref={file}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        aria-label={`Upload ${label}`}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const img = await upload(f, decorative ? "" : value?.alt ?? "");
          if (img) onChange(img);
        }}
      />
      <LibraryDialog open={library} onClose={() => setLibrary(false)} onPick={(i) => { setLibrary(false); onChange({ src: i.src, alt: decorative ? "" : i.alt || value?.alt || "", focalX: 50, focalY: 50 }); }} />
    </div>
  );
}

/** A reorderable set of photos (portfolio). */
export function ImageListField({ label, value, onChange, max = 12 }: { label: string; value: ImageRef[]; onChange: (v: ImageRef[]) => void; max?: number }) {
  const file = useRef<HTMLInputElement>(null);
  const [library, setLibrary] = useState(false);
  const { upload, progress, error, setError } = useImageUpload();
  const move = (i: number, by: number) => {
    const next = [...value];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x);
    onChange(next);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{label} <span className="font-normal text-muted">({value.length} of {max})</span></p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => file.current?.click()} disabled={value.length >= max || progress !== null}><ImagePlus className="size-4" /> Upload photos</Button>
          <Button size="sm" variant="secondary" onClick={() => setLibrary(true)} disabled={value.length >= max}><Images className="size-4" /> Library</Button>
        </div>
      </div>
      {progress !== null && <p className="text-sm text-muted">Uploading… {Math.round(progress * 100)}%</p>}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {value.map((img, i) => (
          <li key={`${img.src}-${i}`} className="overflow-hidden rounded-md border border-border bg-surface">
            <img src={imageUrl(img)} alt="" className="aspect-[3/2] w-full object-cover" style={{ objectPosition: `${img.focalX}% ${img.focalY}%` }} />
            <div className="space-y-1.5 p-2">
              <Input value={img.alt} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))} placeholder="Description" aria-label={`Description for photo ${i + 1}`} className="h-8 text-xs" />
              <div className="flex justify-between">
                <span className="flex gap-1">
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="grid size-8 place-items-center rounded hover:bg-surface-2 disabled:opacity-30" aria-label="Move earlier"><ArrowLeft className="size-4" /></button>
                  <button type="button" disabled={i === value.length - 1} onClick={() => move(i, 1)} className="grid size-8 place-items-center rounded hover:bg-surface-2 disabled:opacity-30" aria-label="Move later"><ArrowRight className="size-4" /></button>
                </span>
                <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="grid size-8 place-items-center rounded text-danger hover:bg-danger-soft" aria-label={`Remove photo ${i + 1}`}><Trash2 className="size-4" /></button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <input
        ref={file}
        type="file"
        multiple
        accept={IMAGE_ACCEPT}
        className="hidden"
        aria-label={`Upload ${label}`}
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])].slice(0, max - value.length);
          e.target.value = "";
          setError(null);
          let next = value;
          for (const f of files) {
            const img = await upload(f, "");
            if (!img) break;
            next = [...next, img];
            onChange(next);
          }
        }}
      />
      <LibraryDialog open={library} onClose={() => setLibrary(false)} onPick={(i) => { setLibrary(false); onChange([...value, { src: i.src, alt: i.alt, focalX: 50, focalY: 50 }]); }} />
    </div>
  );
}
