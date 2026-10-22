import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EstimateDoc } from "@/lib/estimating/document";
import type { RateSnapshot } from "@/lib/estimating/engine";
import type { FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeDb,
  /** db.query.<table>.findFirst / findMany answers. */
  found: {} as Record<string, unknown>,
  many: {} as Record<string, unknown[]>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  h.fake.db.query = new Proxy(
    {},
    { get: (_t, table: string) => ({ findFirst: async () => h.found[table], findMany: async () => h.many[table] ?? [] }) },
  );
  return { db: h.fake.db };
});
vi.mock("./settings", () => ({ getPricing: async () => ({}) }));
vi.mock("./rates", () => ({ getRateSnapshot: async () => null }));

const { assertCurrentVersion, EstimateLockedError, EstimateStaleError, nextVersion, saveEstimateDoc, setEstimateStatus } = await import("./estimates");

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const EST = uuid(1);
const ROOM = uuid(2);
const NOW = new Date("2026-10-21T18:00:00.000Z");
const V0 = new Date("2026-10-20T17:00:00.000Z");
const STALE = "This estimate was changed on another device or tab. Reload to see the latest.";

const walls: RateSnapshot = {
  rateId: uuid(500), rateVersion: 1, name: "Walls – roll & cut", unit: "sqft", basis: "units_per_hour", productionRate: "150", additionalCoatFactor: "0.85",
  defaultCoats: 2, laborCostPerHour: "45", billingRatePerHour: "75", material: null, materialWastePct: "0.1", otherCostPerUnit: "0", category: "Interior",
  customerLabel: null, proposalGroup: null,
};
const DOC: EstimateDoc = {
  title: "Interior repaint [TEST DATA]", jobType: "interior", contractType: "fixed_price", internalNotes: null, customerNotes: null, poNumber: null,
  areasExcluded: null, preparationOverride: null,
  settings: { pricingMethod: "target_margin", laborCostPerHour: "45", billingRatePerHour: "75", targetMargin: "0.4", materialMarkupPct: "0.15", minimumJobPrice: "0", gstRate: "0.05", depositPct: "0.3", discount: null, priceOverride: null },
  areas: [{ id: ROOM, parentId: null, name: "Living room", kind: "room", length: null, width: null, height: null, notes: null, customerDescription: null }],
  lines: [
    {
      id: uuid(3), areaId: ROOM, description: "Walls", customerDescription: null, customerDetail: null, rateSnapshot: walls, quantity: "300", quantitySource: "manual",
      coats: 2, prepFactor: "1", difficultyFactor: "1", conditionFactor: "1", accessFactor: "1", colour: null, sheen: null, overrideHours: null, overridePrice: "3000",
      isOptional: false, optionSelected: false,
    },
  ],
  costItems: [],
};
const row = (over: Record<string, unknown> = {}) => ({ id: EST, number: 5001, customerId: uuid(9), opportunityId: null, status: "draft", sentAt: null, updatedAt: V0, ...over });

const writes = () => h.fake.calls.filter((c) => c.op !== "select");

beforeEach(() => {
  h.fake.reset();
  h.found = {};
  h.many = {};
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("estimate versions", () => {
  it("compares the instant, whatever the format it comes back in", () => {
    const est = { updatedAt: new Date("2026-10-20T17:00:00.123Z") };
    expect(() => assertCurrentVersion(est, "2026-10-20T17:00:00.123Z")).not.toThrow();
    expect(() => assertCurrentVersion(est, "2026-10-20T10:00:00.123-07:00")).not.toThrow();
    expect(() => assertCurrentVersion(est, "2026-10-20T17:00:00.124Z")).toThrow(EstimateStaleError);
    expect(() => assertCurrentVersion(est, "not a date")).toThrow(STALE);
    // Server-side writes (templates, duplicates, restores) don't track a version.
    expect(() => assertCurrentVersion(est, null)).not.toThrow();
    expect(() => assertCurrentVersion(est, undefined)).not.toThrow();
  });

  it("always moves forward, even when this server's clock is behind the last save", () => {
    expect(nextVersion({ updatedAt: V0 }, NOW)).toEqual(NOW);
    const ahead = new Date(NOW.getTime() + 5_000);
    expect(nextVersion({ updatedAt: ahead }, NOW)).toEqual(new Date(ahead.getTime() + 1));
  });
});

describe("saving the estimate", () => {
  it("refuses a save made from an older copy, before writing anything", async () => {
    h.fake.queue({ "select:estimates": [[row({ updatedAt: new Date("2026-10-20T17:05:00.000Z") })]] });
    await expect(saveEstimateDoc(EST, DOC, V0.toISOString())).rejects.toThrow(STALE);
    expect(writes()).toEqual([]);
  });

  it("locks the estimate, saves when the copy is current and returns exactly the version it stored", async () => {
    h.fake.queue({ "select:estimates": [[row()]] });
    const r = await saveEstimateDoc(EST, DOC, V0.toISOString());
    expect(h.fake.find("select", "estimates")[0].args.for).toEqual(["update"]);
    expect(r.updatedAt).toBe(NOW.toISOString());
    const [update] = h.fake.find("update", "estimates");
    expect((update.args.set[0] as { updatedAt: Date }).updatedAt).toEqual(NOW);
    expect(h.fake.find("delete", "estimate_lines")).toHaveLength(1);
    expect(h.fake.find("insert", "estimate_lines")).toHaveLength(1);
  });

  it("won't save over an accepted estimate", async () => {
    h.fake.queue({ "select:estimates": [[row({ status: "accepted" })]] });
    await expect(saveEstimateDoc(EST, DOC, V0.toISOString())).rejects.toThrow(EstimateLockedError);
    expect(writes()).toEqual([]);
  });

  it("server-side saves without a version still go through", async () => {
    h.fake.queue({ "select:estimates": [[row({ updatedAt: new Date("2026-10-20T17:05:00.000Z") })]] });
    await expect(saveEstimateDoc(EST, DOC)).resolves.toMatchObject({ updatedAt: NOW.toISOString() });
  });
});

describe("office status changes", () => {
  it("Mark declined can't undo a signature that landed first", async () => {
    h.fake.queue({ "select:estimates": [[row({ status: "accepted" })]] });
    await expect(setEstimateStatus(EST, "declined", "owner-1")).rejects.toThrow("Can't change an estimate from accepted to declined");
    expect(writes()).toEqual([]);
  });

  it("refuses a change made from an out-of-date screen", async () => {
    h.fake.queue({ "select:estimates": [[row({ status: "sent", updatedAt: new Date("2026-10-20T17:05:00.000Z") })]] });
    await expect(setEstimateStatus(EST, "draft", "owner-1", V0.toISOString())).rejects.toThrow(STALE);
    expect(writes()).toEqual([]);
  });

  it("Mark as sent saves a version and records the send at the estimate's new version", async () => {
    h.fake.queue({ "select:estimates": [[row()]], "select:estimate_revisions": [[{ latest: 2 }]] });
    h.found.estimates = { ...row(), ...DOC.settings, title: DOC.title, jobType: "interior", contractType: "fixed_price" };
    h.many.estimateAreas = DOC.areas;
    h.many.estimateLines = DOC.lines;
    const r = await setEstimateStatus(EST, "sent", "owner-1", V0.toISOString());
    expect(r.updatedAt).toBe(NOW.toISOString());
    expect(h.fake.find("insert", "estimate_revisions")[0].args.values[0]).toMatchObject({ estimateId: EST, revision: 3, reason: "Sent to customer" });
    const status = h.fake.find("update", "estimates").map((c) => c.args.set[0]).find((s) => (s as { status?: string }).status);
    expect(status).toEqual({ status: "sent", sentAt: NOW, updatedAt: NOW });
    expect(h.fake.find("insert", "audit_log").map((c) => (c.args.values[0] as { action: string }).action)).toEqual(["estimate.revision", "estimate.status"]);
  });
});
