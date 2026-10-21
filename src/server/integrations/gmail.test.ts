import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCall, FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeDb,
  rows: {} as Record<string, unknown[] | ((c: FakeCall) => unknown[])>,
  requests: [] as { url: string; method: string; body: string | null }[],
  respond: (() => ({ status: 200, body: {} })) as (url: string, method: string) => { status: number; body: unknown },
  notices: [] as { to: string[]; notice: { title: string; href: string } }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});
vi.mock("../audit", () => ({ audit: async () => undefined }));
vi.mock("../settings", () => ({ getCompany: async () => ({ name: "Grandview Painting Ltd.", displayName: "Grandview Painting" }) }));
vi.mock("../notifications", () => ({
  officeRecipients: async () => [{ id: "owner-1" }, { id: "ops-1" }],
  notify: async (to: string[], notice: { title: string; href: string }) => void h.notices.push({ to, notice }),
}));

process.env.BETTER_AUTH_SECRET = "test-secret-that-is-long-enough-1234";
process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.APP_URL = "https://os.example.com";
const gmail = await import("./gmail");
const { seal } = await import("@/lib/crypto/secret-box");

const REFRESH = "1//refresh-token-[TEST DATA]";
const CUSTOMER = "00000000-0000-4000-8000-000000000030";
const connected = (extra: Record<string, unknown> = {}) => [
  { value: { refreshToken: seal(REFRESH), email: "info@example.com", connectedBy: "owner-1", connectedAt: "2026-10-01T00:00:00.000Z", historyId: "100", lastSyncAt: null, broken: false, ...extra } },
];
const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");
const savedSetting = () => h.fake.find("insert", "app_settings").at(-1)?.args.values?.[0] as { value: Record<string, unknown> } | undefined;

beforeEach(() => {
  h.fake.reset();
  h.rows = {};
  h.requests = [];
  h.notices = [];
  h.respond = () => ({ status: 200, body: {} });
  h.fake.otherwise((call) => {
    const r = h.rows[`${call.op}:${call.table}`];
    return typeof r === "function" ? r(call) : (r ?? []);
  });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    h.requests.push({ url, method, body: init.body ? String(init.body) : null });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "ya29.test", expires_in: 3600 });
    const r = h.respond(url, method);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("buildMime", () => {
  it("writes a plain-text UTF-8 email with the company name on the From line", () => {
    const raw = decode(gmail.buildMime({ from: "info@example.com", fromName: "Grandview Painting", to: "kim@example.com", subject: "Your proposal", text: "Hi Kim,\nThanks – see you soon.", replyTo: "office@example.com" }));
    const [head, body] = raw.split("\r\n\r\n");
    expect(head).toContain('From: "Grandview Painting" <info@example.com>');
    expect(head).toContain("To: kim@example.com");
    expect(head).toContain("Subject: Your proposal");
    expect(head).toContain("Reply-To: office@example.com");
    expect(head).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("Hi Kim,\r\nThanks – see you soon.");
  });

  it("can't be tricked into adding headers or recipients", () => {
    const raw = decode(gmail.buildMime({ from: "info@example.com", to: "kim@example.com>\r\nBcc: all@example.com", subject: "Hello\r\nBcc: evil@example.com", text: "x" }));
    const head = raw.split("\r\n\r\n")[0];
    expect(head.split("\r\n").filter((l) => /^bcc:/i.test(l))).toEqual([]);
    expect(head).toContain("Subject: Hello Bcc: evil@example.com");
  });

  it("encodes accented subjects", () => {
    const head = decode(gmail.buildMime({ from: "info@example.com", to: "a@example.com", subject: "Café repaint", text: "x" })).split("\r\n\r\n")[0];
    expect(head).toContain(`Subject: =?UTF-8?B?${Buffer.from("Café repaint").toString("base64")}?=`);
  });
});

describe("reading customers' emails", () => {
  it("parses From lines", () => {
    expect(gmail.parseFrom('"Kim Lee" <Kim@Example.com>')).toEqual({ name: "Kim Lee", address: "kim@example.com" });
    expect(gmail.parseFrom("kim@example.com")).toEqual({ name: null, address: "kim@example.com" });
    expect(gmail.parseFrom("not an address")).toBeNull();
  });

  it("keeps only the new part of a reply", () => {
    expect(gmail.newPartOf("Sounds good, Tuesday works.\n\nOn Mon, Oct 20, 2026 at 9:00 AM Grandview <info@example.com> wrote:\n> Hi Kim")).toBe("Sounds good, Tuesday works.");
    expect(gmail.newPartOf("Yes please\r\n\r\nOn Mon, Oct 20, 2026 at 9:00 AM Grandview\r\n<info@example.com> wrote:\r\n> old")).toBe("Yes please");
    expect(gmail.newPartOf("Ok\n-----Original Message-----\nFrom: x")).toBe("Ok");
    expect(gmail.newPartOf("Just a note")).toBe("Just a note");
  });
});

describe("sending", () => {
  it("returns null when Gmail isn't connected, so the other email service is used", async () => {
    expect(await gmail.sendViaGmail({ to: "kim@example.com", subject: "Hi", text: "x" })).toBeNull();
    expect(h.requests).toEqual([]);
  });

  it("sends from the connected mailbox into the same conversation", async () => {
    h.rows["select:app_settings"] = connected();
    h.respond = (url) => (url.endsWith("/messages/send") ? { status: 200, body: { id: "m1", threadId: "t1" } } : { status: 404, body: {} });
    const r = await gmail.sendViaGmail({ to: "kim@example.com", subject: "Re: Your proposal", text: "Just checking in", threadId: "t1" });
    expect(r).toEqual({ status: "sent", provider: "gmail", providerMessageId: "m1", threadId: "t1" });
    const send = h.requests.find((q) => q.url.endsWith("/messages/send"))!;
    const payload = JSON.parse(send.body!);
    expect(payload.threadId).toBe("t1");
    expect(decode(payload.raw)).toContain('From: "Grandview Painting" <info@example.com>');
  });

  it("fails loudly (instead of quietly sending from elsewhere) when Gmail refuses", async () => {
    h.rows["select:app_settings"] = connected();
    h.respond = () => ({ status: 403, body: { error: { message: "Insufficient Permission" } } });
    const r = await gmail.sendViaGmail({ to: "kim@example.com", subject: "Hi", text: "x" });
    expect(r).toMatchObject({ status: "failed", provider: "gmail", error: expect.stringMatching(/Insufficient Permission/) });
  });
});

describe("syncGmail", () => {
  const message = (id: string, from: string, subject: string, text: string) => ({
    meta: { id, threadId: `t-${id}`, internalDate: "1792000000000", payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] } },
    full: { snippet: text.slice(0, 20), payload: { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: Buffer.from(text).toString("base64url") } }] } },
  });

  it("copies a customer's new email into their file and tells the office; ignores strangers and our own mail", async () => {
    h.rows["select:app_settings"] = connected();
    const msgs = {
      a: message("a", '"Kim Lee" <kim@example.com>', "Re: Your painting proposal", "Can we start in May?\n\nOn Mon, Oct 20, 2026 Grandview wrote:\n> Hi Kim"),
      b: message("b", "newsletter@shop.example.com", "Sale!", "Buy now"),
      c: message("c", "info@example.com", "Sent from phone", "x"),
    };
    h.respond = (url) => {
      if (url.includes("/history?")) return { status: 200, body: { historyId: "150", history: [{ messagesAdded: ["a", "b", "c"].map((id) => ({ message: { id, labelIds: ["INBOX"] } })) }, { messagesAdded: [{ message: { id: "d", labelIds: ["SENT"] } }] }] } };
      const m = url.match(/\/messages\/(\w)\?format=(\w+)/);
      if (m) return { status: 200, body: msgs[m[1] as keyof typeof msgs][m[2] === "full" ? "full" : "meta"] };
      return { status: 404, body: {} };
    };
    // Looked up for Kim, then the newsletter; our own address is never looked up.
    let lookups = 0;
    h.rows["select:customers"] = () => (lookups++ === 0 ? [{ id: CUSTOMER, name: "Kim Lee" }] : []);
    h.rows["insert:inbound_emails"] = [{ id: "row-1" }];

    expect(await gmail.syncGmail(new Date("2026-10-21T20:00:00Z"))).toEqual({ ran: true, checked: 3, imported: 1 });
    expect(h.requests.some((q) => q.url.includes("/messages/d"))).toBe(false);
    expect(lookups).toBe(2);
    const saved = h.fake.find("insert", "inbound_emails")[0].args.values?.[0];
    expect(saved).toMatchObject({ gmailMessageId: "a", threadId: "t-a", customerId: CUSTOMER, fromAddress: "kim@example.com", fromName: "Kim Lee", subject: "Re: Your painting proposal", bodyText: "Can we start in May?" });
    expect(h.fake.find("insert", "activities")[0].args.values?.[0]).toMatchObject({ customerId: CUSTOMER, type: "email" });
    expect(h.notices).toEqual([{ to: ["owner-1", "ops-1"], notice: expect.objectContaining({ title: "Kim Lee emailed: Re: Your painting proposal", href: `/customers/${CUSTOMER}` }) }]);
    expect(savedSetting()?.value).toMatchObject({ historyId: "150", lastSyncAt: "2026-10-21T20:00:00.000Z" });
  });

  it("doesn't tell anyone twice about an email it already copied", async () => {
    h.rows["select:app_settings"] = connected();
    const m = message("a", "kim@example.com", "Hi", "Hello");
    h.respond = (url) => (url.includes("/history?") ? { status: 200, body: { historyId: "151", history: [{ messagesAdded: [{ message: { id: "a" } }] }] } } : { status: 200, body: url.includes("format=full") ? m.full : m.meta });
    h.rows["select:customers"] = [{ id: CUSTOMER, name: "Kim Lee" }];
    h.rows["insert:inbound_emails"] = [];
    expect(await gmail.syncGmail()).toMatchObject({ imported: 0 });
    expect(h.notices).toEqual([]);
  });

  it("starts again from now when Google no longer has that much history", async () => {
    h.rows["select:app_settings"] = connected({ historyId: "1" });
    h.respond = (url) => (url.includes("/history?") ? { status: 404, body: {} } : url.endsWith("/profile") ? { status: 200, body: { emailAddress: "info@example.com", historyId: 900 } } : { status: 404, body: {} });
    expect(await gmail.syncGmail()).toEqual({ ran: true, checked: 0, imported: 0 });
    expect(savedSetting()?.value).toMatchObject({ historyId: "900" });
  });

  it("does nothing when Gmail isn't connected or needs reconnecting", async () => {
    expect(await gmail.syncGmail()).toEqual({ ran: false, checked: 0, imported: 0 });
    h.rows["select:app_settings"] = connected({ broken: true });
    expect(await gmail.syncGmail()).toEqual({ ran: false, checked: 0, imported: 0 });
    expect(h.requests).toEqual([]);
  });
});

describe("connecting", () => {
  it("asks Google for send and read access, offline, for the right return address", () => {
    const url = new URL(gmail.googleAuthUrl("state-123", "info@example.com"));
    expect(url.searchParams.get("redirect_uri")).toBe("https://os.example.com/api/integrations/google/callback");
    expect(url.searchParams.get("scope")).toContain("gmail.send");
    expect(url.searchParams.get("scope")).toContain("gmail.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe("state-123");
  });
});
