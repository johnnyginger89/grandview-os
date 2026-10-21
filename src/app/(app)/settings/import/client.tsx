"use client";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { submitWith } from "@/components/submit";
import { Button, FormError, Select } from "@/components/ui";
import { IMPORT_FIELDS } from "@/lib/import/customers";
import { deleteImportAction, rollbackImportAction, runImportAction, saveMappingAction, uploadImportAction } from "./actions";

export function UploadForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState(uploadImportAction, null);
  useEffect(() => {
    if (state?.ok) router.push(`/settings/import/${state.id}`);
  }, [state, router]);
  return (
    <form onSubmit={submitWith(action)} className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="mb-1 block font-medium">Markate customer export (CSV)</span>
        <input name="file" type="file" accept=".csv,text/csv" required className="block text-sm file:mr-3 file:h-10 file:rounded-md file:border file:border-border-strong file:bg-surface file:px-3" />
      </label>
      <Button type="submit" disabled={pending}>{pending ? "Reading file…" : "Upload and preview"}</Button>
      <p className="w-full text-xs text-subtle">Nothing is added to your customers until you review the preview and press Import.</p>
      {state && !state.ok && <FormError message={state.error} />}
    </form>
  );
}

export function MappingEditor({ batchId, headers, samples, mapping, editable }: { batchId: string; headers: string[]; samples: string[][]; mapping: string[]; editable: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(mapping);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const change = (i: number, field: string) => {
    const next = value.map((f, k) => (k === i ? field : f));
    setValue(next);
    start(async () => {
      const r = await saveMappingAction(batchId, next);
      if (r.ok) {
        setError(null);
        router.refresh();
      } else setError(r.error);
    });
  };
  return (
    <div>
      {error && <FormError message={error} />}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-subtle">
              <th className="px-4 py-2 font-medium">Column in your file</th>
              <th className="px-4 py-2 font-medium">Examples</th>
              <th className="px-4 py-2 font-medium">Import as {pending && <span className="normal-case text-muted">· updating…</span>}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {headers.map((h, i) => (
              <tr key={i}>
                <td className="px-4 py-2 font-medium">{h}</td>
                <td className="max-w-xs truncate px-4 py-2 text-muted" title={samples[i]?.join(" · ")}>{samples[i]?.join(" · ") || "—"}</td>
                <td className="px-4 py-2">
                  <Select aria-label={`Import "${h}" as`} value={value[i]} disabled={!editable || pending} onChange={(e) => change(i, e.target.value)} className="h-9 min-w-56">
                    {IMPORT_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ImportButtons({ batchId, status, creates, merges }: { batchId: string; status: string; creates: number; merges: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (status === "preview")
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={pending || creates + merges === 0}
          onClick={() => {
            if (!window.confirm(`Add ${creates} new customer${creates === 1 ? "" : "s"} and update ${merges} existing? You can undo this afterwards.`)) return;
            start(async () => {
              const r = await runImportAction(batchId);
              if (r.ok) router.refresh();
              else setMessage({ ok: false, text: r.error });
            });
          }}
        >
          {pending ? "Importing…" : `Import ${creates} new · update ${merges}`}
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Delete this upload? Nothing has been imported from it.")) return;
            start(async () => {
              const r = await deleteImportAction(batchId);
              if (r.ok) router.push("/settings/import");
              else setMessage({ ok: false, text: r.error });
            });
          }}
        >
          Delete this upload
        </Button>
        {message && <FormError message={message.text} />}
      </div>
    );

  if (status === "imported")
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="danger"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Undo this import? Customers it created are deleted unless they now have a lead, estimate or project, and details it added are removed.")) return;
            start(async () => {
              const r = await rollbackImportAction(batchId);
              if (r.ok) {
                setMessage({ ok: true, text: `Undone. ${r.removed} customer${r.removed === 1 ? "" : "s"} removed.${r.kept.length ? ` Kept: ${r.kept.map((k) => `${k.name} (${k.reason})`).join("; ")}.` : ""}` });
                router.refresh();
              } else setMessage({ ok: false, text: r.error });
            });
          }}
        >
          {pending ? "Undoing…" : "Undo this import"}
        </Button>
        {message && <span className={message.ok ? "text-sm text-success" : "text-sm text-danger"} role="status">{message.text}</span>}
      </div>
    );
  return message ? <p className="text-sm text-success" role="status">{message.text}</p> : null;
}
