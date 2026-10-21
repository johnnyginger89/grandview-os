"use client";
import { Dialog } from "@/components/dialog";
import { Button } from "@/components/ui";
import { COLUMNS, visibleColumns, type ColumnKey, type GroupBy, type ListPrefs } from "@/lib/pipeline/list-view";

/** Show or hide list columns and choose grouping. Changes apply at once and are remembered on this computer. */
export function ColumnsDialog({
  open,
  onClose,
  prefs,
  includeMoney,
  group,
  onToggle,
  onGroup,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  prefs: ListPrefs;
  includeMoney: boolean;
  group: GroupBy;
  onToggle: (key: ColumnKey, visible: boolean) => void;
  onGroup: (g: GroupBy) => void;
  onReset: () => void;
}) {
  const visible = new Set(visibleColumns(prefs, { includeMoney }).map((c) => c.key));
  const offered = COLUMNS.filter((c) => !c.money || includeMoney);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Columns"
      description="Changes apply right away and are remembered on this computer."
      footer={
        <>
          <Button variant="ghost" onClick={onReset}>Reset to default</Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Show these columns</legend>
        <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {offered.map((c, i) => (
            <label key={c.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--brand)]"
                checked={visible.has(c.key)}
                disabled={!c.hideable}
                onChange={(e) => onToggle(c.key, e.target.checked)}
                data-autofocus={i === 0 ? true : undefined}
              />
              <span className={c.hideable ? undefined : "text-muted"}>{c.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-5">
        <legend className="mb-2 text-sm font-medium">Group by</legend>
        <div className="flex gap-4">
          {(["stage", "none"] as const).map((g) => (
            <label key={g} className="flex items-center gap-2 text-sm">
              <input type="radio" name="group-by" className="size-4 accent-[var(--brand)]" checked={group === g} onChange={() => onGroup(g)} />
              {g === "stage" ? "Stage" : "None"}
            </label>
          ))}
        </div>
      </fieldset>
    </Dialog>
  );
}
