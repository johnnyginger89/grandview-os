"use client";
import { useMemo, useState, type ReactNode } from "react";
import { ChevronUp, ClipboardCopy, Eye, EyeOff } from "lucide-react";
import { Button, Field, Select } from "@/components/ui";
import type { EstimateDoc } from "@/lib/estimating/document";
import type { EstimateResult } from "@/lib/estimating/engine";
import { labourSummary } from "@/lib/estimating/labour-summary";
import { paintList, paintListText } from "@/lib/estimating/paint-list";
import { d, formatCAD, formatNum, formatPct, fractionToPercent, marginToMarkup, percentToFraction, priceForMargin } from "@/lib/money";
import { cn } from "@/lib/utils";
import { NumInput } from "./editor-parts";
import { useHideCosts } from "./hide-costs";

function Row({ label, value, strong, large, muted }: { label: ReactNode; value: ReactNode; strong?: boolean; large?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-2", muted && "text-muted")}>
      <dt className={cn(!strong && "text-muted")}>{label}</dt>
      <dd className={cn("tabular", strong && "font-semibold", large && "text-xl")}>{value}</dd>
    </div>
  );
}

export interface TotalsProps {
  doc: EstimateDoc;
  result: EstimateResult | null;
  showCosting: boolean;
  ro: boolean;
  hoursPerDay: string;
  crewSize: number;
  setCrewSize: (n: number) => void;
  setSettings: (patch: Partial<EstimateDoc["settings"]>) => void;
  setContractType: (v: EstimateDoc["contractType"]) => void;
}

export function TotalsCard({ doc, result, showCosting, hoursPerDay, crewSize, setCrewSize, hideCosts, setHideCosts }: TotalsProps & { hideCosts: boolean; setHideCosts: (v: boolean) => void }) {
  const t = result?.totals;
  if (!t) return <p className="p-4 text-sm text-danger">Fix the highlighted values to see totals.</p>;
  const days = (n: number) => {
    const v = d(t.hours).isZero() ? d(0) : labourSummary(doc).days(n, hoursPerDay);
    return `${formatNum(v, 1)} ${v.eq(1) ? "day" : "days"}`;
  };
  const costs = showCosting && !hideCosts;
  return (
    <dl className="space-y-1 p-4 text-sm" aria-label="Totals">
      <Row label="Total incl. GST" value={<span data-testid="editor-total">{formatCAD(t.total)}</span>} strong large />
      <Row label="Before GST" value={formatCAD(t.price)} />
      <Row label={`GST (${formatPct(doc.settings.gstRate, 0)})`} value={formatCAD(t.gst)} />
      <Row label={`Deposit (${formatPct(doc.settings.depositPct, 0)})`} value={formatCAD(t.deposit)} />
      {t.minimumAdjustment.gt(0) && <Row label="Minimum job price applied" value={`+${formatCAD(t.minimumAdjustment)}`} muted />}
      {t.discount.gt(0) && <Row label="Discount" value={`−${formatCAD(t.discount)}`} muted />}
      {!hideCosts && !t.overrideAdjustment.isZero() && <Row label="Final price set by hand" value={formatCAD(t.overrideAdjustment)} muted />}
      {doc.settings.finalPriceBeforeUpgrades && doc.settings.priceOverride && t.selectedOptionsPrice.gt(0) && (
        <Row label="Upgrades on top of the final price" value={`+${formatCAD(t.selectedOptionsPrice)}`} muted />
      )}
      <div className="my-2 border-t border-border" />
      <Row
        label={
          <span className="flex items-center gap-1">
            {formatNum(t.hours, 1)} h ·
            <select aria-label="Crew size" value={crewSize} onChange={(e) => setCrewSize(Number(e.target.value))} className="rounded border border-border bg-surface text-xs">
              {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                <option key={n} value={n}>
                  {n} painters
                </option>
              ))}
            </select>
          </span>
        }
        value={`≈ ${days(crewSize)}`}
      />
      {t.unselectedOptionsPrice.gt(0) && <Row label="Options offered" value={formatCAD(t.unselectedOptionsPrice)} muted />}
      {showCosting && (
        <>
          <div className="my-2 flex items-center justify-between border-t border-border pt-2">
            <span className="text-xs font-medium uppercase tracking-wide text-subtle">Costs</span>
            <button type="button" onClick={() => setHideCosts(!hideCosts)} className="inline-flex min-h-8 items-center gap-1 text-xs text-brand hover:underline" aria-pressed={hideCosts}>
              {hideCosts ? <Eye className="size-3.5" aria-hidden /> : <EyeOff className="size-3.5" aria-hidden />} {hideCosts ? "Show costs" : "Hide costs"}
            </button>
          </div>
          {costs && (
            <>
              <Row label="Gross profit" value={formatCAD(t.grossProfit)} strong />
              <Row label="Gross margin" value={<span className={cn(t.grossMargin.lt(d(doc.settings.targetMargin).minus(0.05)) && "text-danger")}>{formatPct(t.grossMargin)}</span>} />
              <Row label="Total cost" value={formatCAD(t.totalCost)} muted />
              {t.hours.gt(0) && <Row label="Sales rate" value={`${formatCAD(t.price.div(t.hours))}/h`} muted />}
            </>
          )}
        </>
      )}
    </dl>
  );
}

function PaintTab({ doc }: { doc: EstimateDoc }) {
  const list = useMemo(() => {
    try {
      return paintList(doc);
    } catch {
      return null;
    }
  }, [doc]);
  const [copied, setCopied] = useState(false);
  if (!list) return null;
  if (!list.rows.length) return <p className="p-4 text-sm text-muted">No paint yet. Surfaces with a paint product show here by colour.</p>;
  const groups = new Map<string, typeof list.rows>();
  for (const r of list.rows) groups.set(r.product, [...(groups.get(r.product) ?? []), r]);
  return (
    <div className="space-y-3 p-4 text-sm">
      {[...groups.entries()].map(([product, rows]) => (
        <div key={product}>
          <p className="font-medium">{product}</p>
          <ul className="mt-1 space-y-1">
            {rows.map((r) => (
              <li key={r.key} className="flex flex-wrap justify-between gap-x-2 pl-3">
                <span className={cn(!r.colour && "text-warning")}>{r.colour ?? "Colour not chosen"}{r.sheen ? ` · ${r.sheen}` : ""}</span>
                <span className="tabular text-muted">{r.buy ? `${formatNum(r.gallons, 1)} gal → buy ${r.buy}` : "not measured yet"}</span>
                {r.rooms.length > 0 && <span className="w-full text-xs text-subtle">{r.rooms.join(", ")}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {list.ifOptionsAdded.length > 0 && (
        <p className="text-xs text-muted">
          If the customer adds the options: {list.ifOptionsAdded.map((r) => `+${r.buy} ${r.product}${r.colour ? `, ${r.colour}` : ""}`).join("; ")}
        </p>
      )}
      <p className="text-xs text-subtle">Includes the waste allowance. Exact gallons are what&apos;s priced; &ldquo;buy&rdquo; rounds up to gallons and quarts.</p>
      <Button
        size="sm"
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(paintListText(list));
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        <ClipboardCopy className="size-3.5" aria-hidden /> {copied ? "Copied" : "Copy list"}
      </Button>
    </div>
  );
}

function LabourTab({ doc, hoursPerDay, crewSize }: { doc: EstimateDoc; hoursPerDay: string; crewSize: number }) {
  const s = useMemo(() => {
    try {
      return labourSummary(doc);
    } catch {
      return null;
    }
  }, [doc]);
  if (!s) return null;
  if (!s.hours.gt(0)) return <p className="p-4 text-sm text-muted">No labour yet.</p>;
  const days = s.days(crewSize, hoursPerDay);
  const list = (rows: { name: string; hours: ReturnType<typeof d> }[]) => rows.map((r) => `${r.name} ${formatNum(r.hours, 1)}`).join(" · ");
  return (
    <div className="space-y-2 p-4 text-sm">
      <p className="font-medium">
        {formatNum(s.hours, 1)} h · {crewSize} painters ≈ {formatNum(days, 1)} {days.eq(1) ? "day" : "days"}
      </p>
      <p><span className="text-muted">By room: </span>{list(s.byRoom)}</p>
      <p><span className="text-muted">By type: </span>{list(s.byType)}</p>
      {s.setByHand > 0 && <p className="text-xs text-warning">{s.setByHand} {s.setByHand === 1 ? "surface has" : "surfaces have"} hours set by hand.</p>}
    </div>
  );
}

function PriceTab({ doc, result, ro, setSettings }: TotalsProps) {
  const [target, setTarget] = useState("");
  const t = result?.totals;
  const upgradesOnTop = !!doc.settings.finalPriceBeforeUpgrades;
  // Under the new rule the final price covers the base job only, so price it from the base job's cost.
  const marginBase = t ? (upgradesOnTop ? t.totalCost.minus(t.selectedOptionsCost) : t.totalCost) : null;
  return (
    <div className="space-y-4 p-4 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Method" className="col-span-2">
          <Select disabled={ro} value={doc.settings.pricingMethod} onChange={(e) => setSettings({ pricingMethod: e.target.value as "billing_rate" })}>
            <option value="billing_rate">Billing rate × hours + marked-up paint</option>
            <option value="target_margin">Cost ÷ (1 − target margin)</option>
          </Select>
        </Field>
        <Field label="Labour cost $/h"><NumInput ariaLabel="Labour cost per hour" disabled={ro} value={doc.settings.laborCostPerHour} onCommit={(v) => setSettings({ laborCostPerHour: v || "0" })} /></Field>
        {doc.settings.pricingMethod === "billing_rate" ? (
          <>
            <Field label="Billing rate $/h"><NumInput ariaLabel="Billing rate per hour" disabled={ro} value={doc.settings.billingRatePerHour} onCommit={(v) => setSettings({ billingRatePerHour: v || "0" })} /></Field>
            <Field label="Paint markup %"><NumInput ariaLabel="Material markup percent" disabled={ro} value={fractionToPercent(doc.settings.materialMarkupPct)} onCommit={(v) => setSettings({ materialMarkupPct: percentToFraction(v) })} /></Field>
          </>
        ) : (
          <Field label="Target margin %"><NumInput ariaLabel="Target margin percent" disabled={ro} value={fractionToPercent(doc.settings.targetMargin)} onCommit={(v) => setSettings({ targetMargin: percentToFraction(v, 95) })} /></Field>
        )}
        <Field label="Minimum job $"><NumInput ariaLabel="Minimum job price" disabled={ro} value={doc.settings.minimumJobPrice} onCommit={(v) => setSettings({ minimumJobPrice: v || "0" })} /></Field>
        <Field label="Discount $"><NumInput ariaLabel="Discount" disabled={ro} value={doc.settings.discount} placeholder="0" onCommit={(v) => setSettings({ discount: v || null })} /></Field>
        <Field label="Deposit %"><NumInput ariaLabel="Deposit percent" disabled={ro} value={fractionToPercent(doc.settings.depositPct)} onCommit={(v) => setSettings({ depositPct: percentToFraction(v) })} /></Field>
        <Field
          label="Final price $ (before GST)"
          className="col-span-2"
          hint={upgradesOnTop ? "Leave blank to use the calculated price. Upgrades the customer picks are added on top." : "Leave blank to use the calculated price. On this older estimate it already includes any upgrades the customer picks."}
        >
          <NumInput ariaLabel="Price override" disabled={ro} value={doc.settings.priceOverride} placeholder="—" onCommit={(v) => setSettings({ priceOverride: v || null })} />
        </Field>
      </div>
      {t && marginBase && (
        <div className="border-t border-border pt-3">
          <p className="mb-2 font-medium">What price gives a margin of…</p>
          <div className="flex items-center gap-2">
            <span className="w-20"><NumInput ariaLabel="Desired margin percent" value={target} placeholder="e.g. 50" onCommit={setTarget} /></span>
            <span className="text-muted">%</span>
          </div>
          {target && Number(target) < 95 && (
            <div className="mt-2 space-y-1 text-muted">
              <p>
                Price needed{upgradesOnTop && t.selectedOptionsPrice.gt(0) ? " before upgrades" : ""}: <span className="font-medium text-text">{formatCAD(priceForMargin(marginBase, Number(target) / 100))}</span> (markup {formatPct(marginToMarkup(Number(target) / 100))})
              </p>
              {!ro && (
                <Button size="sm" variant="secondary" onClick={() => setSettings({ priceOverride: priceForMargin(marginBase, Number(target) / 100).toDecimalPlaces(2).toFixed(2) })}>
                  Set as final price
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type Tab = "paint" | "labour" | "price";

/** Totals card plus Paint list / Labour / Price, used in the side panel and in the phone sheet. */
export function TotalsPanel(props: TotalsProps) {
  const [hideCosts, setHideCosts] = useHideCosts();
  const [tab, setTab] = useState<Tab>("paint");
  const tabs: { value: Tab; label: string }[] = [
    { value: "paint", label: "Paint list" },
    { value: "labour", label: "Labour" },
    ...(props.showCosting && !hideCosts ? [{ value: "price" as const, label: "Price" }] : []),
  ];
  const current = tabs.some((x) => x.value === tab) ? tab : "paint";
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-surface shadow-card">
        <TotalsCard {...props} hideCosts={hideCosts} setHideCosts={setHideCosts} />
      </div>
      <div className="rounded-lg border border-border bg-surface shadow-card">
        <div role="tablist" aria-label="Estimate details" className="flex border-b border-border">
          {tabs.map((x) => (
            <button
              key={x.value}
              type="button"
              role="tab"
              aria-selected={current === x.value}
              onClick={() => setTab(x.value)}
              className={cn("min-h-11 flex-1 border-b-2 px-2 text-sm font-medium", current === x.value ? "border-brand text-brand" : "border-transparent text-muted hover:text-text")}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div role="tabpanel">
          {current === "paint" && <PaintTab doc={props.doc} />}
          {current === "labour" && <LabourTab doc={props.doc} hoursPerDay={props.hoursPerDay} crewSize={props.crewSize} />}
          {current === "price" && <PriceTab {...props} />}
        </div>
      </div>
    </div>
  );
}

/** Below 1280 px: the total and Send stay on screen in a bar along the bottom. */
export function EstimateBar({ result, onOpen, send }: { result: EstimateResult | null; onOpen: () => void; send: ReactNode }) {
  const t = result?.totals;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur lg:left-60 xl:hidden print:hidden">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
        <button type="button" onClick={onOpen} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left" aria-label="Show totals, paint list and labour">
          <span className="min-w-0">
            <span className="block truncate text-base font-semibold tabular">{t ? `${formatCAD(t.total)} incl. GST` : "—"}</span>
            <span className="block truncate text-xs text-muted tabular">{t ? `before GST ${formatCAD(t.price)} · ${formatNum(t.hours, 1)} h` : "Fix the highlighted values"}</span>
          </span>
          <ChevronUp className="size-4 shrink-0 text-subtle" aria-hidden />
        </button>
        {send}
      </div>
    </div>
  );
}
