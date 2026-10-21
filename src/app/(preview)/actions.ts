"use server";
import { z } from "zod";
import { assertPermission } from "@/lib/authz/guard";
import { draftTotals, type ProposalTotals } from "@/server/proposals";
import { sampleTotals } from "@/server/proposal-sample";

const ids = (v: unknown) => z.array(z.string().max(64)).max(200).catch([]).parse(v);

export async function previewDraftTotalsAction(estimateId: string, selectedIds: string[]): Promise<ProposalTotals | null> {
  await assertPermission("estimates.read");
  return draftTotals(z.string().uuid().parse(estimateId), ids(selectedIds));
}

export async function previewSampleTotalsAction(jobType: string, selectedIds: string[]): Promise<ProposalTotals | null> {
  await assertPermission("settings.manage");
  return sampleTotals(jobType, ids(selectedIds));
}
