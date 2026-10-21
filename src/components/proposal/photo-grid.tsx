"use client";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PresentationImage } from "@/server/proposal-presentation";

/** Portfolio grid with an accessible lightbox (native <dialog>: focus trap and Esc come built in). */
export function PhotoGrid({ photos }: { photos: PresentationImage[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (index === null && d.open) d.close();
    if (index !== null && !d.open) d.showModal();
  }, [index]);

  const step = (by: number) => setIndex((i) => (i === null ? i : (i + by + photos.length) % photos.length));
  const current = index === null ? null : photos[index];

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-5">
        {photos.map((p, i) => (
          <li key={`${p.url}-${i}`}>
            <button type="button" onClick={() => setIndex(i)} className="group relative block aspect-[3/2] w-full overflow-hidden rounded-xl bg-surface-2" aria-label={`Open photo: ${p.alt || `photo ${i + 1}`}`}>
              <Image src={p.url} alt={p.alt} fill sizes="(min-width: 1024px) 33vw, 50vw" className="object-cover transition-transform duration-300 group-hover:scale-[1.03]" style={{ objectPosition: `${p.focalX}% ${p.focalY}%` }} />
            </button>
          </li>
        ))}
      </ul>
      <dialog
        ref={dialog}
        onClose={() => setIndex(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") step(1);
          if (e.key === "ArrowLeft") step(-1);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setIndex(null);
        }}
        className="m-auto max-h-[92vh] w-[min(1100px,94vw)] overflow-visible bg-transparent p-0 backdrop:bg-black/80"
        aria-label="Photo viewer"
      >
        {current && (
          <figure className="relative">
            <div className="relative aspect-[3/2] w-full overflow-hidden rounded-xl bg-black">
              <Image src={current.url} alt={current.alt} fill sizes="94vw" className="object-contain" />
            </div>
            {current.alt && <figcaption className="mt-3 text-center text-sm text-white">{current.alt}</figcaption>}
            <button type="button" onClick={() => setIndex(null)} className="absolute -top-3 -right-3 grid size-11 place-items-center rounded-full bg-white text-text shadow" aria-label="Close">
              <X className="size-5" />
            </button>
            {photos.length > 1 && (
              <>
                <button type="button" onClick={() => step(-1)} className="absolute top-1/2 left-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-text shadow" aria-label="Previous photo">
                  <ChevronLeft className="size-5" />
                </button>
                <button type="button" onClick={() => step(1)} className="absolute top-1/2 right-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-text shadow" aria-label="Next photo">
                  <ChevronRight className="size-5" />
                </button>
              </>
            )}
          </figure>
        )}
      </dialog>
    </>
  );
}
