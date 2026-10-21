import { describe, expect, it } from "vitest";
import {
  confirmSchema,
  createEntrySchema,
  crewMembersSchema,
  crewSchema,
  noticeSendSchema,
  reorderCrewsSchema,
  schedulingPrefsSchema,
  updateEntrySchema,
  windowQuerySchema,
  windowRangeSchema,
} from "./schemas";
import { defaultScheduleSettings, scheduleSettingsSchema } from "./settings-schema";

const P = "00000000-0000-4000-8000-000000000001";
const C = "00000000-0000-4000-8000-000000000002";

describe("schedule schemas", () => {
  it("rejects an end before the start and bookings over 180 days", () => {
    expect(createEntrySchema.safeParse({ projectId: P, crewId: null, startDate: "2026-10-26", endDate: "2026-10-25" }).success).toBe(false);
    expect(createEntrySchema.safeParse({ projectId: P, crewId: null, startDate: "2026-01-01", endDate: "2026-12-31" }).success).toBe(false);
    const ok = createEntrySchema.parse({ projectId: P, crewId: C, startDate: "2026-10-26", phaseLabel: "  " });
    expect(ok).toMatchObject({ kind: "work", phaseLabel: null, allowNonWorkingStart: false, confirmOnHold: false });
  });

  it("tells absent fields from cleared ones on update", () => {
    const v = updateEntrySchema.parse({ id: P, version: 3, notes: "" });
    expect(v.notes).toBeNull();
    expect(v.crewNotes).toBeUndefined();
    expect(updateEntrySchema.safeParse({ id: P, version: 3 }).success).toBe(false);
    expect(updateEntrySchema.safeParse({ id: P, version: 3, startDate: "2026-10-27", endDate: "2026-10-26" }).success).toBe(false);
    expect(updateEntrySchema.safeParse({ id: P, version: 3, plannedHours: "12.555" }).success).toBe(false);
    expect(updateEntrySchema.parse({ id: P, version: 3, crewId: null }).crewId).toBeNull();
  });

  it("refuses a subject with a line break and strips extra keys from a notice", () => {
    const base = { projectId: P, kind: "start_date", variant: "exterior", subject: "Your project", body: "Hi", expectedStart: "2026-10-26" };
    expect(noticeSendSchema.safeParse({ ...base, subject: "Hi\r\nBcc: x@example.com" }).success).toBe(false);
    const parsed = noticeSendSchema.parse({ ...base, to: "attacker@example.com" });
    expect("to" in parsed).toBe(false);
    expect(parsed.channel).toBe("email");
    expect(noticeSendSchema.safeParse({ ...base, channel: "sms" }).success).toBe(false);
  });

  it("turns garbage search params into defaults", () => {
    expect(windowQuerySchema.parse({ view: "<script>", from: "2026-02-30", span: "99", crews: `${C},nope`, focus: "x" })).toEqual({
      view: "month",
      from: undefined,
      span: undefined,
      crews: [C],
      focus: undefined,
    });
    expect(windowQuerySchema.parse({ view: "month", from: "2026-10-19", span: "28", crews: [C, C] })).toMatchObject({ view: "month", from: "2026-10-19", span: 28, crews: [C, C] });
    expect(windowQuerySchema.parse({}).crews).toEqual([]);
  });

  it("bounds the window range", () => {
    expect(windowRangeSchema.safeParse({ from: "2026-10-19", to: "2026-12-19" }).success).toBe(true);
    expect(windowRangeSchema.safeParse({ from: "2026-10-19", to: "2026-12-20" }).success).toBe(false);
    expect(windowRangeSchema.safeParse({ from: "2026-10-19", to: "2026-10-18" }).success).toBe(false);
  });

  it("allows only one crew lead and no duplicate members", () => {
    expect(crewMembersSchema.safeParse({ crewId: C, members: [{ userId: "a", isLead: true }, { userId: "b", isLead: true }] }).success).toBe(false);
    expect(crewMembersSchema.safeParse({ crewId: C, members: [{ userId: "a", isLead: false }, { userId: "a", isLead: false }] }).success).toBe(false);
    expect(crewMembersSchema.safeParse({ crewId: C, members: [{ userId: "a", isLead: true }, { userId: "b", isLead: false }] }).success).toBe(true);
    expect(reorderCrewsSchema.safeParse({ ids: [C, C] }).success).toBe(false);
  });

  it("only accepts palette colours and sane hours", () => {
    const crew = { name: "[TEST DATA] Niko", kind: "in_house", trade: "painting", color: "emerald", crewSize: 3, hoursPerDay: "8", worksSaturdays: false };
    expect(crewSchema.safeParse(crew).success).toBe(true);
    expect(crewSchema.safeParse({ ...crew, color: "red; background:url(x)" }).success).toBe(false);
    expect(crewSchema.safeParse({ ...crew, hoursPerDay: "25" }).success).toBe(false);
    expect(crewSchema.safeParse({ ...crew, hoursPerDay: "0" }).success).toBe(false);
  });

  it("validates confirmations and scheduling preferences", () => {
    expect(confirmSchema.parse({ projectId: P, kind: "start_week", via: "phone", note: "" }).note).toBeNull();
    expect(confirmSchema.safeParse({ projectId: P, kind: "start_week", via: "carrier pigeon" }).success).toBe(false);
    expect(schedulingPrefsSchema.parse({ projectId: P, version: 0, notBefore: "2027-04-01" })).toMatchObject({ notBefore: "2027-04-01", schedulingNotes: null });
  });
});

describe("schedule settings", () => {
  it("fills defaults and normalises", () => {
    const d = defaultScheduleSettings();
    expect(d).toMatchObject({ weekStartsOn: 1, workDays: [1, 2, 3, 4, 5], holidayRegion: "BC", defaultSpanDays: 14, defaultCrewSize: 3 });
    expect(d.readinessChecks.map((c) => c.key)).toEqual(["pressure_wash", "paint", "colour_consult", "deposit"]);
    const s = scheduleSettingsSchema.parse({ workDays: [5, 1, 1], exteriorJobTypes: ["Exterior", "exterior", ""], extraClosedDays: [{ date: "2026-12-31", label: "B" }, { date: "2026-12-28", label: "A" }] });
    expect(s.workDays).toEqual([1, 5]);
    expect(s.exteriorJobTypes).toEqual(["exterior"]);
    expect(s.extraClosedDays.map((x) => x.date)).toEqual(["2026-12-28", "2026-12-31"]);
  });

  it("refuses duplicate check keys and duplicate closed days", () => {
    const check = { key: "paint", label: "Paint", states: { todo: "a", in_progress: "b", done: "c", not_needed: "d" } };
    expect(scheduleSettingsSchema.safeParse({ readinessChecks: [check, check] }).success).toBe(false);
    expect(scheduleSettingsSchema.safeParse({ extraClosedDays: [{ date: "2026-12-28", label: "A" }, { date: "2026-12-28", label: "B" }] }).success).toBe(false);
  });

  it("gives each read its own default checks", () => {
    const a = defaultScheduleSettings();
    a.readinessChecks[0].label = "changed";
    expect(defaultScheduleSettings().readinessChecks[0].label).toBe("Pressure washing");
  });
});
