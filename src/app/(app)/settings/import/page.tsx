import Link from "next/link";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { formatDateTime } from "@/lib/utils";
import { listImportBatches } from "@/server/imports";
import { SettingsTabs } from "../tabs";
import { UploadForm } from "./client";
import { STATUS_LABEL } from "./status";

export const metadata = { title: "Import" };

export default async function ImportPage() {
  const me = await requirePermission("settings.manage");
  const batches = can(me.role, "customers.write") ? await listImportBatches() : [];
  return (
    <>
      <PageHeader title="Settings" description="Bring your customers over from Markate. You review everything before it's added, and you can undo an import." />
      <SettingsTabs active="import" showUsers={can(me.role, "users.manage")} />
      {!can(me.role, "customers.write") ? (
        <p className="text-sm text-muted">Importing customers needs permission to edit customers.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <Card>
            <CardHeader title="Import customers from Markate" />
            <div className="space-y-4 p-4 text-sm">
              <ol className="list-decimal space-y-1 pl-5">
                <li>In Markate, open <strong>Customers</strong> and use <strong>Export</strong> to download your customer list (all customers, every column).</li>
                <li>If Markate gives you an Excel file, open it and choose <strong>File → Save As → CSV</strong>.</li>
                <li>Upload the CSV below. You&apos;ll see exactly what will be created, matched or skipped before anything is saved.</li>
              </ol>
              <UploadForm />
            </div>
          </Card>
          <Card>
            <CardHeader title="How duplicates are handled" />
            <ul className="list-disc space-y-1.5 p-4 pl-8 text-sm text-muted">
              <li>A customer whose email or phone already exists here is <strong>matched</strong>: only missing details are added, nothing is overwritten.</li>
              <li>Several rows for the same Markate customer become one customer with several addresses.</li>
              <li>Columns we don&apos;t have a place for are kept as extra details on the customer.</li>
              <li>Every imported customer is tagged <em>markate-import</em>.</li>
            </ul>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Uploads" />
            {batches.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">No uploads yet.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {batches.map((b) => {
                  const [label, tone] = STATUS_LABEL[b.status];
                  return (
                    <li key={b.id}>
                      <Link href={`/settings/import/${b.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-2">
                        <span className="font-medium">{b.filename}</span>
                        <span className="flex items-center gap-3 text-muted">
                          {b.rowCount} rows · {formatDateTime(b.createdAt)} <Badge tone={tone}>{label}</Badge>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
