"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button, Select } from "@/components/ui";
import { markProposalNoteReviewedAction } from "./actions";

export function SectionSelect({ pages, active }: { pages: { key: string; label: string }[]; active: string }) {
  const router = useRouter();
  return (
    <Select aria-label="Proposal settings section" value={active} onChange={(e) => router.push(`/settings/proposals?section=${e.target.value}`)}>
      {pages.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
    </Select>
  );
}

export function ReviewedButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => void (await markProposalNoteReviewedAction(id)))}>
      Mark as reviewed
    </Button>
  );
}
