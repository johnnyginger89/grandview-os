import { describe, expect, it } from "vitest";
import { MATERIALS, RATES } from "./seed-data";
import { planStarterSeed, readSeededStarters, type SeededStarters, type StarterMaterial, type StarterRate } from "./seed-starters";

interface Database {
  materials: { manufacturer: string; name: string }[];
  rates: { code: string; proposalGroup: string | null }[];
  seeded: SeededStarters | null;
}
type Starters = { materials: readonly StarterMaterial[]; rates: readonly StarterRate[] };

const STARTERS: Starters = { materials: MATERIALS, rates: RATES };
const ALL = { materials: MATERIALS.map((m) => m.key), rates: RATES.map((r) => r.code) };
const empty = (): Database => ({ materials: [], rates: [], seeded: null });

/** One deploy against an in-memory database: plan, then apply the plan the way seed.ts does. */
function deploy(db: Database, starters: Starters = STARTERS) {
  const plan = planStarterSeed(starters, db, db.seeded);
  const fill = new Map(plan.proposalGroups.map((p) => [p.code, p.proposalGroup]));
  const next: Database = {
    materials: [...db.materials, ...starters.materials.filter((m) => plan.materials.includes(m.key)).map(({ manufacturer, name }) => ({ manufacturer, name }))],
    rates: [
      ...db.rates.map((r) => ({ ...r, proposalGroup: r.proposalGroup ?? fill.get(r.code) ?? null })),
      ...starters.rates.filter((r) => plan.rates.includes(r.code)).map((r) => ({ code: r.code, proposalGroup: r.proposalGroup ?? null })),
    ],
    seeded: plan.recordChanged ? plan.seeded : db.seeded,
  };
  return { plan, db: next };
}

const nothingInserted = (plan: ReturnType<typeof planStarterSeed>) => expect({ materials: plan.materials, rates: plan.rates }).toEqual({ materials: [], rates: [] });

// Starters added to seed-data after a database was first seeded.
const LATER: Starters = {
  materials: [...MATERIALS, { key: "bm-ultra-spec", manufacturer: "Benjamin Moore", name: "Ultra Spec 500 Interior" }],
  rates: [...RATES, { code: "INT-ACCENT", proposalGroup: "Walls" }],
};

describe("starter materials and rates", () => {
  it("keys and codes are unique, since the record remembers starters by them", () => {
    expect(new Set(ALL.materials).size).toBe(MATERIALS.length);
    expect(new Set(ALL.rates).size).toBe(RATES.length);
  });

  it("a fresh database gets every starter, and a second deploy adds nothing", () => {
    const first = deploy(empty());
    expect(first.plan.materials).toEqual(ALL.materials);
    expect(first.plan.rates).toEqual(ALL.rates);
    expect(first.plan.seeded).toEqual(ALL);
    expect(first.plan.recordChanged).toBe(true);

    const second = deploy(first.db);
    nothingInserted(second.plan);
    expect(second.plan.proposalGroups).toEqual([]);
    expect(second.plan.recordChanged).toBe(false);
    expect(second.db).toEqual(first.db);
  });

  it("an existing database without a record: every starter is recorded as seeded and nothing is added", () => {
    // Seeded before the record existed; since then the owner renamed, recoded and deleted starters.
    const production: Database = {
      materials: [
        { manufacturer: "Sherwin-Williams", name: "Duration Home Interior – supplier price" },
        { manufacturer: "Benjamin Moore", name: "Aura Interior" },
      ],
      rates: [
        { code: "WALL-2C", proposalGroup: "Walls" },
        { code: "INT-CEIL", proposalGroup: "Ceilings" },
      ],
      seeded: null,
    };
    const { plan, db } = deploy(production);
    nothingInserted(plan);
    expect(plan.seeded).toEqual(ALL);
    expect(plan.recordChanged).toBe(true);
    nothingInserted(deploy(db).plan);
  });

  it("without a record, only a table that is still empty gets its starters", () => {
    const { plan } = deploy({ materials: [{ manufacturer: "Cloverdale", name: "Own house paint" }], rates: [], seeded: null });
    expect(plan.materials).toEqual([]);
    expect(plan.rates).toEqual(ALL.rates);
    expect(plan.seeded).toEqual(ALL);
  });

  it("a material the owner renamed never comes back", () => {
    const { db } = deploy(empty());
    const renamed = { ...db, materials: db.materials.map((m) => (m.name === "Duration Home Interior" ? { ...m, name: "Duration Interior (2026 price)" } : m)) };
    const { plan } = deploy(renamed);
    nothingInserted(plan);
    expect(plan.recordChanged).toBe(false);
  });

  it("a rate whose code the owner changed never comes back under the old code", () => {
    const { db } = deploy(empty());
    const recoded = { ...db, rates: db.rates.map((r) => (r.code === "INT-WALL" ? { ...r, code: "WALL-2C" } : r)) };
    const { plan } = deploy(recoded);
    nothingInserted(plan);
    expect(plan.proposalGroups).toEqual([]);
  });

  it("a rate or material the owner deleted never comes back", () => {
    const { db } = deploy(empty());
    const deleted = { ...db, rates: db.rates.filter((r) => r.code !== "INT-CROWN"), materials: db.materials.filter((m) => m.name !== "Aura Interior") };
    nothingInserted(deploy(deleted).plan);
  });

  it("a starter added to the code later goes into a database with the record once", () => {
    const { db } = deploy(empty());
    const first = deploy(db, LATER);
    expect(first.plan.materials).toEqual(["bm-ultra-spec"]);
    expect(first.plan.rates).toEqual(["INT-ACCENT"]);
    expect(first.plan.seeded).toEqual({ materials: [...ALL.materials, "bm-ultra-spec"], rates: [...ALL.rates, "INT-ACCENT"] });

    const second = deploy(first.db, LATER);
    nothingInserted(second.plan);
    expect(second.plan.recordChanged).toBe(false);

    const deleted = { ...second.db, rates: second.db.rates.filter((r) => r.code !== "INT-ACCENT") };
    nothingInserted(deploy(deleted, LATER).plan);
  });

  it("a new starter whose code or name the owner already uses is recorded, not duplicated", () => {
    const { db } = deploy(empty());
    const owners = {
      ...db,
      materials: [...db.materials, { manufacturer: "Benjamin Moore", name: "Ultra Spec 500 Interior" }],
      rates: [...db.rates, { code: "INT-ACCENT", proposalGroup: "Accent walls" }],
    };
    const { plan } = deploy(owners, LATER);
    nothingInserted(plan);
    expect(plan.seeded.materials).toContain("bm-ultra-spec");
    expect(plan.seeded.rates).toContain("INT-ACCENT");
  });

  it("a starter taken out of the code stays recorded, so putting it back later doesn't re-add it", () => {
    const { db } = deploy(empty());
    const without: Starters = { materials: MATERIALS, rates: RATES.filter((r) => r.code !== "GEN-HOURLY") };
    const removed = deploy({ ...db, rates: db.rates.filter((r) => r.code !== "GEN-HOURLY") }, without);
    expect(removed.plan.seeded.rates).toContain("GEN-HOURLY");
    expect(removed.plan.recordChanged).toBe(false);
    nothingInserted(deploy(removed.db).plan);
  });

  it("fills an empty proposal group on starter rates that still exist, never overwriting the owner's", () => {
    const db: Database = {
      materials: [],
      rates: [
        { code: "INT-WALL", proposalGroup: null },
        { code: "INT-CEIL", proposalGroup: "Ceilings & soffits" },
        { code: "PREP-PW", proposalGroup: null }, // starter has no group
        { code: "WALL-2C", proposalGroup: null }, // not a starter code
      ],
      seeded: ALL,
    };
    const { plan } = deploy(db);
    expect(plan.proposalGroups).toEqual([{ code: "INT-WALL", proposalGroup: "Walls" }]);
    nothingInserted(plan);
  });

  it("reads the stored record, and treats a missing or unreadable one as not recorded yet", () => {
    expect(readSeededStarters({ materials: ["sw-duration-int"], rates: ["INT-WALL"] })).toEqual({ materials: ["sw-duration-int"], rates: ["INT-WALL"] });
    for (const bad of [undefined, null, "INT-WALL", [], { materials: [] }, { materials: "sw-duration-int", rates: [] }, { materials: [1], rates: [] }]) {
      expect(readSeededStarters(bad), JSON.stringify(bad)).toBeNull();
    }
    // So on a database with rows an unreadable record adds nothing, like a missing one.
    const { db } = deploy(empty());
    const recoded = { ...db, rates: db.rates.map((r) => (r.code === "INT-WALL" ? { ...r, code: "WALL-2C" } : r)) };
    nothingInserted(planStarterSeed(STARTERS, recoded, readSeededStarters({ materials: "oops" })));
  });
});
