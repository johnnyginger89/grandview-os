"use client";
import { Plus, TriangleAlert, X } from "lucide-react";
import { useActionState, useState } from "react";
import { submitWith } from "@/components/submit";
import { Badge, Button, Card, CardHeader, Field, FormError, Input, Select } from "@/components/ui";
import type { IsoDate } from "@/lib/calendar-date";
import { formatCAD } from "@/lib/money";
import { MAX_GOAL_YEARS, spreadEvenly, sumMoney } from "@/lib/reporting/goals";
import { saveGoalsAction } from "./goals-actions";
import {
  cleanAmount,
  currentFiscalYear,
  displayAmount,
  fiscalMonths,
  fiscalYearRange,
  LONG_TERM_YEARS,
  MAX_EXCLUDED_REASONS,
  yearToInput,
  type GoalsPayload,
  type GoalsYearInput,
} from "./goals-shared";

const MONTH_NAMES = fiscalMonths(2000, 1).map((m) => m.long);
const LAST_YEAR_KEY = 2099;

/** Sum of the months, or null while any month isn't a readable amount. */
function monthsTotal(values: readonly string[]): string | null {
  const clean = values.map(cleanAmount);
  return clean.every((v): v is string => v !== null) ? sumMoney(clean) : null;
}

const spread = (annual: string) => {
  const clean = cleanAmount(annual);
  return clean === null ? null : spreadEvenly(clean).map(displayAmount);
};

export function GoalsForm({ initial, lostReasons, today, starterYears }: { initial: GoalsPayload; lostReasons: string[]; today: IsoDate; starterYears: string[] }) {
  const [form, setForm] = useState<GoalsPayload>(initial);
  const [added, setAdded] = useState<string[]>([]);
  const [edited, setEdited] = useState(false);
  const [state, action, pending] = useActionState(saveGoalsAction, null);
  const submit = submitWith(action);

  const update = (fn: (f: GoalsPayload) => GoalsPayload) => {
    setForm(fn);
    setEdited(true);
  };
  const updateYear = (year: string, patch: Partial<GoalsYearInput>) =>
    update((f) => ({ ...f, years: f.years.map((y) => (y.year === year ? { ...y, ...patch } : y)) }));

  // Keep the current and next fiscal year on screen when the start month moves them.
  const setStartMonth = (month: number) => {
    const current = currentFiscalYear(today, month);
    const missing = [String(current), String(current + 1)].filter((k) => !form.years.some((y) => y.year === k));
    setAdded((a) => [...a, ...missing]);
    update((f) => ({
      ...f,
      fiscalYearStartMonth: month,
      years: [...f.years, ...missing.map((k) => yearToInput(k, undefined))].sort((a, b) => a.year.localeCompare(b.year)),
    }));
  };

  const lastYear = Math.max(...form.years.map((y) => Number(y.year)));
  const canAddYear = form.years.length < MAX_GOAL_YEARS && lastYear < LAST_YEAR_KEY;
  const addYear = () => {
    const key = String(lastYear + 1);
    setAdded((a) => [...a, key]);
    update((f) => ({ ...f, years: [...f.years, yearToInput(key, undefined)] }));
  };
  const removeYear = (key: string) => {
    setAdded((a) => a.filter((k) => k !== key));
    update((f) => ({ ...f, years: f.years.filter((y) => y.year !== key) }));
  };

  const current = String(currentFiscalYear(today, form.fiscalYearStartMonth));
  const reasons = [...new Set([...lostReasons, ...form.excludedLostReasons])];
  const toggleReason = (reason: string, on: boolean) =>
    update((f) => ({ ...f, excludedLostReasons: on ? [...f.excludedLostReasons, reason] : f.excludedLostReasons.filter((r) => r !== reason) }));

  return (
    <form
      onSubmit={(e) => {
        setEdited(false);
        submit(e);
      }}
      className="max-w-3xl space-y-4"
    >
      <input type="hidden" name="payload" value={JSON.stringify(form)} />
      <p className="text-sm text-muted">Your goals show on the Performance page and the home dashboard. All amounts are before GST.</p>

      <Card className="p-4">
        <Field label="Fiscal year starts in" hint="Changing this re-labels your monthly targets." className="max-w-xs">
          <Select value={form.fiscalYearStartMonth} onChange={(e) => setStartMonth(Number(e.target.value))}>
            {MONTH_NAMES.map((name, i) => (
              <option key={name} value={i + 1}>{name}</option>
            ))}
          </Select>
        </Field>
      </Card>

      {form.years.map((y) => {
        const initialYear = initial.years.find((iy) => iy.year === y.year);
        return (
          <YearCard
            key={y.year}
            y={y}
            startMonth={form.fiscalYearStartMonth}
            isCurrent={y.year === current}
            starter={starterYears.includes(y.year) && !!initialYear && y.sales === initialYear.sales}
            onChange={(patch) => updateYear(y.year, patch)}
            onRemove={added.includes(y.year) ? () => removeYear(y.year) : undefined}
          />
        );
      })}
      <Button variant="secondary" onClick={addYear} disabled={!canAddYear}>
        <Plus className="size-4" /> Add year
      </Button>

      <Card>
        <CardHeader title="Long-term target" description="The Performance page compares your sales over the last 12 months with this target." />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Long-term sales target ($)" hint="Leave empty if you don't want one.">
            <Input inputMode="decimal" value={form.longTermAmount} onChange={(e) => update((f) => ({ ...f, longTermAmount: e.target.value }))} placeholder="5,000,000" />
          </Field>
          <Field label="Reach it by (year)" hint={`A year from ${LONG_TERM_YEARS.min} to ${LONG_TERM_YEARS.max}.`}>
            <Input inputMode="numeric" value={form.longTermYear} onChange={(e) => update((f) => ({ ...f, longTermYear: e.target.value }))} placeholder="2030" />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Lead quality" description="Don't count leads lost for these reasons. They still appear in the lost-reasons chart." />
        <div className="p-4">
          {reasons.length === 0 ? (
            <p className="text-sm text-muted">Add lost reasons under Pick lists first.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {reasons.map((r) => {
                const checked = form.excludedLostReasons.includes(r);
                return (
                  <li key={r}>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-brand"
                        checked={checked}
                        disabled={!checked && form.excludedLostReasons.length >= MAX_EXCLUDED_REASONS}
                        onChange={(e) => toggleReason(r, e.target.checked)}
                      />
                      <span>{r}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        {state?.ok && !edited && !pending && <span role="status" className="text-sm text-success">Saved</span>}
      </div>
      {state && !state.ok && <FormError message={state.error} />}
    </form>
  );
}

function YearCard({
  y,
  startMonth,
  isCurrent,
  starter,
  onChange,
  onRemove,
}: {
  y: GoalsYearInput;
  startMonth: number;
  isCurrent: boolean;
  starter: boolean;
  onChange: (patch: Partial<GoalsYearInput>) => void;
  onRemove?: () => void;
}) {
  const months = fiscalMonths(Number(y.year), startMonth);
  const range = fiscalYearRange(Number(y.year), startMonth);
  const salesTotal = monthsTotal(y.monthlySales);
  const producedTotal = y.sameAsSales ? salesTotal : monthsTotal(y.monthlyProduced);
  const salesAnnual = cleanAmount(y.sales);
  const producedAnnual = y.sameAsSales ? salesAnnual : cleanAmount(y.produced);
  const differs = (sum: string | null, annual: string | null) => sum !== null && (annual === null || sum !== sumMoney([annual]));

  const startMonthly = () => {
    const blank = y.monthlySales.every((v) => !v.trim());
    onChange({
      monthly: true,
      ...(blank ? { monthlySales: spread(y.sales) ?? y.monthlySales, monthlyProduced: spread(y.sameAsSales ? y.sales : y.produced) ?? y.monthlyProduced } : {}),
    });
  };
  const spreadAll = () => {
    const s = spread(y.sales);
    const p = spread(y.sameAsSales ? y.sales : y.produced);
    onChange({ ...(s ? { monthlySales: s } : {}), ...(p ? { monthlyProduced: p } : {}) });
  };
  const setMonth = (series: "monthlySales" | "monthlyProduced", i: number, v: string) => onChange({ [series]: y[series].map((old, k) => (k === i ? v : old)) });

  return (
    <Card role="group" aria-label={`Goals for ${y.year}`}>
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
            {startMonth === 1 ? y.year : `Fiscal year ${y.year}`}
            {isCurrent && <Badge tone="brand">This year</Badge>}
          </h2>
          {startMonth !== 1 && <p className="mt-0.5 text-xs text-muted">{range}</p>}
        </div>
        {onRemove && (
          <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Remove ${y.year}`}>
            <X className="size-4" /> Remove
          </Button>
        )}
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label={`Sales goal for ${y.year} ($)`} hint={starter ? "Starter value. Change it to your own goal." : "Signed jobs, before GST. Leave empty for no goal."}>
          <Input inputMode="decimal" value={y.sales} onChange={(e) => onChange({ sales: e.target.value })} placeholder="1,000,000" />
        </Field>
        <div>
          <Field label={`Produced goal for ${y.year} ($)`} hint="Finished jobs, before GST.">
            <Input inputMode="decimal" value={y.sameAsSales ? y.sales : y.produced} disabled={y.sameAsSales} onChange={(e) => onChange({ produced: e.target.value })} />
          </Field>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-brand"
              checked={y.sameAsSales}
              onChange={(e) => onChange(e.target.checked ? { sameAsSales: true } : { sameAsSales: false, produced: y.sales, monthlyProduced: y.monthlySales })}
            />
            Same as sales goal
          </label>
        </div>
        <Field label={`Leads per month goal for ${y.year} (optional)`}>
          <Input inputMode="numeric" value={y.leadsPerMonth} onChange={(e) => onChange({ leadsPerMonth: e.target.value })} />
        </Field>
      </div>

      <div className="border-t border-border px-4 py-3">
        {!y.monthly ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted">Monthly targets: the year goal split evenly across the 12 months.</span>
            <Button size="sm" variant="secondary" onClick={startMonthly}>Set monthly targets</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Monthly targets</h3>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={spreadAll} disabled={salesAnnual === null || producedAnnual === null} title="Split the year goal evenly across the months">
                  Spread evenly
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onChange({ monthly: false })}>Use the year goal only</Button>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-subtle">
                  <th className="py-1 pr-2 font-medium">Month</th>
                  <th className="py-1 pr-2 font-medium">Sales ($)</th>
                  {!y.sameAsSales && <th className="py-1 font-medium">Produced ($)</th>}
                </tr>
              </thead>
              <tbody>
                {months.map((m, i) => (
                  <tr key={`${m.y}-${m.m}`}>
                    <td className="whitespace-nowrap py-1 pr-2 text-muted">{m.short} {m.y}</td>
                    <td className="py-1 pr-2">
                      <Input className="h-9 tabular" inputMode="decimal" aria-label={`${m.long} ${m.y} sales target`} value={y.monthlySales[i]} onChange={(e) => setMonth("monthlySales", i, e.target.value)} />
                    </td>
                    {!y.sameAsSales && (
                      <td className="py-1">
                        <Input className="h-9 tabular" inputMode="decimal" aria-label={`${m.long} ${m.y} produced target`} value={y.monthlyProduced[i]} onChange={(e) => setMonth("monthlyProduced", i, e.target.value)} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-medium">
                  <td className="pt-2 pr-2">Total</td>
                  <td className="tabular pt-2 pr-2">{salesTotal === null ? "—" : formatCAD(salesTotal)}</td>
                  {!y.sameAsSales && <td className="tabular pt-2">{producedTotal === null ? "—" : formatCAD(producedTotal)}</td>}
                </tr>
              </tfoot>
            </table>
            {(salesTotal === null || (!y.sameAsSales && producedTotal === null)) && (
              <p className="text-sm text-warning">Fill in every month with an amount (0 is fine).</p>
            )}
            {differs(salesTotal, salesAnnual) && (
              <p className="flex items-start gap-1.5 text-sm text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                Monthly sales targets add up to {formatCAD(salesTotal)}; the year goal will be shown as {formatCAD(salesTotal)}.
              </p>
            )}
            {!y.sameAsSales && differs(producedTotal, producedAnnual) && (
              <p className="flex items-start gap-1.5 text-sm text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                Monthly produced targets add up to {formatCAD(producedTotal)}; the year goal will be shown as {formatCAD(producedTotal)}.
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
