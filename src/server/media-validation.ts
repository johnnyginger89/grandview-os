import "server-only";
import sharp from "sharp";
import { DOCUMENT_MAX_BYTES, IMAGE_MAX_BYTES, type UploadContentType } from "@/lib/media-limits";

export { DOCUMENT_MAX_BYTES, IMAGE_MAX_BYTES };

export class MediaError extends Error {
  readonly expose = true;
}

export type SniffedType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((x, i) => b[offset + i] === x);
const ascii = (b: Uint8Array, start: number, end: number) => Buffer.from(b.subarray(start, Math.min(end, b.length))).toString("latin1");

/** File type from magic bytes only. The file name and the browser's claim are never trusted. */
export function sniffType(b: Uint8Array): SniffedType | null {
  if (b.length >= 3 && startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (b.length >= 8 && startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "image/webp";
  if (b.length >= 5 && ascii(b, 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

/** A friendly reason for formats we refuse outright, or null. */
export function rejectedFormat(b: Uint8Array): string | null {
  const head = ascii(b, 0, 512).replace(/^﻿|^\xEF\xBB\xBF/, "").trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml") || /<svg[\s>]/.test(head)) return "SVG files aren't accepted. Please upload a JPG or PNG.";
  if (/<!doctype|<html|<script|<body/.test(head)) return "This file is a web page, not a picture or PDF. Please upload a JPG, PNG or PDF.";
  if (ascii(b, 0, 4) === "GIF8") return "GIF files aren't accepted. Please export it as JPG or PNG.";
  if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a])) return "TIFF files aren't accepted. Please export it as JPG or PNG.";
  if (ascii(b, 4, 8) === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1|avif)/.test(ascii(b, 8, 12))) return "HEIC photos aren't accepted. Please export it as JPG or PNG.";
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) return "Zip and Office files aren't accepted. Please upload a JPG, PNG or PDF.";
  if (ascii(b, 0, 2) === "MZ" || startsWith(b, [0x7f, 0x45, 0x4c, 0x46])) return "Program files aren't accepted.";
  if (b.length >= 5 && ascii(b, 0, 1024).includes("%PDF-")) return "This PDF looks damaged. Please save it again as a new PDF.";
  return null;
}

const TYPE_NAMES: Record<SniffedType, string> = { "image/jpeg": "a JPG image", "image/png": "a PNG image", "image/webp": "a WebP image", "application/pdf": "a PDF" };
const EXT: Record<SniffedType, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf" };

/** Declared type for a file name, per kind. Null when the extension isn't allowed for that kind. */
export function typeForFilename(name: string, kind: "image" | "document"): UploadContentType | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return kind === "image" ? "image/webp" : null;
  if (ext === "pdf") return kind === "document" ? "application/pdf" : null;
  return null;
}

const FORBIDDEN_PDF = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA)(?![A-Za-z0-9])/;

export function checkPdf(b: Uint8Array) {
  const head = ascii(b, 0, 8);
  if (!/^%PDF-[12]\./.test(head)) throw new MediaError("This file isn't a valid PDF.");
  if (!ascii(b, Math.max(0, b.length - 2048), b.length).includes("%%EOF")) throw new MediaError("This PDF looks incomplete. Please save it again as a new PDF.");
  // PDF names may hide letters as #xx escapes (/J#61vaScript).
  const text = Buffer.from(b).toString("latin1").replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  if (FORBIDDEN_PDF.test(text)) {
    throw new MediaError("This PDF contains scripts or attachments, which we can't show to customers. Please print it to a new PDF.");
  }
}

export interface ProcessedFile {
  bytes: Buffer;
  contentType: SniffedType;
  width: number | null;
  height: number | null;
}

/**
 * Re-encode an image: auto-rotate, cap the long edge, drop all metadata (EXIF, GPS,
 * XMP, ICC). Re-encoding also discards anything appended to or hidden in the file.
 */
export async function processImage(bytes: Uint8Array, type: Exclude<SniffedType, "application/pdf">, maxEdge = 2400): Promise<ProcessedFile> {
  let pipeline = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" })
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true });
  if (type === "image/jpeg") pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });
  else if (type === "image/png") pipeline = pipeline.png({ compressionLevel: 9 });
  else pipeline = pipeline.webp({ quality: 82 });
  try {
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return { bytes: data, contentType: type, width: info.width, height: info.height };
  } catch {
    throw new MediaError(`This file couldn't be read as ${TYPE_NAMES[type]}. Please export it again and retry.`);
  }
}

/** Full server-side check of an upload. Returns the bytes to store. */
export async function validateAndProcess(input: { kind: "image" | "document"; declaredType: string; bytes: Uint8Array }): Promise<ProcessedFile> {
  const { kind, bytes } = input;
  const max = kind === "image" ? IMAGE_MAX_BYTES : DOCUMENT_MAX_BYTES;
  if (!bytes.length) throw new MediaError("This file is empty.");
  if (bytes.length > max) throw new MediaError(`This file is too large. The limit is ${max / 1024 / 1024} MB.`);
  const rejected = rejectedFormat(bytes);
  const sniffed = sniffType(bytes);
  if (rejected && !sniffed) throw new MediaError(rejected);
  if (!sniffed) throw new MediaError(kind === "image" ? "Please upload a JPG, PNG or WebP picture." : "Please upload a PDF, JPG or PNG file.");
  const allowed = kind === "image" ? sniffed !== "application/pdf" : sniffed !== "image/webp";
  if (!allowed) throw new MediaError(kind === "image" ? "Please upload a JPG, PNG or WebP picture." : "Please upload a PDF, JPG or PNG file.");
  if (sniffed !== input.declaredType) {
    const declared = Object.entries(EXT).find(([t]) => t === input.declaredType)?.[1] ?? "this type";
    throw new MediaError(`This file is named ${declared} but isn't ${TYPE_NAMES[(input.declaredType as SniffedType)] ?? "that type"}. It looks like ${TYPE_NAMES[sniffed]}.`);
  }

  if (sniffed === "application/pdf") {
    checkPdf(bytes);
    return { bytes: Buffer.from(bytes), contentType: sniffed, width: null, height: null };
  }
  const out = await processImage(bytes, sniffed, kind === "image" ? 2400 : 7000);
  if (out.bytes.length > max) throw new MediaError(`This picture is still larger than ${max / 1024 / 1024} MB after compression. Please use a smaller one.`);
  return out;
}

/** ASCII-only, path-free file name that keeps its extension. */
export function sanitizeFilename(name: string, fallback = "document"): string {
  const base = (name ?? "").split(/[/\\]/).pop() ?? "";
  const normal = base.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const m = /^(.*?)(\.[A-Za-z0-9]{1,8})?$/.exec(normal) ?? [normal, normal, ""];
  const clean = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-{2,}/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  const ext = (m[2] ?? "").toLowerCase();
  const stem = clean(m[1] ?? "").slice(0, 80 - ext.length) || fallback;
  return `${stem}${ext}`;
}
