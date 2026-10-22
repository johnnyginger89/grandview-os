"use client";
import { useId, useState, useTransition } from "react";
import { Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import { setProjectManagerAction } from "./project-manager-actions";

/** The job page header's "Project manager" choice; saves as soon as it changes. */
export function ProjectManagerPicker({ projectId, current, options }: { projectId: string; current: string | null; options: { id: string; name: string }[] }) {
  const id = useId();
  const [value, setValue] = useState(current ?? "");
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function change(next: string) {
    const before = value;
    setValue(next);
    setFlash(null);
    start(async () => {
      try {
        const r = await setProjectManagerAction({ projectId, userId: next || null });
        if (!r.ok) setValue(before);
        setFlash(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      } catch {
        setValue(before);
        setFlash({ ok: false, text: "Couldn't reach the server. Check your connection and try again." });
      }
    });
  }

  return (
    <div className="flex flex-col gap-1 sm:items-end">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        Project manager
      </label>
      <Select id={id} value={value} disabled={pending} onChange={(e) => change(e.target.value)} className="h-9 w-auto min-w-48">
        <option value="">No project manager</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
      {flash && (
        <p role={flash.ok ? "status" : "alert"} className={cn("text-xs", flash.ok ? "text-success" : "text-danger")}>
          {flash.text}
        </p>
      )}
    </div>
  );
}
