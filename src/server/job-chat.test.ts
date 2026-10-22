import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCall, FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeDb,
  audits: [] as { action: string }[],
  collapsed: [] as { ids: string[]; title: string; body?: string | null; href?: string | null }[],
  notified: [] as { ids: string[]; title: string; href?: string | null }[],
  rows: {} as Record<string, unknown[] | ((c: FakeCall) => unknown[])>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});
vi.mock("./audit", () => ({ audit: async (e: { action: string }) => void h.audits.push(e) }));
vi.mock("./notifications", () => ({
  notify: async (ids: string[], n: { title: string; href?: string | null }) => void h.notified.push({ ids, title: n.title, href: n.href }),
  notifyCollapsed: async (ids: string[], n: { title: string; body?: string | null; href?: string | null }) => void h.collapsed.push({ ids, ...n }),
  notifyLater: (task: () => Promise<void>) => void task(),
}));
vi.mock("./schedule-settings", async () => {
  const { defaultScheduleSettings } = await import("@/lib/schedule/settings-schema");
  return { getScheduleSettings: async () => defaultScheduleSettings() };
});

const chat = await import("./job-chat");

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PROJECT = uuid(1);
const OWNER = { id: "owner-1", role: "owner" as const, name: "Johnny Owner" };
const PM = { id: "pm-1", role: "project_manager" as const, name: "Pat PM" };
const PAINTER = { id: "painter-1", role: "painter" as const, name: "Niko Painter" };
const project = (extra: Record<string, unknown> = {}) => ({ id: PROJECT, number: 3018, name: "[TEST DATA] Kim Lee – Interior repaint", status: "scheduled", projectManagerId: null, ...extra });
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const WEBP = new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP"), 0]);

const sets = (table: string) => h.fake.find("update", table).map((u) => u.args.set?.[0] as Record<string, unknown>);
const inserts = (table: string) => h.fake.find("insert", table).map((u) => u.args.values?.[0] as Record<string, unknown>);

beforeEach(() => {
  h.fake.reset();
  h.audits = [];
  h.collapsed = [];
  h.notified = [];
  h.rows = { "select:projects": [project()] };
  h.fake.otherwise((call) => {
    const r = h.rows[`${call.op}:${call.table}`];
    return typeof r === "function" ? r(call) : (r ?? []);
  });
});

describe("who can open a job's chat", () => {
  it("the owner is always in it", async () => {
    expect(await chat.channelAccess(OWNER, PROJECT)).toMatchObject({ member: true, canManage: true, project: { number: 3018, title: "[TEST DATA] Kim Lee – Interior repaint" } });
  });

  it("other office staff can read and post without being told about every message", async () => {
    expect(await chat.channelAccess(PM, PROJECT)).toMatchObject({ member: false });
    h.rows["select:projects"] = [project({ projectManagerId: "pm-1" })];
    expect(await chat.channelAccess(PM, PROJECT)).toMatchObject({ member: true });
  });

  it("tells the job's current project manager about new messages", async () => {
    const told = () => new PgDialect().sqlToQuery(h.fake.find("select", "user").at(-1)!.args.where[0] as SQL).params;
    await chat.channelMemberIds(PROJECT);
    expect(told()).not.toContain("pm-1");
    h.rows["select:projects"] = [project({ projectManagerId: "pm-1" })];
    await chat.channelMemberIds(PROJECT);
    expect(told()).toContain("pm-1");
  });

  it("a painter only once booked on the job or added by hand, and never a cancelled one", async () => {
    expect(await chat.channelAccess(PAINTER, PROJECT)).toBeNull();
    h.rows["select:schedule_entries"] = [{ projectId: PROJECT }];
    expect(await chat.channelAccess(PAINTER, PROJECT)).toMatchObject({ member: true, canManage: false });
    h.rows["select:schedule_entries"] = [];
    h.rows["select:job_channel_members"] = [{ projectId: PROJECT }];
    expect(await chat.channelAccess(PAINTER, PROJECT)).toMatchObject({ member: true });
    h.rows["select:projects"] = [project({ status: "cancelled" })];
    expect(await chat.channelAccess(PAINTER, PROJECT)).toBeNull();
    expect(await chat.channelAccess(PAINTER, "nope")).toBeNull();
  });
});

describe("posting", () => {
  it("needs words or a photo, and only daily updates carry a percentage", () => {
    expect(() => chat.postMessageSchema.parse({ body: "   " })).toThrow(/message or add a photo/);
    expect(chat.postMessageSchema.parse({ body: "", photoIds: [uuid(9)] }).photoIds).toEqual([uuid(9)]);
    expect(() => chat.postMessageSchema.parse({ body: "x", kind: "daily_update", percentComplete: 120 })).toThrow();
    expect(() => chat.postMessageSchema.parse({ body: "x", kind: "system" })).toThrow();
  });

  it("saves the message, attaches the sender's photos and tells everyone else in the chat", async () => {
    h.rows["select:schedule_entries"] = (c) => (c.args.innerJoin ? [{ projectId: PROJECT }] : []);
    h.rows["insert:job_messages"] = [{ id: uuid(50) }];
    h.rows["update:job_photos"] = [{ id: uuid(60) }, { id: uuid(61) }];
    h.rows["select:user"] = [{ id: "owner-1" }, { id: "ops-1" }];
    await chat.postMessage(PAINTER, PROJECT, { body: "Walls done in the kitchen", kind: "daily_update", percentComplete: 60, photoIds: [uuid(60), uuid(61)] });
    expect(inserts("job_messages")[0]).toMatchObject({ projectId: PROJECT, authorId: "painter-1", kind: "daily_update", percentComplete: 60, body: "Walls done in the kitchen" });
    expect(sets("job_photos")[0]).toEqual({ messageId: uuid(50) });
    const notice = h.collapsed[0];
    expect(notice.ids).not.toContain("painter-1");
    expect(notice).toMatchObject({ title: "Daily update on #3018 [TEST DATA] Kim Lee – Interior repaint", body: "Niko · 60% done: Walls done in the kitchen", href: `/chat/${PROJECT}` });
  });

  it("won't attach someone else's photo or one already posted", async () => {
    h.rows["insert:job_messages"] = [{ id: uuid(50) }];
    h.rows["update:job_photos"] = [];
    await expect(chat.postMessage(OWNER, PROJECT, { body: "", photoIds: [uuid(60)] })).rejects.toThrow(/didn't finish uploading/);
  });

  it("refuses people who aren't in the chat", async () => {
    await expect(chat.postMessage(PAINTER, PROJECT, { body: "hi" })).rejects.toThrow(/isn't available/);
  });
});

describe("photos", () => {
  it("are recognised by their bytes, not the browser's say-so", () => {
    expect(chat.sniffImage(JPEG)).toBe("image/jpeg");
    expect(chat.sniffImage(PNG)).toBe("image/png");
    expect(chat.sniffImage(WEBP)).toBe("image/webp");
    expect(chat.sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });

  it("refuse anything that isn't a photo, or too big", async () => {
    await expect(chat.savePhoto(OWNER, PROJECT, { data: new TextEncoder().encode("<html>"), thumb: JPEG, width: 10, height: 10 })).rejects.toThrow(/JPEG, PNG or WebP/);
    await expect(chat.savePhoto(OWNER, PROJECT, { data: new Uint8Array(chat.PHOTO_MAX_BYTES + 1), thumb: JPEG, width: 10, height: 10 })).rejects.toThrow(/too big/);
    h.rows["insert:job_photos"] = [{ id: uuid(70) }];
    expect(await chat.savePhoto(OWNER, PROJECT, { data: JPEG, thumb: JPEG, width: "1600", height: "1200" })).toEqual({ id: uuid(70), width: 1600, height: 1200 });
    expect(inserts("job_photos")[0]).toMatchObject({ contentType: "image/jpeg", uploadedBy: "owner-1", byteSize: JPEG.length });
  });

  it("are only shown inside the chat, and unposted ones only to their sender", async () => {
    h.rows["select:job_photos"] = [{ contentType: "image/jpeg", data: Buffer.from(JPEG), sha256: "abc", messageId: null, uploadedBy: "owner-1" }];
    expect(await chat.photoFile(OWNER, PROJECT, uuid(70), "full")).toMatchObject({ contentType: "image/jpeg" });
    h.rows["select:projects"] = [project({ projectManagerId: "pm-1" })];
    expect(await chat.photoFile(PM, PROJECT, uuid(70), "full")).toBeNull();
    expect(await chat.photoFile(PAINTER, PROJECT, uuid(70), "thumb")).toBeNull();
  });
});

describe("members", () => {
  it("only people added by hand can be removed", async () => {
    h.rows["update:job_channel_members"] = [];
    await expect(chat.removeChannelMember(OWNER, { projectId: PROJECT, userId: "painter-1" })).rejects.toThrow(/role or a booking/);
    h.rows["update:job_channel_members"] = [{ projectId: PROJECT }];
    await chat.removeChannelMember(OWNER, { projectId: PROJECT, userId: "painter-1" });
    expect(h.audits.map((a) => a.action)).toEqual(["chat.member_remove"]);
  });
});

describe("the 4 pm reminder", () => {
  // Oct 26, 2026 (a Monday) at 16:05 in Vancouver (PDT, UTC−7).
  const FOUR_PM = new Date("2026-10-26T23:05:00Z");

  it("knows 4 pm in Vancouver in summer and winter", () => {
    expect(chat.vancouverHour(new Date("2026-07-15T23:30:00Z"))).toBe(16);
    // The winter before British Columbia stayed on UTC−7 (PST, UTC−8)…
    expect(chat.vancouverHour(new Date("2025-12-15T00:30:00Z"))).toBe(16);
    expect(chat.vancouverHour(new Date("2025-12-14T23:30:00Z"))).toBe(15);
    // …and from November 2026, UTC−7 all year.
    expect(chat.vancouverHour(new Date("2026-12-14T23:30:00Z"))).toBe(16);
    expect(chat.vancouverHour(new Date("2026-12-15T00:30:00Z"))).toBe(17);
  });

  it("does nothing outside 4 pm, or a second time the same day", async () => {
    expect(await chat.sendDailyUpdateReminders(new Date("2026-10-26T22:05:00Z"))).toEqual({ ran: false, reminded: 0 });
    h.rows["select:app_settings"] = [{ value: { lastDay: "2026-10-26" } }];
    expect(await chat.sendDailyUpdateReminders(FOUR_PM)).toEqual({ ran: false, reminded: 0 });
    expect(h.notified).toEqual([]);
  });

  it("reminds the lead of each crew on a job today that hasn't posted, and skips crews that have", async () => {
    h.rows["select:schedule_entries"] = [
      { projectId: PROJECT, crewId: "crew-a", worksSaturdays: false, number: 3018, name: "[TEST DATA] Kim Lee – Interior repaint" },
      { projectId: uuid(2), crewId: "crew-b", worksSaturdays: false, number: 3019, name: "[TEST DATA] Lee – Exterior" },
      { projectId: uuid(3), crewId: "crew-c", worksSaturdays: false, number: 3020, name: "[TEST DATA] Ng – Deck" },
    ];
    h.rows["select:crew_members"] = [
      { crewId: "crew-a", userId: "lead-a", isLead: true },
      { crewId: "crew-a", userId: "helper-a", isLead: false },
      { crewId: "crew-b", userId: "b1", isLead: false },
      { crewId: "crew-b", userId: "b2", isLead: false },
      { crewId: "crew-c", userId: "c1", isLead: true },
    ];
    h.rows["select:job_messages"] = [{ projectId: uuid(3), authorId: "c1" }];
    expect(await chat.sendDailyUpdateReminders(FOUR_PM)).toEqual({ ran: true, reminded: 3 });
    expect(h.notified).toEqual([
      { ids: ["lead-a"], title: "Daily update for #3018 [TEST DATA] Kim Lee – Interior repaint", href: `/chat/${PROJECT}?update=1` },
      { ids: ["b1", "b2"], title: "Daily update for #3019 [TEST DATA] Lee – Exterior", href: `/chat/${uuid(2)}?update=1` },
    ]);
    expect(inserts("app_settings")[0]).toMatchObject({ value: { lastDay: "2026-10-26" } });
  });

  it("skips jobs on hold, as well as finished and cancelled ones", async () => {
    await chat.sendDailyUpdateReminders(FOUR_PM);
    const where = new PgDialect().sqlToQuery(h.fake.find("select", "schedule_entries")[0].args.where[0] as SQL);
    expect(where.sql).toMatch(/"projects"\."status" not in \(/);
    expect(where.params).toEqual(expect.arrayContaining(["on_hold", "cancelled", "closed", "complete", "invoiced"]));
    expect(where.params).not.toContain("scheduled");
    expect(where.params).not.toContain("in_progress");
  });

  it("skips crews whose day off it is", async () => {
    const saturday = new Date("2026-10-31T23:05:00Z");
    h.rows["select:schedule_entries"] = [{ projectId: PROJECT, crewId: "crew-a", worksSaturdays: false, number: 3018, name: "x" }];
    h.rows["select:crew_members"] = [{ crewId: "crew-a", userId: "lead-a", isLead: true }];
    expect(await chat.sendDailyUpdateReminders(saturday)).toEqual({ ran: true, reminded: 0 });
  });
});
