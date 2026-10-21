import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui";
import { AutoPrint } from "@/components/work-order/print-button";
import { WorkOrderDocument, type WorkOrderNotice } from "@/components/work-order/work-order-document";
import { requirePermission } from "@/lib/authz/guard";
import { safeErrorMessage } from "@/lib/action-error";
import { cn, formatDate } from "@/lib/utils";
import { getWorkOrderForStaff, officeContact, type StaffWorkOrderView } from "@/server/work-orders";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Work order preview" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function noticeFor(d: StaffWorkOrderView): WorkOrderNotice | null {
  if (d.shown.kind === "draft")
    return {
      tone: "warning",
      title: "Draft – not issued",
      body: d.comparedWith
        ? `This is what version ${d.shown.version} would look like. Highlighted sections differ from version ${d.comparedWith}, the one crews see now.`
        : "Crews can't see this work order until you issue it.",
    };
  if (d.status === "cancelled") return { tone: "warning", title: "Cancelled", body: "Crews can no longer open this work order, and its share links don't work." };
  if (d.shown.version !== d.currentVersion) return { tone: "info", title: `Version ${d.shown.version} – replaced by version ${d.currentVersion}`, body: d.comparedWith ? `Highlighted sections changed from version ${d.comparedWith}.` : undefined };
  if (d.comparedWith) return { tone: "info", title: `Version ${d.shown.version} – what crews see now`, body: `Highlighted sections changed from version ${d.comparedWith}.` };
  return null;
}

export default async function StaffWorkOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; woId: string }>;
  searchParams: Promise<{ v?: string; draft?: string; print?: string }>;
}) {
  await requirePermission("projects.read_all");
  const { id, woId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(woId)) notFound();
  const sp = await searchParams;
  const version = sp.v && /^\d{1,4}$/.test(sp.v) ? Number(sp.v) : null;

  let data: StaffWorkOrderView | null;
  try {
    data = await getWorkOrderForStaff(woId, { version, draft: sp.draft === "1" });
  } catch (e) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <EmptyState title="This work order can't be shown" description={safeErrorMessage(e)} />
      </div>
    );
  }
  if (!data || data.projectId !== id) notFound();
  const office = await officeContact();
  const base = `/projects/${id}/work-orders/${woId}`;
  const tab = (active: boolean) => cn("inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium", active ? "bg-brand text-brand-contrast" : "text-muted hover:bg-surface-2 hover:text-text");

  return (
    <div className="min-h-screen bg-bg pb-10 sm:pt-6 print:bg-white print:p-0">
      <nav aria-label="Work order versions" className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-0 sm:pt-0 print:hidden">
        <Link href={`/projects/${id}`} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand hover:underline">
          <ChevronLeft className="size-4" aria-hidden /> Back to job #{data.projectNumber}
        </Link>
        <div className="flex flex-wrap gap-1">
          {data.status !== "cancelled" && (
            <Link href={`${base}?draft=1`} className={tab(data.shown.kind === "draft")}>
              {data.currentVersion ? "Next version (draft)" : "Draft"}
            </Link>
          )}
          {data.versions.map((v) => (
            <Link key={v.version} href={`${base}?v=${v.version}`} className={tab(data.shown.kind === "version" && data.shown.version === v.version)} title={`Issued ${formatDate(v.issuedAt)}`}>
              Version {v.version}
              {v.version === data.currentVersion ? " (current)" : ""}
            </Link>
          ))}
        </div>
      </nav>
      <WorkOrderDocument view={data.view} office={office} changed={data.changed} notice={noticeFor(data)} />
      {sp.print === "1" && <AutoPrint />}
    </div>
  );
}
