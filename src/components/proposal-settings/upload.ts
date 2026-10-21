"use client";
import { completeUploadAction, startUploadAction, uploadChunkAction } from "@/app/(app)/settings/proposals/media-actions";
import { DOCUMENT_MAX_BYTES, IMAGE_MAX_BYTES, type UploadContentType } from "@/lib/media-limits";

const BY_EXTENSION: Record<string, UploadContentType> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };

export interface UploadMeta {
  kind: "image" | "document";
  purpose: "proposal_image" | "insurance_certificate" | "worksafebc_clearance";
  title?: string;
  alt?: string;
  effectiveOn?: string | null;
  expiresOn?: string | null;
}

export type UploadOutcome = { ok: true; id: string; src: string; url: string } | { ok: false; error: string };

/**
 * Send a file in chunks (Vercel limits one request to 4.5 MB). The server checks the
 * real file type and size again and re-encodes pictures; this only gives quick feedback.
 */
export async function uploadFile(file: File, meta: UploadMeta, onProgress?: (fraction: number) => void): Promise<UploadOutcome> {
  if (/\.svg$/i.test(file.name)) return { ok: false, error: "SVG files aren't accepted. Please upload a JPG or PNG." };
  const max = meta.kind === "image" ? IMAGE_MAX_BYTES : DOCUMENT_MAX_BYTES;
  if (file.size > max) return { ok: false, error: `This file is too large. The limit is ${max / 1024 / 1024} MB.` };
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const contentType = BY_EXTENSION[ext];
  if (!contentType) return { ok: false, error: meta.kind === "image" ? "Please upload a JPG, PNG or WebP picture." : "Please upload a PDF, JPG or PNG file." };

  const start = await startUploadAction({ ...meta, filename: file.name, contentType, size: file.size });
  if (!start.ok) return start;
  const parts = Math.max(1, Math.ceil(file.size / start.chunkSize));
  for (let i = 0; i < parts; i++) {
    const form = new FormData();
    form.append("chunk", file.slice(i * start.chunkSize, (i + 1) * start.chunkSize));
    const r = await uploadChunkAction(start.uploadId, i, form);
    if (!r.ok) return r;
    onProgress?.((i + 1) / parts);
  }
  const done = await completeUploadAction(start.uploadId);
  if (!done.ok) return done;
  return { ok: true, id: done.id, src: done.src, url: done.url };
}
