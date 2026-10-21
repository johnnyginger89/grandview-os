"use client";
import { useState } from "react";
import { Dialog } from "@/components/dialog";
import { Button, Field, Select } from "@/components/ui";

/** Ask why a lead (or several) was lost. Cancel leaves the stage as it was. */
export function LostReasonDialog({
  open,
  subject,
  count,
  reasons,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** The lead's name, for a single lead. */
  subject?: string | null;
  count: number;
  reasons: string[];
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={count > 1 ? `Mark ${count} leads as lost` : "Mark lead as lost"}
      description={count > 1 ? "The same reason is saved on every selected lead." : subject}
    >
      <LostReasonForm reasons={reasons.length ? reasons : ["Other"]} onConfirm={onConfirm} onCancel={onCancel} />
    </Dialog>
  );
}

function LostReasonForm({ reasons, onConfirm, onCancel }: { reasons: string[]; onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState(reasons[0]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm(reason);
      }}
      className="space-y-4"
    >
      <Field label="Why was it lost?">
        <Select value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus>
          {reasons.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Select>
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit">Mark lost</Button>
      </div>
    </form>
  );
}
