"use client";
import type { ProposalProps } from "./proposal-types";

/** Nothing goes out without a job address, and surfaces priced at $0 go out only when that's meant. */
export function readyToSend(p: Pick<ProposalProps, "addressMissing" | "unpriced">, confirmed: boolean): boolean {
  return !p.addressMissing && (p.unpriced.length === 0 || confirmed);
}

/** What has to be sorted before a proposal is sent or accepted, shown at the top of the dialog. */
export function BeforeSend({ proposals, confirmed, onConfirm, verb }: { proposals: Pick<ProposalProps, "addressMissing" | "unpriced">; confirmed: boolean; onConfirm: (yes: boolean) => void; verb: "send" | "accept" }) {
  const n = proposals.unpriced.length;
  return (
    <>
      {proposals.addressMissing && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          Pick the job address at the top of the estimate first. It goes on the proposal, the contract and the crew&apos;s work order.
        </p>
      )}
      {n > 0 && (
        <div role="group" aria-label="Surfaces with no price" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          <p>{n === 1 ? "This surface has" : `These ${n} surfaces have`} no price yet, so the customer would see the work promised for $0:</p>
          <ul className="my-1 list-disc pl-5">
            {proposals.unpriced.slice(0, 6).map((s) => <li key={s.id}>{s.label}</li>)}
            {n > 6 && <li>and {n - 6} more</li>}
          </ul>
          <label className="flex min-h-9 items-center gap-2 font-medium">
            <input type="checkbox" className="size-4" checked={confirmed} onChange={(e) => onConfirm(e.target.checked)} /> It&apos;s meant: {verb} anyway
          </label>
        </div>
      )}
    </>
  );
}
