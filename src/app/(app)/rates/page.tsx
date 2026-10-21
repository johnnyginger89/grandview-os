import Link from "next/link";
import { asc } from "drizzle-orm";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { materials } from "@/db/schema";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { listFactors, listRates } from "@/server/rates";
import { getEstimatingPresets } from "@/server/settings";
import { PresetsEditor } from "./presets-editor";
import { SettingsTabs } from "../settings/tabs";
import { FactorsEditor, MaterialsTable, RatesTable } from "./rates-client";

export const metadata = { title: "Rates" };

const TABS = [
  { key: "rates", label: "Production rates" },
  { key: "materials", label: "Materials" },
  { key: "multipliers", label: "Multipliers" },
  { key: "rooms", label: "Room presets" },
];

export default async function RatesPage({ searchParams }: { searchParams: Promise<{ tab?: string; archived?: string }> }) {
  const user = await requirePermission("rates.read");
  const { tab = "rates", archived } = await searchParams;
  const canEdit = can(user.role, "rates.write");
  const mats = await db.query.materials.findMany({ orderBy: [asc(materials.manufacturer), asc(materials.name)] });

  return (
    <>
      <PageHeader title="Settings" description="Rates: changes create a new version. Existing estimates keep the rates they were built with." />
      <SettingsTabs active="rates" role={user.role} />
      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <Link key={t.key} href={`/rates?tab=${t.key}`} className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === t.key ? "border-brand text-brand" : "border-transparent text-muted hover:text-text"}`}>{t.label}</Link>
        ))}
      </nav>
      {tab === "rates" && (
        <RatesTable
          rows={(await listRates(archived === "1")).map((r) => ({
            id: r.rate.id, code: r.rate.code, name: r.rate.name, customerLabel: r.rate.customerLabel ?? "", proposalGroup: r.rate.proposalGroup ?? "", category: r.rate.category,
            unit: r.rate.unit, basis: r.rate.basis, dimensionSource: r.rate.dimensionSource, active: r.rate.active,
            version: r.version?.version ?? 0, productionRate: r.version?.productionRate ?? "0", additionalCoatFactor: r.version?.additionalCoatFactor ?? "1",
            defaultCoats: r.version?.defaultCoats ?? 1, laborCostPerHour: r.version?.laborCostPerHour ?? "", billingRatePerHour: r.version?.billingRatePerHour ?? "",
            materialId: r.version?.materialId ?? "", materialName: r.material ? `${r.material.manufacturer} ${r.material.name}` : "",
            coverageOverride: r.version?.coverageOverride ?? "", materialWastePct: r.version?.materialWastePct ?? "0", otherCostPerUnit: r.version?.otherCostPerUnit ?? "0",
            prepNotes: r.version?.prepNotes ?? "", crewNotes: r.version?.crewNotes ?? "", changeNote: r.version?.changeNote ?? "",
          }))}
          materials={mats.map((m) => ({ id: m.id, label: `${m.manufacturer} ${m.name}${m.finish ? ` (${m.finish})` : ""}` }))}
          canEdit={canEdit}
          showArchived={archived === "1"}
        />
      )}
      {tab === "materials" && (
        <MaterialsTable rows={mats.map((m) => ({ ...m, finish: m.finish ?? "", supplier: m.supplier ?? "", sku: m.sku ?? "", notes: m.notes ?? "", createdAt: undefined, updatedAt: m.updatedAt.toISOString() }))} canEdit={canEdit} />
      )}
      {tab === "rooms" && (
        <PresetsEditor
          initial={await getEstimatingPresets()}
          rates={(await listRates()).map((r) => ({ code: r.rate.code, name: r.rate.name, category: r.rate.category, unit: r.rate.unit }))}
          canEdit={canEdit}
        />
      )}
      {tab === "multipliers" && <FactorsEditor rows={(await listFactors()).map((f) => ({ id: f.id, kind: f.kind, label: f.label, value: f.value }))} canEdit={canEdit} />}
    </>
  );
}
