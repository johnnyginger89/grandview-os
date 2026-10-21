import { MEDIA_REF_RE, type ImageRef } from "./schema";

/** `media:<uuid>` → `/api/media/<uuid>`; shipped `/proposal/…` and `/brand/…` paths pass through. */
export function imageUrl(ref: Pick<ImageRef, "src"> | string): string {
  const src = typeof ref === "string" ? ref : ref.src;
  const m = MEDIA_REF_RE.exec(src);
  return m ? `/api/media/${m[1]}` : src;
}

export function mediaId(src: string): string | null {
  return MEDIA_REF_RE.exec(src)?.[1] ?? null;
}
