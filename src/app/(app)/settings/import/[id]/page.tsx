import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { formatDateTime } from "@/lib/utils";
import { importResults, previewImport } from "@/server/imports";
import { SettingsTabs } from "../../tabs";
import { ImportButtons, MappingEditor } from "../client";
import { STATUS_LABEL } from "../status";

export const metadata = { title: "Import preview" };

const SHOW = ["all", "create", "merge", "skip", "warnings"] as const;
const SHOW_LABEL: Record<(typeof SHOW)[number], string> = { all: "All", create: "New", merge: "Matched", skip: "Skipped", warnings: "Warnings" };
const LIMIT = 200;

export default async function ImportPreviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ show?: string }> }) {
  const me = await requirePermission("settings.manage");
  if (!can(me.role, "customers.write")) notFound();
  const { id } = await params;
  const show = (SHOW as readonly string[]).includes((await searchParams).show ?? "") ? ((await searchParams).show as (typeof SHOW)[number]) : "all";
  const data = await previewImport(id);
  if (!data) notFound();
  const { batch, table, plan, summary } = data;
  const [label, tone] = STATUS_LABEL[batch.status];
  const imported = batch.status !== "preview";
  const stats = imported ? (batch.stats as typeof summary) : summary;
  const samples = table.headers.map((_, i) => [...new Set(table.rows.map((r) => r[i]).filter(Boolean))].slice(0, 3));

  const rows = [
    ...plan.customers.map((c) => ({ kind: c.action as "create" | "merge" | "skip", rowNumbers: c.rowNumbers, c, reason: null as string | null })),
    ...plan.skipped.map((s) => ({ kind: "skip" as const, rowNumbers: [s.rowNumber], c: null, reason: s.reason })),
  ]
    .filter((r) => show === "all" || (show === "warnings" ? !!r.c?.warnings.length : r.kind === show))
    .sort((a, b) => a.rowNumbers[0] - b.rowNumbers[0]);
  const results = imported ? await importResults(id) : [];
  const shownResults = results.filter((r) => show === "all" || (show === "warnings" ? !!r.message && r.action === "create" : r.action === show));

  return (
    <>
      <PageHeader title="Settings" description="Bring your customers over from Markate." />
      <SettingsTabs active="import" role={me.role} />
      <nav className="mb-3 text-sm text-muted"><Link href="/settings/import" className="hover:text-text">Import</Link> / {batch.filename}</nav>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm">
          <Badge tone={tone}>{label}</Badge>
          {batch.rowCount} rows · uploaded {formatDateTime(batch.createdAt)}
          {batch.importedAt && ` · imported ${formatDateTime(batch.importedAt)}`}
          {batch.rolledBackAt && ` · undone ${formatDateTime(batch.rolledBackAt)}`}
        </p>
        <ImportButtons batchId={id} status={batch.status} creates={summary.create} merges={summary.merge} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label={imported ? "Customers created" : "New customers"} value={stats.create} tone="success" />
        <Stat label="Matched existing" value={stats.merge} />
        <Stat label="Skipped rows" value={stats.skipped} tone={stats.skipped ? "danger" : undefined} />
        <Stat label="Contacts" value={stats.contacts} />
        <Stat label="Addresses" value={stats.properties} />
        <Stat label="Warnings" value={stats.warnings} />
      </div>

      {!imported && (
        <Card className="mb-4">
          <CardHeader title="Columns" description="Check what each column is imported as. Changes update the preview below." />
          <MappingEditor batchId={id} headers={table.headers} samples={samples} mapping={data.mapping} editable={!imported} />
        </Card>
      )}

      <Card>
        <CardHeader
          title={imported ? "What was imported" : "Preview"}
          description={(imported ? shownResults.length : rows.length) > LIMIT ? `Showing the first ${LIMIT} of ${imported ? shownResults.length : rows.length}.` : undefined}
        />
        <nav className="flex gap-1 overflow-x-auto border-b border-border px-3">
          {SHOW.map((s) => (
            <Link key={s} href={`/settings/import/${id}?show=${s}`} className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${show === s ? "border-brand text-brand" : "border-transparent text-muted hover:text-text"}`}>
              {SHOW_LABEL[s]}
            </Link>
          ))}
        </nav>
        <div className="overflow-x-auto">
          {imported ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-subtle">
                  <th className="px-4 py-2 font-medium">Row</th>
                  <th className="px-4 py-2 font-medium">Result</th>
                  <th className="px-4 py-2 font-medium">Customer</th>
                  <th className="px-4 py-2 font-medium">Added</th>
                  <th className="px-4 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border align-top">
                {shownResults.slice(0, LIMIT).map((r) => (
                  <tr key={r.rowNumber}>
                    <td className="px-4 py-2 tabular-nums text-muted">{r.rowNumber}</td>
                    <td className="px-4 py-2">{r.action === "create" ? <Badge tone="success">New</Badge> : r.action === "merge" ? <Badge tone="brand">Matched</Badge> : <Badge tone="danger">Skipped</Badge>}</td>
                    <td className="px-4 py-2">
                      {r.customerId && r.customerName ? <Link href={`/customers/${r.customerId}`} className="font-medium text-brand hover:underline">{r.customerName}</Link> : <span className="text-muted">{r.action === "skip" ? "—" : "Removed"}</span>}
                    </td>
                    <td className="px-4 py-2 text-muted">{r.action === "skip" ? "" : [r.customerCreated && "customer", r.contacts.length && `${r.contacts.length} contact${r.contacts.length > 1 ? "s" : ""}`, r.addresses.length && `${r.addresses.length} address${r.addresses.length > 1 ? "es" : ""}`].filter(Boolean).join(", ") || "—"}</td>
                    <td className="px-4 py-2 text-xs text-muted">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-subtle">
                  <th className="px-4 py-2 font-medium">Row</th>
                  <th className="px-4 py-2 font-medium">Result</th>
                  <th className="px-4 py-2 font-medium">Customer</th>
                  <th className="px-4 py-2 font-medium">Email / phone</th>
                  <th className="px-4 py-2 font-medium">Addresses</th>
                  <th className="px-4 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border align-top">
                {rows.slice(0, LIMIT).map((r) => {
                  const c = r.c;
                  return (
                    <tr key={r.rowNumbers.join("-")}>
                      <td className="px-4 py-2 tabular-nums text-muted">{r.rowNumbers.join(", ")}</td>
                      <td className="px-4 py-2">{r.kind === "create" ? <Badge tone="success">New</Badge> : r.kind === "merge" ? <Badge tone="brand">Matched</Badge> : <Badge tone="danger">Skipped</Badge>}</td>
                      <td className="px-4 py-2">
                        {c ? <span className="font-medium">{c.customer.displayName}</span> : <span className="text-muted">—</span>}
                        {c?.existingName && <span className="block text-xs text-muted">matches “{c.existingName}” by {c.matchedBy}</span>}
                        {c && c.contacts.length > 1 && <span className="block text-xs text-muted">+{c.contacts.length - 1} more contact{c.contacts.length > 2 ? "s" : ""}</span>}
                      </td>
                      <td className="px-4 py-2 text-muted">{c ? [c.customer.email, c.customer.phone].filter(Boolean).join(" · ") || "—" : ""}</td>
                      <td className="px-4 py-2 text-muted">{c?.properties.map((p) => [p.street, p.city].filter(Boolean).join(", ")).join(" | ") || (c ? "—" : "")}</td>
                      <td className="px-4 py-2 text-xs">
                        {r.reason && <span className="text-danger">{r.reason}</span>}
                        {c?.warnings.map((w, i) => <span key={i} className="block text-warning">{w}</span>)}
                        {c && c.action === "merge" && !c.contacts.length && !c.properties.length && !Object.keys(c.fill).length && <span className="text-muted">Already up to date</span>}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-3 text-muted">Nothing to show.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </>
  );
}
