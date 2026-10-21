import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCall, FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeDb,
  audits: [] as { action: string; after?: unknown }[],
  rows: {} as Record<string, unknown[] | ((c: FakeCall) => unknown[])>,
  requests: [] as { url: string; method: string; auth: string | null; body: unknown }[],
  respond: (() => ({ status: 200, body: { data: [] } })) as (url: string, method: string) => { status: number; body: unknown },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});
vi.mock("../audit", () => ({ audit: async (e: { action: string }) => void h.audits.push(e) }));

process.env.BETTER_AUTH_SECRET = "test-secret-that-is-long-enough-1234";
const cc = await import("./companycam");
const { seal } = await import("@/lib/crypto/secret-box");

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ESTIMATE = uuid(1);
const JOB = uuid(2);
const TOKEN = "cc_pat_test_token_123456";
const ACTOR = { id: "owner-1" };
const connected = () => [{ value: { token: seal(TOKEN), connectedBy: "owner-1", connectedAt: "2026-10-21T20:00:00.000Z", companyName: "Grandview Painting" } }];

beforeEach(() => {
  h.fake.reset();
  h.audits = [];
  h.requests = [];
  h.rows = {};
  h.respond = () => ({ status: 200, body: { data: [] } });
  h.fake.otherwise((call) => {
    const r = h.rows[`${call.op}:${call.table}`];
    return typeof r === "function" ? r(call) : (r ?? []);
  });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    h.requests.push({ url, method: init.method ?? "GET", auth: headers.get("authorization"), body: init.body ? JSON.parse(String(init.body)) : null });
    const r = h.respond(url, init.method ?? "GET");
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("connecting", () => {
  it("checks the token with CompanyCam and keeps it encrypted", async () => {
    h.respond = (url) => (url.endsWith("/companies/current") ? { status: 200, body: { data: { name: "Grandview Painting" } } } : { status: 200, body: { data: { message: "ok" } } });
    await cc.connectCompanyCam(` ${TOKEN} `, ACTOR);
    expect(h.requests[0]).toMatchObject({ url: "https://api.companycam.com/public_api/v1/access_tokens/verify", method: "POST", auth: `Bearer ${TOKEN}` });
    const saved = h.fake.find("insert", "app_settings")[0].args.values?.[0] as { key: string; value: { companyName: string } };
    expect(saved.key).toBe("integration_companycam");
    expect(saved.value.companyName).toBe("Grandview Painting");
    expect(JSON.stringify(saved)).not.toContain(TOKEN);
    expect(JSON.stringify(h.audits)).not.toContain(TOKEN);
  });

  it("explains a rejected token, and stores nothing", async () => {
    h.respond = () => ({ status: 401, body: { data: {}, errors: [{ code: "invalid_token", message: "Invalid" }], meta: {} } });
    await expect(cc.connectCompanyCam(TOKEN, ACTOR)).rejects.toThrow(/didn't accept the access token/);
    expect(h.fake.find("insert", "app_settings")).toEqual([]);
  });

  it("reports a token that can't be read any more", async () => {
    h.rows["select:app_settings"] = [{ value: { token: { v: 1, iv: "AAAA", tag: "AAAA", data: "AAAA" }, connectedBy: null, connectedAt: "2026-10-21T20:00:00.000Z", companyName: null } }];
    expect(await cc.companyCamStatus()).toMatchObject({ connected: false, unreadable: true });
  });
});

describe("projects", () => {
  beforeEach(() => {
    h.rows["select:app_settings"] = connected();
  });

  it("searches by address and leaves out deleted projects", async () => {
    h.respond = () => ({
      status: 200,
      body: {
        data: [
          { id: "101", name: "Kim Lee", address: { street_address_1: "1 Example St", city: "Surrey" }, project_url: "https://app.companycam.com/projects/101", status: "active" },
          { id: "102", name: "Old", address: null, status: "deleted" },
        ],
      },
    });
    expect(await cc.searchCompanyCamProjects(" 1 Example St ")).toEqual([{ id: "101", name: "Kim Lee", address: "1 Example St, Surrey", url: "https://app.companycam.com/projects/101" }]);
    expect(h.requests[0].url).toBe("https://api.companycam.com/public_api/v1/projects/search?query=1+Example+St&limit=10");
    expect(h.requests[0].auth).toBe(`Bearer ${TOKEN}`);
  });

  it("links a job after checking the project exists", async () => {
    h.respond = () => ({ status: 200, body: { data: { id: "101", name: "Kim Lee", project_url: "https://app.companycam.com/projects/101" } } });
    await cc.linkCompanyCamProject({ entityType: "project", entityId: JOB, companyCamProjectId: "101" }, ACTOR);
    expect(h.requests[0].url).toMatch(/\/projects\/101$/);
    expect(h.fake.find("insert", "integration_links")[0].args.values?.[0]).toMatchObject({ provider: "companycam", entityType: "project", entityId: JOB, externalId: "101", externalName: "Kim Lee" });
    await expect(cc.linkCompanyCamProject({ entityType: "project", entityId: JOB, companyCamProjectId: "../../users" }, ACTOR)).rejects.toThrow();
  });

  it("creates a CompanyCam project from the job's customer and address", async () => {
    h.rows["select:projects"] = [{ customerId: uuid(30), propertyId: uuid(31), title: "Kim Lee – Interior repaint" }];
    h.rows["select:customers"] = [{ name: "Kim Lee", email: "kim@example.com", phone: "604-555-0100" }];
    h.rows["select:contacts"] = [];
    h.rows["select:properties"] = [{ street: "1 Example St", unit: null, city: "Surrey", province: "BC", postalCode: "V3S 0A1" }];
    h.respond = () => ({ status: 201, body: { data: { id: "103", name: "Kim Lee – Interior repaint", project_url: "https://app.companycam.com/projects/103" } } });
    const link = await cc.createCompanyCamProject({ entityType: "project", entityId: JOB }, ACTOR);
    expect(h.requests[0]).toMatchObject({ method: "POST", url: "https://api.companycam.com/public_api/v1/projects" });
    expect(h.requests[0].body).toEqual({
      project: {
        name: "Kim Lee – Interior repaint", street_address_1: "1 Example St", city: "Surrey", state: "BC", postal_code: "V3S 0A1", country: "CA",
        primary_contact: { name: "Kim Lee", email: "kim@example.com", phone_number: "604-555-0100" },
      },
    });
    expect(link).toMatchObject({ projectId: "103", url: "https://app.companycam.com/projects/103" });
  });

  it("won't create a project without an address", async () => {
    h.rows["select:projects"] = [{ customerId: uuid(30), propertyId: null, title: "Repaint" }];
    h.rows["select:customers"] = [{ name: "Kim Lee", email: null, phone: null }];
    await expect(cc.createCompanyCamProject({ entityType: "project", entityId: JOB }, ACTOR)).rejects.toThrow(/street address/);
    expect(h.requests).toEqual([]);
  });

  it("gives a job its estimate's CompanyCam project when it has none of its own", async () => {
    h.rows["select:integration_links"] = (call) => (JSON.stringify(call.args.where).includes(ESTIMATE) ? [{ externalId: "101", externalName: "Kim", externalUrl: null }] : []);
    h.rows["select:projects"] = [{ estimateId: ESTIMATE }];
    let n = 0;
    h.rows["select:integration_links"] = () => (n++ === 0 ? [] : [{ externalId: "101", externalName: "Kim", externalUrl: null }]);
    expect(await cc.companyCamLinkFor("project", JOB)).toMatchObject({ entityType: "estimate", entityId: ESTIMATE, projectId: "101" });
  });
});

describe("photos", () => {
  beforeEach(() => {
    h.rows["select:app_settings"] = connected();
  });

  it("lists the project's photos through our own signed image links", async () => {
    h.respond = () => ({
      status: 200,
      body: {
        data: [
          {
            id: "9", status: "active", creator_name: "Niko", captured_at: "2026-10-20T18:00:00Z", photo_url: "https://app.companycam.com/photos/9",
            description: { plain_text_content: "Back wall" },
            uris: [{ type: "original", uri: "https://img.companycam.com/o.jpg", url: "https://img.companycam.com/o.jpg" }, { type: "thumbnail", uri: "https://img.companycam.com/t.jpg", url: "https://img.companycam.com/t.jpg" }],
          },
          { id: "10", status: "deleted", uris: [{ type: "thumbnail", uri: "https://img.companycam.com/x.jpg", url: "x" }] },
        ],
      },
    });
    const photos = await cc.companyCamPhotos("101", 12);
    expect(h.requests[0].url).toBe("https://api.companycam.com/public_api/v1/photos?project_ids%5B%5D=101&limit=12");
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({ id: "9", by: "Niko", description: "Back wall", capturedAt: "2026-10-20T18:00:00.000Z", url: "https://app.companycam.com/photos/9" });
    const thumb = new URL(photos[0].thumb, "https://os.example.com");
    expect(thumb.pathname).toBe("/api/integrations/companycam/image");
    expect(cc.verifyImageLink(Object.fromEntries(thumb.searchParams))).toBe("https://img.companycam.com/t.jpg");
  });

  it("a card never breaks the page when CompanyCam is down", async () => {
    h.rows["select:integration_links"] = [{ externalId: "101", externalName: "Kim", externalUrl: null }];
    h.respond = () => ({ status: 500, body: {} });
    expect(await cc.companyCamPanel("estimate", ESTIMATE)).toMatchObject({ link: { projectId: "101" }, photos: [], error: expect.stringMatching(/CompanyCam had a problem/) });
  });
});

describe("signed image links", () => {
  it("only open what this server signed, for a limited time, over https", () => {
    const now = Date.UTC(2026, 9, 21);
    const params = (link: string) => Object.fromEntries(new URL(link, "https://os.example.com").searchParams);
    const ok = params(cc.imageLink("https://img.companycam.com/t.jpg", now, 60));
    expect(cc.verifyImageLink(ok, now)).toBe("https://img.companycam.com/t.jpg");
    expect(cc.verifyImageLink(ok, now + 61_000)).toBeNull();
    expect(cc.verifyImageLink({ ...ok, u: Buffer.from("https://169.254.169.254/latest").toString("base64url") }, now)).toBeNull();
    expect(cc.verifyImageLink({ ...ok, s: ok.s.replace(/.$/, ok.s.endsWith("A") ? "B" : "A") }, now)).toBeNull();
    const http = params(cc.imageLink("http://img.companycam.com/t.jpg", now, 60));
    expect(cc.verifyImageLink(http, now)).toBeNull();
  });
});
