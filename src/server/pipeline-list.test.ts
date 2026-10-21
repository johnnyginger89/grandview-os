import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));

const { projectRow } = await import("./pipeline-list");
type Raw = Parameters<typeof projectRow>[0];

const raw: Raw = {
  id: "00000000-0000-4000-8000-000000000001",
  number: 1042,
  title: "[TEST DATA] Ann Example – Interior – Surrey",
  customerId: "00000000-0000-4000-8000-000000000002",
  customerName: "[TEST DATA] Ann Example",
  customerType: "residential",
  customerEmail: "customer@example.com",
  customerPhone: "604-555-0101",
  stageId: "00000000-0000-4000-8000-000000000003",
  stageKey: "contacted",
  stageKind: "open",
  stageChangedAt: new Date("2026-10-20T19:00:00.000Z"),
  createdAt: new Date("2026-10-01T19:00:00.000Z"),
  closedAt: null,
  estimateVisitAt: new Date("2026-10-23T17:00:00.000Z"),
  firstViewedAt: null,
  nextFollowUpAt: null,
  lastContactedAt: null,
  lastActivityAt: new Date("2026-10-21T01:02:03.000Z"),
  projectTypes: ["Interior"],
  source: "Referral",
  channel: "phone",
  timeline: null,
  lostReason: null,
  contactFirst: "Ann",
  contactLast: "Example",
  contactEmail: "ann@example.com",
  contactPhone: "604-555-0100",
  street: "1 Test St",
  unit: null,
  city: "Surrey",
  propertyType: "detached",
  estimatorId: "u1",
  estimatorName: "Estimator",
  estimatedValue: "9000.00",
};
const money = { opportunityId: raw.id, id: "00000000-0000-4000-8000-000000000009", status: "sent", totalPrice: "12345.67" };

describe("projectRow", () => {
  it("drops every money field without estimates.read, even when the raw row has them", () => {
    const r = projectRow(raw, money, false);
    expect([r.estimatedValue, r.estimateTotal, r.estimateStatus, r.estimateId]).toEqual([null, null, null, null]);
    expect(JSON.stringify(r)).not.toMatch(/12345|9000/);
  });

  it("keeps decimal strings exactly with money access", () => {
    const r = projectRow(raw, money, true);
    expect(r.estimateTotal).toBe("12345.67");
    expect(r.estimatedValue).toBe("9000.00");
    expect(r.estimateStatus).toBe("sent");
    expect(r.estimateId).toBe(money.id);
  });

  it("uses the primary contact's email and phone, falling back to the customer's", () => {
    expect(projectRow(raw, undefined, false)).toMatchObject({ email: "ann@example.com", phone: "604-555-0100" });
    expect(projectRow({ ...raw, contactEmail: null, contactPhone: "" }, undefined, false)).toMatchObject({ email: "customer@example.com", phone: "604-555-0101" });
  });

  it("turns dates into ISO strings", () => {
    const r = projectRow(raw, undefined, false);
    expect(r.stageChangedAt).toBe("2026-10-20T19:00:00.000Z");
    expect(r.estimateVisitAt).toBe("2026-10-23T17:00:00.000Z");
    expect(r.lastActivityAt).toBe("2026-10-21T01:02:03.000Z");
    expect(r.closedAt).toBeNull();
  });

  it("contactName is null when first and last names are empty", () => {
    expect(projectRow(raw, undefined, false).contactName).toBe("Ann Example");
    expect(projectRow({ ...raw, contactFirst: "", contactLast: "" }, undefined, false).contactName).toBeNull();
    expect(projectRow({ ...raw, contactFirst: null, contactLast: null }, undefined, false).contactName).toBeNull();
  });

  it("never carries cost, margin or markup keys", () => {
    expect(Object.keys(projectRow(raw, money, true)).join(" ")).not.toMatch(/cost|margin|markup/i);
  });
});
