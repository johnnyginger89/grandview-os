import "server-only";
/** The Settings → Proposals preview: the template rendered around obviously fake sample data. */
import { SAMPLE_CUSTOMER, SAMPLE_DOC } from "@/lib/proposal-template/sample";
import { JOB_TYPE_KEYS } from "@/lib/proposal-template/schema";
import { buildProposalView } from "./proposal-view";
import { optionIds, proposalTotals, type ProposalTotals } from "./proposals";
import { getCompany, getProposalTemplate } from "./settings";

const sampleDoc = (jobType: string) => ({ ...SAMPLE_DOC, jobType: (JOB_TYPE_KEYS as readonly string[]).includes(jobType) ? jobType : "interior" });

export async function sampleProposal(jobType: string) {
  const doc = sampleDoc(jobType);
  const [company, template] = await Promise.all([getCompany(), getProposalTemplate()]);
  const view = buildProposalView({
    doc,
    number: 5000,
    revision: 1,
    customer: { name: SAMPLE_CUSTOMER.name, firstName: SAMPLE_CUSTOMER.firstName, contactName: SAMPLE_CUSTOMER.contactName, phone: SAMPLE_CUSTOMER.phone },
    jobAddress: SAMPLE_CUSTOMER.jobAddress,
    validUntil: new Date(Date.now() + 30 * 86_400_000),
    company,
    template,
    message: null,
  });
  const recommended = view.options.filter((o) => o.recommended).map((o) => o.id);
  return { status: "sent", view, initialSelection: recommended, totals: proposalTotals(doc, recommended), accepted: null };
}

export function sampleTotals(jobType: string, selectedIds: string[]): ProposalTotals {
  const doc = sampleDoc(jobType);
  const allowed = new Set(optionIds(doc));
  return proposalTotals(doc, selectedIds.filter((id) => allowed.has(id)));
}
