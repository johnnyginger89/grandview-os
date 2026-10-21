import "server-only";
import { sanitizeFilename } from "./media-validation";

const EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

/** ASCII `filename=` from the purpose, plus `filename*=` from the owner's title. */
export function downloadName(purpose: string, contentType: string, title: string | null): string {
  const ext = EXT[contentType] ?? "bin";
  const ascii = `grandview-painting-${purpose.replace(/_/g, "-")}.${ext}`;
  const fromTitle = title ? sanitizeFilename(`${title}.${ext}`, purpose) : null;
  return `inline; filename="${ascii}"${fromTitle ? `; filename*=UTF-8''${encodeURIComponent(fromTitle)}` : ""}`;
}

/**
 * Headers for an insurance document. Chromium may refuse to show its PDF viewer in a
 * sandboxed top-level document; STEP B checks by hand and, if needed, drops only the
 * `sandbox` token for application/pdf.
 */
export function documentHeaders(contentType: string, disposition: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Content-Disposition": disposition,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; object-src 'self'",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}
