"use client";
import { useState } from "react";
import { Dialog } from "@/components/dialog";
import { Button, Field, Input } from "@/components/ui";
import { addDays, dayOfWeek, formatIsoDate, isIsoDate, todayIso } from "@/lib/calendar-date";

/** Pick the next follow-up day. It's saved as 9:00 a.m. Vancouver time on that day. */
export function FollowUpDialog({
  open,
  subject,
  count,
  current,
  onSave,
  onCancel,
}: {
  open: boolean;
  subject?: string | null;
  count: number;
  /** The current follow-up as a Vancouver calendar day, if any. */
  current: string | null;
  onSave: (date: string | null) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onClose={onCancel} title={count > 1 ? `Next follow-up for ${count} leads` : "Next follow-up"} description={count > 1 ? null : subject}>
      <FollowUpForm current={current} onSave={onSave} onCancel={onCancel} />
    </Dialog>
  );
}

function FollowUpForm({ current, onSave, onCancel }: { current: string | null; onSave: (date: string | null) => void; onCancel: () => void }) {
  const [today] = useState(() => todayIso());
  const [date, setDate] = useState(current ?? addDays(today, 1));
  const valid = date === "" || (isIsoDate(date) && date >= "2000-01-01" && date <= "2100-12-31");
  // Monday after today (a week from today when today is Monday).
  const nextMonday = addDays(today, (8 - dayOfWeek(today)) % 7 || 7);
  const quick: [string, string][] = [
    ["Tomorrow", addDays(today, 1)],
    ["In 3 days", addDays(today, 3)],
    ["Next week", nextMonday],
  ];
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(date || null);
      }}
      className="space-y-4"
    >
      <Field label="Follow-up date" hint={date ? "Due at 9:00 a.m. that day." : "No follow-up. Save to remove it."}>
        <Input type="date" value={date} min="2000-01-01" max="2100-12-31" onChange={(e) => setDate(e.target.value)} data-autofocus />
      </Field>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Quick dates">
        {quick.map(([label, d]) => (
          <Button key={label} size="sm" variant={date === d ? "primary" : "secondary"} onClick={() => setDate(d)} title={formatIsoDate(d, { weekday: "short", month: "short", day: "numeric" })}>
            {label}
          </Button>
        ))}
        <Button size="sm" variant={date === "" ? "primary" : "secondary"} onClick={() => setDate("")}>Clear</Button>
      </div>
      {!valid && <p className="text-sm text-danger" role="alert">Choose a real date.</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={!valid}>Save</Button>
      </div>
    </form>
  );
}
