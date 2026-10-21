import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeDb,
  sent: [] as { to: string; subject: string; text: string }[],
  emailResult: { status: "logged", provider: "dev-log" } as { status: "sent" | "logged" | "failed"; provider: string; error?: string },
  audits: [] as { action: string }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});
vi.mock("@/lib/email", () => ({
  sendEmail: async (m: { to: string; subject: string; text: string }) => {
    h.sent.push(m);
    return h.emailResult;
  },
}));
vi.mock("./audit", () => ({ audit: async (e: { action: string }) => void h.audits.push(e) }));
vi.mock("./settings", () => ({ getCompany: async () => ({ name: "Grandview Painting Ltd.", phone: "604-555-0199" }), getSetting: async (_k: string, f: unknown) => f }));
vi.mock("./schedule-settings", async () => {
  const { defaultScheduleSettings } = await import("@/lib/schedule/settings-schema");
  return { getScheduleSettings: async () => defaultScheduleSettings(), getHoursPerCrewDay: async () => "8", defaultCapacity: () => ({ crewSize: 3, hoursPerDay: "8" }) };
});

const { chooseVariant, composeStartNotice, markStartConfirmed, noticeTemplateKey, sendStartNotice } = await import("./start-notices");
const { ScheduleError } = await import("./schedule");
const { SCHEDULE_MESSAGE_TEMPLATES } = await import("@/db/seed-schedule");

const P = "00000000-0000-4000-8000-000000000001";
const SENDER = { id: "user-pm", name: "[TEST DATA] Pat PM" };
const ALL_VARS = "{{first_name}}|{{project_name}}|{{start_week}}|{{start_date}}|{{end_date}}|{{duration}}|{{previous_start_date}}|{{company_phone}}|{{sender_name}}";

interface Setup {
  jobType?: string | null;
  projectTypes?: string[];
  contactEmail?: string | null;
  customerEmail?: string | null;
  scheduling?: { confirmation: string; communicatedStart: string | null } | null;
  work?: { startDate: string; endDate: string; worksSaturdays: boolean | null }[];
  recentActivity?: boolean;
  /** sendStartNotice locks the project first; composeStartNotice doesn't. */
  lock?: boolean;
}

function setup(s: Setup = {}) {
  h.fake.queue({
    "select:projects": [
      ...(s.lock === false ? [] : [[{ id: P }]]),
      [
        {
          id: P, name: "[TEST DATA] Kim Lee – Exterior repaint", status: "scheduled", customerId: "cust-1", opportunityId: "opp-1", estimateTitle: "Exterior repaint",
          jobType: s.jobType === undefined ? "exterior" : s.jobType, customerName: "[TEST DATA] Kim Lee", customerEmail: s.customerEmail ?? null, projectTypes: s.projectTypes ?? ["Exterior"],
        },
      ],
    ],
    "select:contacts": [[{ firstName: "Kim", email: s.contactEmail === undefined ? "kim-lee@example.com" : s.contactEmail }]],
    "select:project_scheduling": [s.scheduling ? [s.scheduling] : []],
    "select:schedule_entries": [s.work ?? [{ startDate: "2026-10-26", endDate: "2026-10-30", worksSaturdays: false }]],
    "select:message_templates": [[{ subject: "Subject {{start_date}}", body: ALL_VARS }]],
    "select:activities": [s.recentActivity ? [{ id: "act-1" }] : []],
    "insert:outbound_messages": [[{ id: "out-1" }]],
  });
}

const send = (extra: object = {}) => ({
  projectId: P,
  kind: "start_date",
  variant: "exterior",
  subject: "Your painting project starts Monday, October 26",
  body: "Hi Kim, see you Monday. [edited by PM]",
  expectedStart: "2026-10-26",
  ...extra,
});

beforeEach(() => {
  h.fake.reset();
  h.sent = [];
  h.audits = [];
  h.emailResult = { status: "logged", provider: "dev-log" };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T19:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("choosing the template", () => {
  it("picks exterior wording from the job type or the lead's project types", () => {
    expect(chooseVariant(undefined, "exterior", [], ["exterior"])).toBe("exterior");
    expect(chooseVariant(undefined, "interior", ["Deck / Fence Staining"], ["exterior"])).toBe("exterior");
    expect(chooseVariant(undefined, "interior", ["Interior"], ["exterior"])).toBe("interior");
    expect(chooseVariant("interior", "exterior", [], ["exterior"])).toBe("interior");
  });

  it("uses the updated-date template once the customer was told another day", () => {
    expect(noticeTemplateKey("start_week", "exterior", null, "2026-10-26")).toBe("project_start_week_exterior");
    expect(noticeTemplateKey("start_date", "exterior", "2026-10-26", "2026-10-26")).toBe("project_start_date");
    expect(noticeTemplateKey("start_date", "interior", "2026-10-26", "2026-10-28")).toBe("project_start_date_changed");
  });

  it("matches the seeded template keys", () => {
    expect(SCHEDULE_MESSAGE_TEMPLATES.map((t) => t.key)).toEqual(["project_start_week_interior", "project_start_week_exterior", "project_start_date", "project_start_date_changed"]);
  });
});

describe("composeStartNotice", () => {
  it("renders the variables for an exterior start-week notice", async () => {
    setup({ lock: false });
    const preview = await compose("start_week");
    expect(preview.templateKey).toBe("project_start_week_exterior");
    expect(preview.variant).toBe("exterior");
    expect(preview.to).toBe("kim-lee@example.com");
    expect(preview.body).toBe("Kim|Exterior repaint|Monday, October 26|Monday, October 26|Friday, October 30|5 working days||604-555-0199|[TEST DATA] Pat PM");
    expect(preview).toMatchObject({ startDate: "2026-10-26", endDate: "2026-10-30", weekOf: "2026-10-26", workingDays: 5, problems: [], blocked: false, pastStart: false });
  });

  it("uses the changed template and the previous date when the start moved", async () => {
    setup({ lock: false, scheduling: { confirmation: "date_confirmed", communicatedStart: "2026-10-19" } });
    const preview = await compose("start_date");
    expect(preview.templateKey).toBe("project_start_date_changed");
    expect(preview.body.split("|")[6]).toBe("Monday, October 19");
  });

  it("counts working days once when two crews work the same days", async () => {
    setup({ lock: false, work: [{ startDate: "2026-10-26", endDate: "2026-10-28", worksSaturdays: false }, { startDate: "2026-10-26", endDate: "2026-10-28", worksSaturdays: null }] });
    expect((await compose("start_date")).workingDays).toBe(3);
  });

  it("reports blocking problems: no email, no booking", async () => {
    setup({ lock: false, contactEmail: null, customerEmail: null, work: [] });
    const preview = await compose("start_date");
    expect(preview.to).toBeNull();
    expect(preview.blocked).toBe(true);
    expect(preview.problems).toEqual(["No email address on file. Add an email to the customer first.", "Not on the schedule yet. Book the work first."]);
  });
});

const compose = (kind: "start_week" | "start_date") => composeStartNotice(P, kind, { name: SENDER.name });

describe("sendStartNotice", () => {
  it("sends the user's text to the server-derived address and records the stage", async () => {
    setup();
    const r = await sendStartNotice({ ...send(), to: "attacker@example.com" }, SENDER);
    expect(r).toEqual({ status: "logged" });
    expect(h.sent).toEqual([{ to: "kim-lee@example.com", subject: "Your painting project starts Monday, October 26", text: "Hi Kim, see you Monday. [edited by PM]", replyTo: undefined }]);
    expect(h.fake.find("insert", "outbound_messages")[0].args.values[0]).toMatchObject({ toAddress: "kim-lee@example.com", status: "logged", templateKey: "project_start_date", customerId: "cust-1", sentBy: "user-pm" });
    expect(h.fake.find("insert", "project_scheduling")[0].args.values[0]).toMatchObject({ projectId: P, confirmation: "date_sent", noticeVariant: "exterior", communicatedStart: "2026-10-26", communicatedEnd: "2026-10-30" });
    const activity = h.fake.find("insert", "activities")[0].args.values[0] as { body: string; meta: Record<string, unknown> };
    expect(activity.body).toBe("Start date email sent to kim-lee@example.com – Mon, Oct 26 (development – not actually delivered)");
    expect(activity.meta).toEqual({ projectId: P, notice: "start_date", startDate: "2026-10-26", outboundMessageId: "out-1" });
    expect(h.audits.map((a) => a.action)).toEqual(["schedule.notice.send"]);
  });

  it("refuses when the schedule changed since the preview", async () => {
    setup();
    const err = await sendStartNotice(send({ expectedStart: "2026-10-27" }), SENDER).catch((e) => e);
    expect(err).toBeInstanceOf(ScheduleError);
    expect(err.message).toMatch(/schedule changed/);
    expect(h.sent).toEqual([]);
  });

  it("refuses to send without an email address", async () => {
    setup({ contactEmail: null });
    await expect(sendStartNotice(send(), SENDER)).rejects.toThrow(/No email address/);
    expect(h.sent).toEqual([]);
  });

  it("refuses the same notice twice within a minute", async () => {
    setup({ recentActivity: true });
    await expect(sendStartNotice(send(), SENDER)).rejects.toThrow("That email was just sent.");
    expect(h.sent).toEqual([]);
  });

  it("needs Send anyway for a start date in the past", async () => {
    setup({ work: [{ startDate: "2026-10-19", endDate: "2026-10-23", worksSaturdays: false }] });
    await expect(sendStartNotice(send({ expectedStart: "2026-10-19" }), SENDER)).rejects.toThrow(/Send anyway/);
    setup({ work: [{ startDate: "2026-10-19", endDate: "2026-10-23", worksSaturdays: false }] });
    await expect(sendStartNotice(send({ expectedStart: "2026-10-19", sendAnyway: true }), SENDER)).resolves.toEqual({ status: "logged" });
  });

  it("logs a failed delivery and changes nothing else", async () => {
    setup();
    h.emailResult = { status: "failed", provider: "resend", error: "HTTP 500" };
    await expect(sendStartNotice(send(), SENDER)).rejects.toThrow("Email failed: HTTP 500");
    expect(h.fake.find("insert", "outbound_messages")[0].args.values[0]).toMatchObject({ status: "failed", sentAt: null });
    expect(h.fake.find("insert", "project_scheduling")).toEqual([]);
    expect(h.fake.find("insert", "activities")).toEqual([]);
  });

  it("refuses a subject with a line break before doing anything", async () => {
    await expect(sendStartNotice(send({ subject: "Hi\nBcc: x@example.com" }), SENDER)).rejects.toThrow();
    expect(h.fake.calls).toEqual([]);
  });
});

describe("markStartConfirmed", () => {
  it("records a phone confirmation and the dates the customer agreed to", async () => {
    h.fake.queue({
      "select:projects": [[{ id: P, customerId: "cust-1", opportunityId: "opp-1" }]],
      "select:project_scheduling": [[]],
      "select:schedule_entries": [[{ first: "2026-10-26", last: "2026-10-30" }]],
    });
    await markStartConfirmed({ projectId: P, kind: "start_date", via: "phone" }, SENDER);
    expect(h.fake.find("insert", "project_scheduling")[0].args.values[0]).toMatchObject({
      confirmation: "date_confirmed",
      confirmedVia: "phone",
      communicatedStart: "2026-10-26",
      communicatedEnd: "2026-10-30",
    });
    expect(h.fake.find("insert", "activities")[0].args.values[0]).toMatchObject({ body: "Customer confirmed the start date (phone)" });
    expect(h.audits.map((a) => a.action)).toEqual(["schedule.notice.confirm"]);
  });
});
