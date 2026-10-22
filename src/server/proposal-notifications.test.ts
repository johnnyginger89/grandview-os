import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({ fake: null as unknown as FakeDb }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => void task() }));
vi.mock("web-push", () => ({ default: { generateVAPIDKeys: () => ({ publicKey: "x".repeat(40), privateKey: "y".repeat(40) }), sendNotification: async () => {} } }));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});

const { notifyProposalEvent } = await import("./notifications");

const PROPOSAL = "00000000-0000-4000-8000-000000000001";
const ESTIMATE = "00000000-0000-4000-8000-000000000002";
const PROJECT = "00000000-0000-4000-8000-000000000003";

const proposalRow = (extra: Record<string, unknown> = {}) => ({
  estimateId: ESTIMATE, number: 1042, title: "Interior repaint", estimatorId: "est-1", createdBy: "est-1", customer: "[TEST DATA] Kim Lee",
  acceptedTotals: { price: "3000.00" }, acceptedName: "Kim Lee", acceptedMethod: "online", projectId: PROJECT, ...extra,
});
const OFFICE = [{ id: "owner-1", role: "owner" }, { id: "admin-1", role: "admin" }, { id: "ops-1", role: "operations_manager" }];
const ESTIMATOR = [{ id: "est-1", role: "estimator" }];

type Sent = { userId: string; title: string; body: string | null; href: string | null };
const sent = () => h.fake.find("insert", "notifications").flatMap((c) => c.args.values[0] as Sent[]);
const to = (userId: string) => sent().find((n) => n.userId === userId);

beforeEach(() => h.fake.reset());

describe("an accepted proposal", () => {
  it("opens the new job for people who can open jobs, and the estimate for everyone else", async () => {
    h.fake.queue({ "select:proposals": [[proposalRow()]], "select:user": [OFFICE, ESTIMATOR] });
    await notifyProposalEvent("accepted", PROPOSAL);
    expect(sent()).toHaveLength(4);
    expect(to("owner-1")).toMatchObject({ href: `/projects/${PROJECT}`, body: "Estimate #1042 (Interior repaint) · $3,000.00 + GST. The job has been created." });
    expect(to("ops-1")).toMatchObject({ href: `/projects/${PROJECT}`, body: expect.stringContaining("$3,000.00") });
    // Admins can open jobs but never see company money.
    expect(to("admin-1")).toMatchObject({ href: `/projects/${PROJECT}`, body: "Estimate #1042 (Interior repaint). The job has been created." });
    // Estimators can't open jobs: their link stays on the estimate.
    expect(to("est-1")).toMatchObject({ href: `/estimates/${ESTIMATE}`, body: "Estimate #1042 (Interior repaint). The job has been created." });
    expect(new Set(sent().map((n) => n.title))).toEqual(new Set(["[TEST DATA] Kim Lee accepted their proposal"]));
  });

  it("falls back to the estimate when no job is found", async () => {
    h.fake.queue({ "select:proposals": [[proposalRow({ projectId: null })]], "select:user": [OFFICE, ESTIMATOR] });
    await notifyProposalEvent("accepted", PROPOSAL);
    expect(sent().map((n) => n.href)).toEqual([`/estimates/${ESTIMATE}`, `/estimates/${ESTIMATE}`, `/estimates/${ESTIMATE}`, `/estimates/${ESTIMATE}`]);
  });
});

describe("other proposal events", () => {
  it("still open the estimate", async () => {
    h.fake.queue({ "select:proposals": [[proposalRow()]], "select:user": [OFFICE, ESTIMATOR] });
    await notifyProposalEvent("viewed", PROPOSAL);
    expect(sent()).toHaveLength(4);
    expect(new Set(sent().map((n) => n.href))).toEqual(new Set([`/estimates/${ESTIMATE}`]));
  });
});
