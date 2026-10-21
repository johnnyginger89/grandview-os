"use client";
import { Camera, ExternalLink, Search } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { createCompanyCamAction, linkCompanyCamAction, searchCompanyCamAction, unlinkCompanyCamAction } from "@/app/(app)/companycam-actions";
import { Button, Card, CardHeader, FormError, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { CompanyCamPanel, CompanyCamProject } from "@/server/integrations/companycam";

/*
 * CompanyCam on an estimate or a job: link the CompanyCam project (found by address, or
 * created from this record), then see its latest photos here. Photos open full size
 * through our own server; "Open in CompanyCam" needs a CompanyCam login.
 */

const TZ = "America/Vancouver";
const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: TZ, month: "short", day: "numeric" }).format(new Date(iso)) : "");

export function CompanyCamCard({
  entity,
  panel,
  canEdit,
  canConnect,
  className,
}: {
  entity: { entityType: "project" | "estimate"; entityId: string };
  panel: CompanyCamPanel;
  canEdit: boolean;
  /** May open Settings → Integrations to connect CompanyCam. */
  canConnect: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState(panel.suggestedQuery);
  const [results, setResults] = useState<CompanyCamProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [pending, start] = useTransition();
  const { link } = panel;

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error);
      else {
        setResults(null);
        setChanging(false);
      }
    });

  const search = () =>
    start(async () => {
      setError(null);
      const r = await searchCompanyCamAction(entity, query);
      if (r.ok) setResults(r.projects);
      else setError(r.error);
    });

  if (!panel.status.connected) {
    if (!canConnect) return null;
    return (
      <Card className={className} role="region" aria-label="CompanyCam photos">
        <CardHeader title="Photos · CompanyCam" />
        <p className="p-4 text-sm text-muted">
          {panel.status.unreadable ? "CompanyCam needs to be connected again. " : "See the crew's CompanyCam photos here. "}
          <Link href="/settings?tab=integrations" className="font-medium text-brand hover:underline">Connect CompanyCam in Settings → Integrations</Link>
        </p>
      </Card>
    );
  }

  const picker = (
    <div className="space-y-3 p-4">
      <p className="text-sm text-muted">Find this job&apos;s CompanyCam project by address or name, or create one from this {entity.entityType === "estimate" ? "estimate" : "job"}.</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Street address or name" aria-label="Search CompanyCam" />
        <Button type="submit" variant="secondary" disabled={pending}>
          <Search className="size-4" aria-hidden /> Search
        </Button>
      </form>
      {results && (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm" aria-label="CompanyCam projects">
          {results.length === 0 && <li className="px-3 py-2.5 text-muted">No CompanyCam projects match.</li>}
          {results.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">{p.name}</span>
                {p.address && <span className="block truncate text-xs text-muted">{p.address}</span>}
              </span>
              <Button size="sm" disabled={pending} onClick={() => run(() => linkCompanyCamAction(entity, p.id))}>Link</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => createCompanyCamAction(entity))}>
          <Camera className="size-4" aria-hidden /> Create a CompanyCam project
        </Button>
        {changing && <Button size="sm" variant="ghost" onClick={() => setChanging(false)}>Cancel</Button>}
      </div>
    </div>
  );

  return (
    <Card className={cn(className)} role="region" aria-label="CompanyCam photos">
      <CardHeader
        title="Photos · CompanyCam"
        description={link ? `${link.name ?? "CompanyCam project"}${panel.inherited ? " (linked on the estimate)" : ""}` : undefined}
        action={
          link?.url ? (
            <a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
              Open in CompanyCam <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : undefined
        }
      />
      {error && <div className="px-4 pt-3"><FormError message={error} /></div>}
      {!link || changing ? (
        canEdit ? picker : <p className="p-4 text-sm text-muted">Not linked to CompanyCam yet.</p>
      ) : (
        <div className="p-4">
          {panel.error && <p className="mb-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">{panel.error}</p>}
          {panel.photos.length ? (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6" aria-label="CompanyCam photos">
              {panel.photos.map((p) => (
                <li key={p.id}>
                  <a href={p.full} target="_blank" rel="noopener" className="block aspect-square overflow-hidden rounded-lg border border-border bg-surface-2" title={[p.description, p.by, when(p.capturedAt)].filter(Boolean).join(" · ")}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- served by our own signed image route */}
                    <img src={p.thumb} alt={p.description ?? "CompanyCam photo"} loading="lazy" className="size-full object-cover" />
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            !panel.error && <p className="text-sm text-muted">No photos yet. Photos the crew takes in this CompanyCam project show up here.</p>
          )}
          {canEdit && (
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <button type="button" className="text-brand hover:underline" onClick={() => setChanging(true)}>Link a different project</button>
              {!panel.inherited && (
                <button type="button" className="text-muted hover:text-danger hover:underline" disabled={pending} onClick={() => run(() => unlinkCompanyCamAction(entity))}>
                  Unlink
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
