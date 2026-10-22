import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({ fake: null as unknown as FakeDb }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});
vi.mock("./schedule-settings", async () => {
  const { defaultScheduleSettings } = await import("@/lib/schedule/settings-schema");
  return { getScheduleSettings: async () => defaultScheduleSettings() };
});

const { listFieldJobs, toFieldJobView } = await import("./my-jobs");
const { calendarsFor } = await import("@/lib/schedule/working-days");
const { defaultScheduleSettings } = await import("@/lib/schedule/settings-schema");
type FieldJobRow = import("./my-jobs").FieldJobRow;

const cal = calendarsFor(defaultScheduleSettings(), "2026-10-01", "2026-12-31").calFor(null);
const TODAY = "2026-10-27"; // Tuesday

const KEYS = [
  "accessNotes", "address", "builtBefore1990", "contact", "crewName", "crewNotes", "customerName", "dayNumber", "endDate", "entryId", "jobTitle", "kind", "kindLabel",
  "mapsUrl", "onHold", "phaseLabel", "projectId", "projectNumber", "projectTypes", "section", "startDate", "tentative", "workingDays",
].sort();

function row(extra: Partial<FieldJobRow> = {}): FieldJobRow {
  return {
    entryId: "e-1", kind: "work", phaseLabel: "Bldg B", startDate: "2026-10-26", endDate: "2026-10-30", crewNotes: " Bring the tall ladder ",
    crewId: "crew-1", crewName: "[TEST DATA] Sub crew", worksSaturdays: false, projectId: "p-1", projectNumber: 3018, projectName: "[TEST DATA] Kim – Exterior repaint",
    estimateTitle: "Exterior repaint", projectStatus: "scheduled", confirmation: "date_sent", customerName: "[TEST DATA] Kim", street: "1 Example St",
    unit: null, city: "Surrey", province: "BC", postalCode: "V3S 0A1", accessNotes: "Gate code 1234", builtBefore1990: null, projectTypes: ["Exterior"],
    contactFirstName: "Kim", contactLastName: "Lee", contactPhone: "604-555-0100", customerPhone: null, ...extra,
  };
}

describe("toFieldJobView", () => {
  it("returns exactly the documented keys", () => {
    expect(Object.keys(toFieldJobView(row(), { isLead: true, today: TODAY, cal })).sort()).toEqual(KEYS);
  });

  it("never carries money, hours or internal fields even when the row has them", () => {
    const dirty = { ...row(), contractPrice: "98765.43", estimatedHours: "4321", plannedHours: "77.77", notes: "SECRET-INTERNAL", depositRequired: "2222.22", email: "kim@example.com" } as FieldJobRow;
    const json = JSON.stringify(toFieldJobView(dirty, { isLead: true, today: TODAY, cal }));
    for (const s of ["98765.43", "4321", "77.77", "SECRET-INTERNAL", "2222.22", "kim@example.com", "contractPrice", "Hours", "notes\":\"S", "$"]) expect(json).not.toContain(s);
  });

  it("gives the phone to the crew lead only", () => {
    expect(toFieldJobView(row(), { isLead: true, today: TODAY, cal }).contact).toEqual({ name: "Kim Lee", phone: "604-555-0100" });
    expect(toFieldJobView(row(), { isLead: false, today: TODAY, cal }).contact).toBeNull();
    expect(toFieldJobView(row({ contactPhone: null, customerPhone: "604-555-0101" }), { isLead: true, today: TODAY, cal }).contact).toEqual({ name: "Kim Lee", phone: "604-555-0101" });
    expect(toFieldJobView(row({ contactPhone: null }), { isLead: true, today: TODAY, cal }).contact).toBeNull();
  });

  it("works out the section and the day number", () => {
    const v = toFieldJobView(row(), { isLead: false, today: TODAY, cal });
    expect(v).toMatchObject({ section: "today", dayNumber: 2, workingDays: 5, tentative: true, jobTitle: "Exterior repaint", crewNotes: "Bring the tall ladder" });
    expect(v.address).toBe("1 Example St, Surrey, BC V3S 0A1");
    expect(v.mapsUrl).toBe("https://www.google.com/maps/search/?api=1&query=1%20Example%20St%2C%20Surrey%2C%20BC%20V3S%200A1");
    expect(toFieldJobView(row({ startDate: "2026-10-29", endDate: "2026-10-30" }), { isLead: false, today: TODAY, cal })).toMatchObject({ section: "this_week", dayNumber: null });
    expect(toFieldJobView(row({ startDate: "2026-11-02", endDate: "2026-11-03" }), { isLead: false, today: TODAY, cal }).section).toBe("upcoming");
    expect(toFieldJobView(row({ startDate: "2026-10-19", endDate: "2026-10-23" }), { isLead: false, today: TODAY, cal }).section).toBe("recent");
    expect(toFieldJobView(row({ confirmation: "date_confirmed" }), { isLead: false, today: TODAY, cal }).tentative).toBe(false);
  });

  it("flags a property built before 1990 for every crew member, lead or not", () => {
    expect(toFieldJobView(row({ builtBefore1990: true }), { isLead: false, today: TODAY, cal }).builtBefore1990).toBe(true);
    expect(toFieldJobView(row({ builtBefore1990: true }), { isLead: true, today: TODAY, cal }).builtBefore1990).toBe(true);
    // Not known isn't a warning: only a ticked box is.
    expect(toFieldJobView(row({ builtBefore1990: null }), { isLead: false, today: TODAY, cal }).builtBefore1990).toBe(false);
    expect(toFieldJobView(row({ builtBefore1990: false }), { isLead: false, today: TODAY, cal }).builtBefore1990).toBe(false);
  });

  it("has no day number on a weekend inside the booking", () => {
    expect(toFieldJobView(row({ startDate: "2026-10-30", endDate: "2026-11-03" }), { isLead: false, today: "2026-10-31", cal })).toMatchObject({ section: "today", dayNumber: null });
  });

  it("flags a job on hold instead of hiding it", () => {
    expect(toFieldJobView(row({ projectStatus: "on_hold" }), { isLead: false, today: TODAY, cal })).toMatchObject({ onHold: true, section: "today", entryId: "e-1" });
    for (const projectStatus of ["scheduled", "in_progress", "need_to_schedule"] as const) expect(toFieldJobView(row({ projectStatus }), { isLead: false, today: TODAY, cal }).onHold).toBe(false);
  });
});

describe("listFieldJobs", () => {
  beforeEach(() => h.fake.reset());

  const dbRow = { ...row(), projectId: "p-1", customerId: "cust-1" };

  it("is empty for someone in no crew", async () => {
    expect(await listFieldJobs({ id: "u-1" })).toEqual([]);
    expect(h.fake.calls).toHaveLength(1);
  });

  it("doesn't read phone numbers for a crew the user doesn't lead", async () => {
    h.fake.queue({ "select:crew_members": [[{ crewId: "crew-1", isLead: false }]], "select:schedule_entries": [[dbRow]] });
    const jobs = await listFieldJobs({ id: "u-1" }, new Date("2026-10-27T19:00:00Z"));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].contact).toBeNull();
    expect(h.fake.find("select", "customers")).toEqual([]);
  });

  it("still lists jobs on hold: only cancelled jobs are left out", async () => {
    h.fake.queue({ "select:crew_members": [[{ crewId: "crew-1", isLead: false }]], "select:schedule_entries": [[{ ...dbRow, projectStatus: "on_hold" }]] });
    const jobs = await listFieldJobs({ id: "u-1" }, new Date("2026-10-27T19:00:00Z"));
    expect(jobs.map((j) => j.onHold)).toEqual([true]);
    const where = new PgDialect().sqlToQuery(h.fake.find("select", "schedule_entries")[0].args.where[0] as SQL);
    expect(where.params).toContain("cancelled");
    expect(where.params).not.toContain("on_hold");
  });

  it("reads the property's pre-1990 flag with the booking", async () => {
    h.fake.queue({ "select:crew_members": [[{ crewId: "crew-1", isLead: false }]], "select:schedule_entries": [[{ ...dbRow, builtBefore1990: true }]] });
    const jobs = await listFieldJobs({ id: "u-1" }, new Date("2026-10-27T19:00:00Z"));
    expect(jobs[0].builtBefore1990).toBe(true);
  });

  it("reads the primary contact's phone for the lead", async () => {
    h.fake.queue({
      "select:crew_members": [[{ crewId: "crew-1", isLead: true }]],
      "select:schedule_entries": [[dbRow]],
      "select:customers": [[{ customerId: "cust-1", customerPhone: null, firstName: "Kim", lastName: "Lee", phone: "604-555-0100" }]],
    });
    const jobs = await listFieldJobs({ id: "u-1" }, new Date("2026-10-27T19:00:00Z"));
    expect(jobs[0].contact).toEqual({ name: "Kim Lee", phone: "604-555-0100" });
  });
});
