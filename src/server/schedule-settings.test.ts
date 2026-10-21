import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ value: undefined as unknown, saved: [] as unknown[], audits: [] as unknown[], pricing: { hoursPerCrewDay: "8" } as Record<string, unknown> }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("./settings", () => ({
  getSetting: async (_k: string, fallback: unknown) => (h.value === undefined ? fallback : { ...(fallback as object), ...(h.value as object) }),
  setSetting: async (_k: string, v: unknown) => void h.saved.push(v),
  getPricing: async () => h.pricing,
}));
vi.mock("./audit", () => ({ audit: async (e: unknown) => void h.audits.push(e) }));
vi.mock("./schedule-hooks", () => ({}));

const { getHoursPerCrewDay, getScheduleSettings, saveScheduleSettings } = await import("./schedule-settings");
const { afterScheduleChange } = await vi.importActual<typeof import("./schedule-hooks")>("./schedule-hooks");

beforeEach(() => {
  h.value = undefined;
  h.saved = [];
  h.audits = [];
  h.pricing = { hoursPerCrewDay: "8" };
});

describe("schedule settings", () => {
  it("returns the defaults when nothing is saved, and when the stored value is broken", async () => {
    expect((await getScheduleSettings()).workDays).toEqual([1, 2, 3, 4, 5]);
    h.value = { workDays: "weekdays" };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await getScheduleSettings()).workDays).toEqual([1, 2, 3, 4, 5]);
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("saves validated settings and audits before and after", async () => {
    const saved = await saveScheduleSettings({ extraClosedDays: [{ date: "2026-12-28", label: "Christmas shutdown" }] }, { id: "owner-1" });
    expect(saved.extraClosedDays).toEqual([{ date: "2026-12-28", label: "Christmas shutdown" }]);
    expect(h.saved).toEqual([saved]);
    expect(h.audits).toEqual([expect.objectContaining({ action: "settings.schedule", entityId: "schedule", after: saved })]);
    await expect(saveScheduleSettings({ workDays: [] }, { id: "owner-1" })).rejects.toThrow();
  });

  it("reads the hours per crew day from pricing, with a safe fallback", async () => {
    h.pricing = { hoursPerCrewDay: "7.5" };
    expect(await getHoursPerCrewDay()).toBe("7.5");
    h.pricing = { hoursPerCrewDay: "lots" };
    expect(await getHoursPerCrewDay()).toBe("8");
    h.pricing = { hoursPerCrewDay: "0" };
    expect(await getHoursPerCrewDay()).toBe("8");
  });
});

describe("afterScheduleChange", () => {
  it("is a quiet seam today", async () => {
    await expect(afterScheduleChange({ kind: "create", projectId: "p", entryIds: ["e"], actorId: "u" })).resolves.toBeUndefined();
  });
});
