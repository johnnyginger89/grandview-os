import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeDb,
  customer: null as unknown,
  contacts: [] as unknown[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  h.fake.db.query = {
    estimates: { findFirst: async () => ({ id: "est-1", customerId: "cust-1", title: "Exterior repaint" }) },
    customers: { findFirst: async () => h.customer },
    contacts: { findMany: async () => h.contacts },
    messageTemplates: { findFirst: async () => null },
  };
  return { db: h.fake.db };
});
vi.mock("./settings", () => ({ getCompany: async () => ({ name: "Grandview Painting Ltd.", phone: "604-555-0199" }), getProposalTemplate: async () => ({}) }));

const { followUpDraft } = await import("./proposals");

const SENDER = { name: "[TEST DATA] Sam Sales" };
const kim = (extra: Record<string, unknown> = {}) => ({ id: "c-1", firstName: "Kim", email: "kim.lee@example.com", isPrimary: true, ...extra });

beforeEach(() => {
  h.fake.reset();
  h.customer = { id: "cust-1", displayName: "[TEST DATA] Kim Lee", email: "kim.lee@example.com" };
  h.contacts = [kim(), { id: "c-2", firstName: "Lee", email: "lee@example.com", isPrimary: false }];
});

const proposal = (sentTo: string | null) => h.fake.queue({ "select:proposals": [[{ id: "p-1", token: "t", status: "sent", sentTo, estimateId: "est-1" }]] });

describe("followUpDraft", () => {
  it("goes to the corrected email when the one the proposal went to is no longer on file", async () => {
    proposal("kim@example.con");
    expect((await followUpDraft("p-1", SENDER)).to).toBe("kim.lee@example.com");
  });

  it("goes back to the address the proposal went to while it is still on file", async () => {
    proposal("lee@example.com");
    expect((await followUpDraft("p-1", SENDER)).to).toBe("lee@example.com");
  });

  it("uses the primary contact's email when the proposal wasn't emailed", async () => {
    proposal(null);
    const draft = await followUpDraft("p-1", SENDER);
    expect(draft.to).toBe("kim.lee@example.com");
    expect(draft.body).toContain("Kim");
  });
});
