/**
 * Production rates on a real database (`pnpm test:db`), through the service calls the
 * Rates page and the estimate editor make. CLAUDE.md rule 5: editing a rate adds a
 * version, and estimates keep the copy of the rate they were built with.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog, estimates, productionRates } from "@/db/schema";
import type { EstimateDoc } from "@/lib/estimating/document";
import type { RateSnapshot } from "@/lib/estimating/engine";
import { d } from "@/lib/money";
import { createTestUser, uniqueTag } from "@/test/db/fixtures";
import { createCustomer } from "./customers";
import { createEstimate, loadEstimate, saveEstimateDoc } from "./estimates";
import { createRate, getRateSnapshot, listRates, rateHistory, saveRateVersion, setRateActive, updateRateIdentity } from "./rates";

let ownerId: string;

beforeAll(async () => {
  ownerId = (await createTestUser("owner", "Rates owner")).id;
});

/**
 * A rate as the Rates page sends it: 200 sq ft an hour, one coat, no paint (so the price
 * follows the hours). `identity` has no proposal group, as older forms send it.
 */
function newRate() {
  const tag = uniqueTag();
  return {
    tag,
    identity: {
      code: `DBT-${tag}`.toUpperCase(),
      name: `[TEST DATA] Walls ${tag}`,
      customerLabel: "",
      category: "[TEST DATA]",
      unit: "sqft" as const,
      basis: "units_per_hour" as const,
      dimensionSource: "manual" as const,
    },
    values: {
      productionRate: "200",
      additionalCoatFactor: "1",
      defaultCoats: 1,
      laborCostPerHour: "",
      billingRatePerHour: "",
      materialId: "",
      coverageOverride: "",
      materialWastePct: "0",
      otherCostPerUnit: "0",
      changeNote: "[TEST DATA] first",
    },
  };
}

/** An estimate with one 10,000 sq ft, one-coat line built from `rate`, saved as the editor saves it. */
async function estimateUsing(rate: RateSnapshot, tag: string) {
  const customer = await createCustomer({ displayName: `[TEST DATA] Rates customer ${tag}` }, null, null, ownerId);
  const est = await createEstimate({ customerId: customer.id, title: `[TEST DATA] Rates estimate ${tag}` }, ownerId);
  const { doc } = (await loadEstimate(est.id))!;
  const areaId = randomUUID();
  const withLine: EstimateDoc = {
    ...doc,
    areas: [{ id: areaId, parentId: null, name: "Living room", kind: "room", length: null, width: null, height: null }],
    lines: [
      {
        id: randomUUID(),
        areaId,
        description: "Walls",
        rateSnapshot: rate,
        quantity: "10000",
        quantitySource: "manual",
        coats: 1,
        prepFactor: "1",
        difficultyFactor: "1",
        conditionFactor: "1",
        accessFactor: "1",
        overrideHours: null,
        overridePrice: null,
        isOptional: false,
        optionSelected: false,
      },
    ],
  };
  await saveEstimateDoc(est.id, withLine);
  return est.id;
}

async function totals(estimateId: string) {
  const e = await db.query.estimates.findFirst({ where: eq(estimates.id, estimateId) });
  return { hours: e!.totalHours, cost: e!.totalCost, price: e!.totalPrice, withTax: e!.totalWithTax };
}

async function auditActions(rateId: string) {
  const rows = await db.select({ action: auditLog.action }).from(auditLog).where(and(eq(auditLog.entityType, "production_rate"), eq(auditLog.entityId, rateId)));
  return rows.map((r) => r.action).sort();
}

describe("editing a production rate", () => {
  it("adds a version and leaves estimates built with the old one exactly as they were", async () => {
    const { tag, identity, values } = newRate();
    const rate = await createRate({ ...identity, proposalGroup: "Walls" }, values, ownerId);
    const v1 = (await getRateSnapshot(rate.id))!;
    expect(v1).toMatchObject({ rateId: rate.id, rateVersion: 1, productionRate: "200.0000", name: identity.name, proposalGroup: "Walls" });

    const estimateId = await estimateUsing(v1, tag);
    const before = await totals(estimateId);
    expect(before.hours).toBe("50.0000"); // 10,000 sq ft ÷ 200 sq ft an hour

    const v2row = await saveRateVersion(rate.id, { ...values, productionRate: "100", changeNote: "[TEST DATA] slower crew" }, ownerId);
    expect(v2row.version).toBe(2);

    // New lines get version 2…
    expect(await getRateSnapshot(rate.id)).toMatchObject({ rateVersion: 2, productionRate: "100.0000" });
    const current = await db.query.productionRates.findFirst({ where: eq(productionRates.id, rate.id) });
    expect(current!.currentVersionId).toBe(v2row.id);
    // …version 1 is kept as it was…
    const history = await rateHistory(rate.id);
    expect(history.map((v) => [v.version, v.productionRate, v.changeNote])).toEqual([
      [2, "100.0000", "[TEST DATA] slower crew"],
      [1, "200.0000", "[TEST DATA] first"],
    ]);
    // …and the estimate still uses its copy of version 1, at the same hours and price.
    const after = (await loadEstimate(estimateId))!;
    expect(after.doc.lines).toHaveLength(1);
    expect(after.doc.lines[0].rateSnapshot).toEqual(v1);
    expect(await totals(estimateId)).toEqual(before);

    // Saving the estimate for any other edit doesn't pull in the new version either.
    await saveEstimateDoc(estimateId, { ...after.doc, customerNotes: "[TEST DATA] Customer asked about colours" });
    expect((await loadEstimate(estimateId))!.doc.lines[0].rateSnapshot).toEqual(v1);
    expect(await totals(estimateId)).toEqual(before);

    expect(await auditActions(rate.id)).toEqual(["rate.version", "rate.version"]);
  });

  it("moves a line to the new version only when the estimator chooses “Use current rate”", async () => {
    const { tag, identity, values } = newRate();
    const rate = await createRate(identity, values, ownerId);
    const estimateId = await estimateUsing((await getRateSnapshot(rate.id))!, tag);
    const before = await totals(estimateId);
    await saveRateVersion(rate.id, { ...values, productionRate: "100" }, ownerId);

    // What the editor's "Use current rate" does: copy the current snapshot onto the line and save.
    const { doc } = (await loadEstimate(estimateId))!;
    const v2 = (await getRateSnapshot(rate.id))!;
    await saveEstimateDoc(estimateId, { ...doc, lines: doc.lines.map((l) => ({ ...l, rateSnapshot: v2 })) });

    const after = await totals(estimateId);
    expect((await loadEstimate(estimateId))!.doc.lines[0].rateSnapshot).toMatchObject({ rateVersion: 2, productionRate: "100.0000" });
    expect(after.hours).toBe("100.0000"); // half the speed: twice the hours…
    expect(d(after.price).div(d(before.price)).toFixed(2)).toBe("2.00"); // …and twice the price
  });
});

describe("renaming and archiving a production rate", () => {
  it("renaming changes the rate for new lines without a new version or touching existing estimates", async () => {
    const { tag, identity, values } = newRate();
    const rate = await createRate({ ...identity, proposalGroup: "Walls" }, values, ownerId);
    const v1 = (await getRateSnapshot(rate.id))!;
    const estimateId = await estimateUsing(v1, tag);
    const versionId = (await db.query.productionRates.findFirst({ where: eq(productionRates.id, rate.id) }))!.currentVersionId;

    // Codes are stored in capitals; a form without the proposal group leaves it as it was.
    await updateRateIdentity(rate.id, { ...identity, code: `${identity.code}-b`.toLowerCase(), name: `[TEST DATA] Feature walls ${tag}` }, ownerId);

    const renamed = await db.query.productionRates.findFirst({ where: eq(productionRates.id, rate.id) });
    expect(renamed).toMatchObject({ code: `${identity.code}-B`, name: `[TEST DATA] Feature walls ${tag}`, proposalGroup: "Walls", currentVersionId: versionId });
    expect((await rateHistory(rate.id)).map((v) => v.version)).toEqual([1]);
    expect(await getRateSnapshot(rate.id)).toMatchObject({ rateVersion: 1, name: `[TEST DATA] Feature walls ${tag}` });
    expect((await loadEstimate(estimateId))!.doc.lines[0].rateSnapshot).toEqual(v1);

    // An empty proposal group clears it.
    await updateRateIdentity(rate.id, { ...identity, code: `${identity.code}-B`, proposalGroup: "" }, ownerId);
    expect((await db.query.productionRates.findFirst({ where: eq(productionRates.id, rate.id) }))!.proposalGroup).toBeNull();

    expect(await auditActions(rate.id)).toEqual(["rate.update", "rate.update", "rate.version"]);
  });

  it("refuses a code another rate already uses, and changes nothing", async () => {
    const a = newRate();
    const b = newRate();
    const rateA = await createRate(a.identity, a.values, ownerId);
    const rateB = await createRate(b.identity, b.values, ownerId);

    await expect(updateRateIdentity(rateA.id, { ...a.identity, code: b.identity.code }, ownerId)).rejects.toThrow();
    expect((await db.query.productionRates.findFirst({ where: eq(productionRates.id, rateA.id) }))!.code).toBe(a.identity.code);

    await expect(createRate({ ...a.identity, code: b.identity.code }, a.values, ownerId)).rejects.toThrow();
    const withCode = await db.select({ id: productionRates.id }).from(productionRates).where(eq(productionRates.code, b.identity.code));
    expect(withCode).toEqual([{ id: rateB.id }]);
  });

  it("archiving hides the rate from new lines but leaves estimates that use it working, and restoring brings it back", async () => {
    const { tag, identity, values } = newRate();
    const rate = await createRate(identity, values, ownerId);
    const v1 = (await getRateSnapshot(rate.id))!;
    const estimateId = await estimateUsing(v1, tag);
    const before = await totals(estimateId);

    await setRateActive(rate.id, false, ownerId);
    expect((await listRates()).some((r) => r.rate.id === rate.id)).toBe(false);
    expect((await listRates(true)).find((r) => r.rate.id === rate.id)?.rate.active).toBe(false);

    const { doc } = (await loadEstimate(estimateId))!;
    expect(doc.lines[0].rateSnapshot).toEqual(v1);
    await saveEstimateDoc(estimateId, doc);
    expect(await totals(estimateId)).toEqual(before);

    await setRateActive(rate.id, true, ownerId);
    expect((await listRates()).find((r) => r.rate.id === rate.id)?.version?.version).toBe(1);
    expect(await auditActions(rate.id)).toEqual(["rate.activate", "rate.archive", "rate.version"]);
  });
});

describe("creating a production rate", () => {
  it("saves nothing when a number is invalid, so the corrected rate can be saved with the same code", async () => {
    const { identity, values } = newRate();
    await expect(createRate(identity, { ...values, productionRate: "" }, ownerId)).rejects.toThrow("Enter a number");
    expect(await db.select({ id: productionRates.id }).from(productionRates).where(eq(productionRates.code, identity.code))).toEqual([]);
    await expect(createRate(identity, values, ownerId)).resolves.toMatchObject({ code: identity.code });
  });
});
