"use client";
import { useState } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { Button, Card, CardHeader } from "@/components/ui";
import { FollowUpDialog } from "@/components/proposals/follow-up-dialog";
import type { FollowUpDue } from "@/server/proposals";
import { formatDate } from "@/lib/utils";

const daysAgo = (iso: string, now: number) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));

/** Home: proposals waiting on the customer that nobody has chased for a few days, each one click from a follow-up. */
export function ProposalFollowUps({ rows, now }: { rows: FollowUpDue[]; now: string }) {
  const [open, setOpen] = useState<FollowUpDue | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const t = new Date(now).getTime();
  return (
    <Card role="region" aria-label="Proposals to follow up">
      <CardHeader title="Proposals to follow up" description="Sent 3 or more days ago with no answer yet." />
      {note && <p role="status" className="border-b border-border px-4 py-2 text-sm text-success">{note}</p>}
      <ul className="divide-y divide-border text-sm">
        {rows.map((r) => (
          <li key={r.proposalId} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <Link href={`/estimates/${r.estimateId}#proposals`} className="min-w-0 hover:underline">
              <span className="font-medium">{r.customerName}</span>
              <span className="text-muted"> · {r.title}</span>
              <span className="block text-xs text-subtle">
                {r.followUps === 0 ? `Sent ${daysAgo(r.sentAt, t)} days ago` : `Followed up ${r.followUps === 1 ? "once" : `${r.followUps} times`}, last ${daysAgo(r.lastContactAt, t)} days ago`}
                {" · "}
                {r.viewCount > 0 ? `opened ${r.viewCount}×` : "not opened"}
                {r.customerEmailedAt && <span className="text-info"> · they emailed you {formatDate(r.customerEmailedAt)}</span>}
              </span>
            </Link>
            <Button size="sm" variant="secondary" className="shrink-0" onClick={() => setOpen(r)}>
              <Send className="size-3.5" aria-hidden /> Follow up
            </Button>
          </li>
        ))}
        {rows.length === 0 && <li className="px-4 py-3 text-muted">Nothing to chase. Every open proposal has been sent or followed up in the last 3 days.</li>}
      </ul>
      {open && <FollowUpDialog proposalId={open.proposalId} customerName={open.customerName} onClose={() => setOpen(null)} onSent={setNote} />}
    </Card>
  );
}
