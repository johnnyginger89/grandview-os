"use client";
import { FileText, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { archiveDocumentAction, updateDocumentAction } from "@/app/(app)/settings/proposals/media-actions";
import { Badge, Button, Card, CardHeader, Input } from "@/components/ui";
import { DOCUMENT_ACCEPT } from "@/lib/media-limits";
import { uploadFile } from "./upload";

export interface DocumentCardData {
  purpose: "insurance_certificate" | "worksafebc_clearance";
  defaultTitle: string;
  current: { id: string; title: string; effectiveOn: string | null; expiresOn: string | null; uploaded: string; status: "valid" | "expiring" | "expired" } | null;
  previous: { id: string; title: string; uploaded: string; expiresOn: string | null; hidden: boolean }[];
}

const STATUS: Record<string, { tone: "success" | "warning" | "danger" | "neutral"; label: string }> = {
  valid: { tone: "success", label: "Valid" },
  expiring: { tone: "warning", label: "Expires soon" },
  expired: { tone: "danger", label: "Expired" },
  missing: { tone: "danger", label: "Missing" },
};

function DocumentCard({ doc }: { doc: DocumentCardData }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"idle" | "upload" | "edit">(doc.current ? "idle" : "upload");
  const [title, setTitle] = useState(doc.current?.title ?? doc.defaultTitle);
  const [effectiveOn, setEffectiveOn] = useState(doc.current?.effectiveOn ?? "");
  const [expiresOn, setExpiresOn] = useState(doc.current?.expiresOn ?? "");
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const status = STATUS[doc.current?.status ?? "missing"];

  async function upload() {
    const f = file.current?.files?.[0];
    if (!f) return setMessage({ ok: false, text: "Choose the file first." });
    setMessage(null);
    setProgress(0);
    const r = await uploadFile(f, { kind: "document", purpose: doc.purpose, title, effectiveOn: effectiveOn || null, expiresOn: expiresOn || null }, setProgress);
    setProgress(null);
    if (!r.ok) return setMessage({ ok: false, text: r.error });
    setMessage({ ok: true, text: "Uploaded. Customers now see this document on every open proposal." });
    setMode("idle");
    if (file.current) file.current.value = "";
    router.refresh();
  }

  return (
    <Card role="region" aria-label={doc.defaultTitle}>
      <CardHeader title={doc.defaultTitle} action={<Badge tone={status.tone}>{status.label}</Badge>} />
      <div className="space-y-4 p-4 text-sm">
        {doc.current ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-3">
              <FileText className="mt-0.5 size-5 shrink-0 text-brand" />
              <div>
                <p className="font-medium">{doc.current.title}</p>
                <p className="text-muted">
                  Uploaded {doc.current.uploaded}
                  {doc.current.effectiveOn ? ` · effective ${doc.current.effectiveOn}` : ""}
                  {doc.current.expiresOn ? ` · expires ${doc.current.expiresOn}` : " · no expiry date"}
                </p>
                <p className="mt-1 text-xs text-subtle">
                  {doc.current.status === "expired" ? "Customers no longer see this document because it has expired." : "Customers see a “View …” button for it in the Insurance section of every proposal."}
                </p>
              </div>
            </div>
            <a href={`/api/media/${doc.current.id}`} target="_blank" rel="noopener" className="inline-flex h-9 items-center rounded-md border border-border-strong px-3 font-medium hover:bg-surface-2">Open</a>
          </div>
        ) : (
          <p className="rounded-md bg-warning-soft px-3 py-2 text-warning">Nothing uploaded yet. Until you upload one, proposals don&apos;t show it.</p>
        )}

        {mode === "idle" && doc.current && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setMode("upload")}><Upload className="size-4" /> Upload new version</Button>
            <Button size="sm" variant="secondary" onClick={() => setMode("edit")}>Edit dates</Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                if (!window.confirm("Stop showing this document on proposals? You can upload a new one any time.")) return;
                start(async () => {
                  const r = await archiveDocumentAction(doc.current!.id);
                  setMessage(r.ok ? { ok: true, text: "Hidden from customers." } : { ok: false, text: r.error });
                  router.refresh();
                });
              }}
            >
              Stop showing to customers
            </Button>
          </div>
        )}

        {mode !== "idle" && (
          <div className="space-y-3 rounded-lg border border-border bg-surface-2/50 p-3">
            {mode === "upload" && (
              <label className="block">
                <span className="mb-1 block font-medium">File (PDF, JPG or PNG, up to 10 MB)</span>
                <input ref={file} type="file" accept={DOCUMENT_ACCEPT} className="block w-full text-sm file:mr-3 file:h-9 file:rounded-md file:border file:border-border-strong file:bg-surface file:px-3" />
              </label>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block sm:col-span-3">
                <span className="mb-1 block font-medium">Title shown to customers</span>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
              </label>
              <label className="block">
                <span className="mb-1 block font-medium">Effective date</span>
                <Input type="date" value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block font-medium">Expiry date</span>
                <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
              </label>
            </div>
            <p className="text-xs text-subtle">We&apos;ll remind you on the dashboard 30 days before the expiry date, and hide the document from customers once it expires.</p>
            <div className="flex flex-wrap items-center gap-2">
              {mode === "upload" ? (
                <Button size="sm" onClick={upload} disabled={progress !== null}>{progress !== null ? `Uploading… ${Math.round(progress * 100)}%` : "Upload"}</Button>
              ) : (
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await updateDocumentAction(doc.current!.id, { title, effectiveOn: effectiveOn || null, expiresOn: expiresOn || null });
                      setMessage(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
                      if (r.ok) {
                        setMode("idle");
                        router.refresh();
                      }
                    })
                  }
                >
                  Save dates
                </Button>
              )}
              {doc.current && <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>Cancel</Button>}
            </div>
          </div>
        )}
        {message && <p className={message.ok ? "text-success" : "text-danger"} role={message.ok ? "status" : "alert"}>{message.text}</p>}

        {doc.previous.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Previous versions ({doc.previous.length})</summary>
            <ul className="mt-2 space-y-1">
              {doc.previous.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2">
                  <a href={`/api/media/${p.id}`} target="_blank" rel="noopener" className="text-brand hover:underline">{p.title}</a>
                  <span className="text-subtle">uploaded {p.uploaded}{p.expiresOn ? ` · expired ${p.expiresOn}` : ""}{p.hidden ? " · hidden" : ""}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Card>
  );
}

export function DocumentsPanel({ docs }: { docs: DocumentCardData[] }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Upload your current certificates here. Every proposal links to the newest one automatically, including proposals you&apos;ve already sent, so you never have to resend anything when your insurance renews.
      </p>
      {docs.map((d) => <DocumentCard key={d.purpose} doc={d} />)}
    </div>
  );
}
