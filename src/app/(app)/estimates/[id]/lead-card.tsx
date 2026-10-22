"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, FormError, Select } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { linkLeadAction } from "../actions";

export interface LeadView {
  id: string;
  number: number;
  stage: string;
  stageKind: string;
  title: string;
  projectTypes: string[];
  description: string | null;
  timeline: string | null;
  visitAt: string | null;
}

export interface LeadChoiceView {
  id: string;
  number: number;
  title: string;
  stage: string;
  projectTypes: string[];
}

export interface LeadProps {
  lead: LeadView | null;
  /** The customer's open leads; empty when the estimate can't be relinked. */
  choices: LeadChoiceView[];
  /** May open the lead page. */
  canOpenLead: boolean;
}

const label = (l: LeadChoiceView) => [`#${l.number}`, l.projectTypes.length ? l.projectTypes.join(", ") : l.title, l.stage].join(" · ");

/** What the customer asked for on the lead, and the link that moves the lead along with this estimate. */
export function LeadCard({ estimateId, lead, choices, canOpenLead }: { estimateId: string } & LeadProps) {
  const router = useRouter();
  const [changing, setChanging] = useState(false);
  const [choice, setChoice] = useState(choices[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (id: string | null) =>
    start(async () => {
      const r = await linkLeadAction(estimateId, id);
      if (!r.ok) return setError(r.error);
      setError(null);
      setChanging(false);
      router.refresh();
    });

  if (!lead) {
    if (!choices.length) return null;
    // What was picked earlier may not be on offer any more (unlinked just now, or the list changed).
    const value = choices.some((c) => c.id === choice) ? choice : choices[0].id;
    return (
      <section aria-label="Lead" className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1">Not linked to a lead, so the lead won&apos;t move when this is sent or sold, and it won&apos;t count in the sales figures.</span>
          <Select aria-label="Lead to link" value={value} onChange={(e) => setChoice(e.target.value)} className="h-9 w-auto max-w-full">
            {choices.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}
          </Select>
          <Button size="sm" disabled={pending} onClick={() => save(value)}>Link to lead</Button>
        </div>
        <FormError message={error} />
      </section>
    );
  }

  const others = choices.filter((c) => c.id !== lead.id);
  return (
    <section aria-label="Lead" className="mb-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {canOpenLead ? <Link href={`/leads/${lead.id}`} className="font-medium text-brand hover:underline">Lead #{lead.number}</Link> : <span className="font-medium">Lead #{lead.number}</span>}
        <Badge tone={lead.stageKind === "won" ? "success" : lead.stageKind === "lost" ? "danger" : "neutral"}>{lead.stage}</Badge>
        {lead.projectTypes.length > 0 && <span className="text-muted">{lead.projectTypes.join(", ")}</span>}
        {lead.visitAt && <span className="text-muted">· Visit {formatDateTime(lead.visitAt)}</span>}
        {lead.timeline && <span className="text-muted">· Wants it {lead.timeline}</span>}
        {choices.length > 0 && !changing && (
          <button type="button" className="ml-auto min-h-8 text-xs text-brand hover:underline" onClick={() => { setChoice(others[0]?.id ?? ""); setChanging(true); }}>
            Change lead
          </button>
        )}
      </div>
      {lead.description && <p className="mt-1 line-clamp-3 whitespace-pre-line text-muted">{lead.description}</p>}
      {changing && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select aria-label="Lead for this estimate" value={choice} onChange={(e) => setChoice(e.target.value)} className="h-9 w-auto max-w-full">
            {others.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}
            <option value="">No lead</option>
          </Select>
          <Button size="sm" disabled={pending} onClick={() => save(choice || null)}>Save</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setChanging(false)}>Cancel</Button>
        </div>
      )}
      <FormError message={error} />
    </section>
  );
}
