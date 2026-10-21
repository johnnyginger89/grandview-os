import { DOCUMENT_PURPOSES, type DocumentPurpose } from "@/db/schema";
import { currentDocumentFile } from "@/server/media";
import { documentHeaders, downloadName } from "@/server/media-headers";
import { proposalAllowsDocuments } from "@/server/proposals";
import { getCompany } from "@/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const plain404 = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" } });

/**
 * The customer's link to the current insurance document. The URL never changes, so the
 * proposal button always opens the newest file. Does not count as a proposal view.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string; purpose: string }> }) {
  const { token, purpose } = await ctx.params;
  if (!(DOCUMENT_PURPOSES as readonly string[]).includes(purpose)) return plain404();
  if (!(await proposalAllowsDocuments(token))) return plain404();

  const doc = await currentDocumentFile(purpose as DocumentPurpose);
  if (!doc) {
    const company = await getCompany();
    const contact = escapeHtml(company.phone || company.email || "our office");
    const html = `<!doctype html><html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Document being updated</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#2A363E"><p>This document is being updated. Please call ${contact}.</p></body></html>`;
    return new Response(html, {
      status: 404,
      headers: { ...documentHeaders("text/html; charset=utf-8", "inline"), "Cache-Control": "no-store" },
    });
  }
  return new Response(new Uint8Array(doc.data), {
    status: 200,
    headers: {
      ...documentHeaders(doc.contentType, downloadName(purpose, doc.contentType, doc.title)),
      "Cache-Control": "private, max-age=300",
      "Content-Length": String(doc.data.length),
    },
  });
}
