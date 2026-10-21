import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));
const stored = vi.hoisted(() => ({ value: undefined as unknown, saved: [] as unknown[], audits: [] as unknown[] }));
vi.mock("./settings", () => ({
  getSetting: async (_key: string, fallback: unknown) => (stored.value === undefined ? fallback : { ...(fallback as object), ...(stored.value as object) }),
  setSetting: async (_key: string, value: unknown) => void stored.saved.push(value),
}));
vi.mock("./audit", () => ({ audit: async (entry: unknown) => void stored.audits.push(entry) }));

const { DEFAULT_GOALS } = await import("@/db/seed-data");
const { getGoals, saveGoals } = await import("./goals");

beforeEach(() => {
  stored.value = undefined;
  stored.saved = [];
  stored.audits = [];
});

describe("goals service", () => {
  it("returns the starter values when nothing is saved", async () => {
    expect(await getGoals()).toEqual(DEFAULT_GOALS);
  });

  it("falls back to the starter values when the stored goals are unreadable, without logging the amounts", async () => {
    stored.value = { years: { "2026": { sales: "-123456.78" } } };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const g = await getGoals();
    expect(g).toEqual(DEFAULT_GOALS);
    g.excludedLostReasons.push("mutated");
    expect(DEFAULT_GOALS.excludedLostReasons).toEqual(["Spam / wrong number"]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("123456");
    log.mockRestore();
  });

  it("saves normalised goals and audits before and after", async () => {
    const monthly = Array(12).fill("100000");
    const saved = await saveGoals({ ...DEFAULT_GOALS, years: { "2026": { ...DEFAULT_GOALS.years["2026"], monthlySales: monthly } } }, "owner-1");
    expect(saved.years["2026"].sales).toBe("1200000.00");
    expect(stored.saved).toEqual([saved]);
    expect(stored.audits).toEqual([expect.objectContaining({ actorId: "owner-1", action: "settings.goals", before: DEFAULT_GOALS, after: saved })]);
  });

  it("rejects invalid goals without saving", async () => {
    await expect(saveGoals({ ...DEFAULT_GOALS, fiscalYearStartMonth: 0 }, "owner-1")).rejects.toThrow();
    await expect(saveGoals({ ...DEFAULT_GOALS, years: { "2026": { ...DEFAULT_GOALS.years["2026"], monthlySales: Array(12).fill("9999999999.99") } } }, "owner-1")).rejects.toThrow();
    expect(stored.saved).toEqual([]);
  });
});
