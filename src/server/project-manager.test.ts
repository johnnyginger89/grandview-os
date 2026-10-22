import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeDb,
  audits: [] as { action: string; entityId?: string | null; before?: unknown; after?: unknown }[],
  chat: [] as { projectId: string; body: string }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});
vi.mock("./audit", () => ({ audit: async (e: (typeof h.audits)[number]) => void h.audits.push(e) }));
vi.mock("./job-chat", () => ({ postSystemMessage: async (projectId: string, body: string) => void h.chat.push({ projectId, body }) }));

const { projectManagerOptions, ProjectManagerError, setProjectManager } = await import("./project-manager");

const PROJECT = "00000000-0000-4000-8000-000000000001";
const OWNER = { id: "owner-1" };
const person = (id: string, role: string, extra: Record<string, unknown> = {}) => ({ id, name: `${id} (Dev)`, role, active: true, ...extra });

beforeEach(() => {
  h.fake.reset();
  h.audits = [];
  h.chat = [];
});

describe("projectManagerOptions", () => {
  it("lists active people who can manage jobs, and keeps a current one who no longer can", async () => {
    const everyone = [
      person("admin-1", "admin"),
      person("est-1", "estimator"),
      person("ops-1", "operations_manager"),
      person("painter-1", "painter"),
      person("pm-1", "project_manager"),
      person("pm-2", "project_manager", { active: false }),
    ];
    h.fake.queue({ "select:user": [everyone, everyone] });
    expect((await projectManagerOptions(null)).map((o) => o.id)).toEqual(["admin-1", "ops-1", "pm-1"]);
    expect(await projectManagerOptions("pm-2")).toContainEqual({ id: "pm-2", name: "pm-2 (Dev) (no longer manages jobs)" });
  });
});

describe("setProjectManager", () => {
  it("sets someone who can manage jobs, with an audit entry and a note in the job's chat", async () => {
    h.fake.queue({ "select:projects": [[{ id: PROJECT, current: null }]], "select:user": [[person("pm-1", "project_manager")]] });
    expect(await setProjectManager({ projectId: PROJECT, userId: "pm-1" }, OWNER)).toEqual({ projectId: PROJECT, changed: true });
    expect(h.fake.find("update", "projects")[0].args.set[0]).toMatchObject({ projectManagerId: "pm-1" });
    expect(h.audits).toEqual([
      { actorId: "owner-1", action: "project.project_manager", entityType: "project", entityId: PROJECT, before: { projectManagerId: null }, after: { projectManagerId: "pm-1" } },
    ]);
    expect(h.chat).toEqual([{ projectId: PROJECT, body: "pm-1 (Dev) is the project manager now." }]);
  });

  it("clears it", async () => {
    h.fake.queue({ "select:projects": [[{ id: PROJECT, current: "pm-1" }]] });
    expect(await setProjectManager({ projectId: PROJECT, userId: null }, OWNER)).toEqual({ projectId: PROJECT, changed: true });
    expect(h.fake.find("update", "projects")[0].args.set[0]).toMatchObject({ projectManagerId: null });
    expect(h.audits[0]).toMatchObject({ before: { projectManagerId: "pm-1" }, after: { projectManagerId: null } });
    expect(h.chat[0].body).toBe("This job has no project manager now.");
  });

  it("refuses people who can't manage jobs, or no longer have a login", async () => {
    for (const who of [person("est-1", "estimator"), person("painter-1", "painter"), person("pm-2", "project_manager", { active: false })]) {
      h.fake.queue({ "select:projects": [[{ id: PROJECT, current: null }]], "select:user": [[who]] });
      await expect(setProjectManager({ projectId: PROJECT, userId: who.id }, OWNER)).rejects.toBeInstanceOf(ProjectManagerError);
    }
    h.fake.queue({ "select:projects": [[{ id: PROJECT, current: null }]], "select:user": [[]] });
    await expect(setProjectManager({ projectId: PROJECT, userId: "gone" }, OWNER)).rejects.toThrow("That person can't manage jobs. Pick someone else.");
    expect(h.fake.find("update", "projects")).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it("changes nothing when it's already them, and refuses a missing job or a bad id", async () => {
    h.fake.queue({ "select:projects": [[{ id: PROJECT, current: "pm-1" }]], "select:user": [[person("pm-1", "project_manager")]] });
    expect(await setProjectManager({ projectId: PROJECT, userId: "pm-1" }, OWNER)).toEqual({ projectId: PROJECT, changed: false });
    expect(h.fake.find("update", "projects")).toEqual([]);
    expect(h.audits).toEqual([]);
    expect(h.chat).toEqual([]);
    await expect(setProjectManager({ projectId: PROJECT, userId: "pm-1" }, OWNER)).rejects.toThrow("This job no longer exists.");
    await expect(setProjectManager({ projectId: "not-a-job", userId: "pm-1" }, OWNER)).rejects.toThrow();
  });
});
