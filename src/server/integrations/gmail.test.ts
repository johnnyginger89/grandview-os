import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCall, FakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeDb,
  rows: {} as Record<string, unknown[] | ((c: FakeCall) => unknown[])>,
  requests: [] as { url: string; method: string; body: string | null }[],
  respond: (() => ({ status: 200, body: {} })) as (url: string, method: string) => { status: number; body: unknown },
  notices: [] as { to: string[]; notice: { title: string; href: string } }[],
  companyEmail: "office@example.com",
  audits: [] as { actorId: string | null; action: string; ipAddress?: string | null; before?: unknown; after?: unknown }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  h.fake = createFakeDb();
  return { db: h.fake.db };
});
vi.mock("../audit", () => ({ audit: async (e: (typeof h.audits)[number]) => void h.audits.push(e) }));
vi.mock("../settings", () => ({ getCompany: async () => ({ name: "Grandview Painting Ltd.", displayName: "Grandview Painting", email: h.companyEmail }) }));
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
const NEW_REFRESH = "1//new-refresh-token-[TEST DATA]";
const CUSTOMER = "00000000-0000-4000-8000-000000000030";
const connected = (extra: Record<string, unknown> = {}) => [
  { value: { refreshToken: seal(REFRESH), email: "info@example.com", connectedBy: "owner-1", connectedAt: "2026-10-01T00:00:00.000Z", historyId: "100", lastSyncAt: null, backfill: "done", lastResult: null, broken: false, ...extra } },
];
const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");
const savedSetting = () => h.fake.find("insert", "app_settings").at(-1)?.args.values?.[0] as { value: Record<string, unknown> } | undefined;

beforeEach(() => {
  h.fake.reset();
  h.rows = {};
  h.requests = [];
  h.notices = [];
  h.audits = [];
  h.companyEmail = "office@example.com";
  h.respond = () => ({ status: 200, body: {} });
  h.fake.otherwise((call) => {
    const r = h.rows[`${call.op}:${call.table}`];
    return typeof r === "function" ? r(call) : (r ?? []);
  });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    h.requests.push({ url, method, body: init.body ? String(init.body) : null });
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      // Swapping a sign-in code also gives the lasting (refresh) token and the granted scopes.
      const signIn = String(init.body ?? "").includes("grant_type=authorization_code");
      return Response.json({ access_token: "ya29.test", expires_in: 3600, ...(signIn ? { refresh_token: NEW_REFRESH, scope: gmail.GMAIL_SCOPES.join(" ") } : {}) });
    }
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

    expect(await gmail.syncGmail(new Date("2026-10-21T20:00:00Z"))).toEqual({ ran: true, checked: 3, imported: 1, catchingUp: false });
    expect(h.requests.some((q) => q.url.includes("/messages/d"))).toBe(false);
    expect(lookups).toBe(2);
    const saved = h.fake.find("insert", "inbound_emails")[0].args.values?.[0];
    expect(saved).toMatchObject({ gmailMessageId: "a", threadId: "t-a", customerId: CUSTOMER, fromAddress: "kim@example.com", fromName: "Kim Lee", subject: "Re: Your painting proposal", bodyText: "Can we start in May?" });
    expect(h.fake.find("insert", "activities")[0].args.values?.[0]).toMatchObject({ customerId: CUSTOMER, type: "email" });
    expect(h.notices).toEqual([{ to: ["owner-1", "ops-1"], notice: expect.objectContaining({ title: "Kim Lee emailed: Re: Your painting proposal", href: `/customers/${CUSTOMER}` }) }]);
    expect(savedSetting()?.value).toMatchObject({ historyId: "150", lastSyncAt: "2026-10-21T20:00:00.000Z", lastResult: { checked: 3, imported: 1, error: null } });
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
    expect(await gmail.syncGmail()).toEqual({ ran: true, checked: 0, imported: 0, catchingUp: true });
    expect(savedSetting()?.value).toMatchObject({ historyId: "900", backfill: null });
  });

  it("after connecting, brings in the last 60 days of customer email a page at a time, without notifying", async () => {
    h.rows["select:app_settings"] = connected({ backfill: null });
    const m = message("old1", '"Kim Lee" <kim@example.com>', "Painting quote?", "Can you come by next week?");
    h.respond = (url) => {
      if (url.includes("/history?")) return { status: 200, body: { historyId: "120" } };
      if (url.includes("/messages?")) return { status: 200, body: { messages: [{ id: "old1" }], nextPageToken: "page-2" } };
      return { status: 200, body: url.includes("format=full") ? m.full : m.meta };
    };
    h.rows["select:customers"] = [{ id: CUSTOMER, name: "Kim Lee" }];
    h.rows["insert:inbound_emails"] = [{ id: "row-1" }];
    expect(await gmail.syncGmail(new Date("2026-10-21T20:00:00Z"))).toEqual({ ran: true, checked: 1, imported: 1, catchingUp: true });
    const list = h.requests.find((q) => q.url.includes("/messages?"))!;
    expect(new URL(list.url).searchParams.get("q")).toBe("in:inbox newer_than:60d");
    expect(h.notices).toEqual([]);
    // On the timeline when it arrived, not when it was copied.
    expect(h.fake.find("insert", "activities")[0].args.values?.[0]).toMatchObject({ createdAt: new Date(1792000000000) });
    expect(savedSetting()?.value).toMatchObject({ backfill: "page-2" });
  });

  it("records a failed check so Settings can say what went wrong", async () => {
    h.rows["select:app_settings"] = connected();
    h.respond = () => ({ status: 403, body: { error: { message: "Insufficient Permission" } } });
    await expect(gmail.syncGmail(new Date("2026-10-21T20:00:00Z"))).rejects.toThrow(/Insufficient Permission/);
    expect(savedSetting()?.value).toMatchObject({ lastResult: { imported: 0, error: expect.stringMatching(/Insufficient Permission/) } });
  });

  it("does nothing when Gmail isn't connected or needs reconnecting", async () => {
    expect(await gmail.syncGmail()).toEqual({ ran: false, checked: 0, imported: 0, catchingUp: false });
    h.rows["select:app_settings"] = connected({ broken: true });
    expect(await gmail.syncGmail()).toEqual({ ran: false, checked: 0, imported: 0, catchingUp: false });
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

describe("who can connect, and which mailbox", () => {
  const OWNER = { id: "owner-1", role: "owner" };
  const META = { ip: "203.0.113.20", userAgent: "test" };
  const googleSays = (emailAddress: string) => {
    h.respond = (url) => (url.endsWith("/profile") ? { status: 200, body: { emailAddress, historyId: 500 } } : { status: 404, body: {} });
  };
  const revoked = () => h.requests.filter((q) => q.url.startsWith("https://oauth2.googleapis.com/revoke")).map((q) => decodeURIComponent(new URL(q.url).searchParams.get("token") ?? ""));

  it("reads the domain of an address", () => {
    expect(gmail.emailDomain(" Info@GrandviewPainting.ca ")).toBe("grandviewpainting.ca");
    expect(gmail.emailDomain("someone@mail.example.com")).toBe("mail.example.com");
    for (const bad of ["", null, undefined, "no-at-sign", "a@b", "two@at@example.com", "x@exa mple.com"]) expect(gmail.emailDomain(bad), String(bad)).toBeNull();
  });

  it("only the owner can connect: an administrator is refused before Google is even asked", async () => {
    for (const role of ["admin", "operations_manager", "estimator"]) {
      await expect(gmail.completeGmailConnection("sign-in-code", { id: "x", role }, META)).rejects.toThrow("Only the owner can connect or disconnect Gmail.");
    }
    expect(h.requests).toEqual([]);
    expect(savedSetting()).toBeUndefined();
  });

  it("needs the company email, to know which domain is the company's", async () => {
    h.companyEmail = "";
    await expect(gmail.completeGmailConnection("sign-in-code", OWNER, META)).rejects.toThrow(/Add the company email/);
    expect(h.requests).toEqual([]);
  });

  it("refuses a mailbox off the company domain, hands Google's access back and keeps nothing", async () => {
    for (const mailbox of ["someone@gmail.com", "info@mail.example.com", "info@example.com.evil.test"]) {
      h.requests = [];
      h.audits = [];
      googleSays(mailbox);
      await expect(gmail.completeGmailConnection("sign-in-code", OWNER, META)).rejects.toThrow(gmail.GmailError);
      expect(revoked(), mailbox).toEqual([NEW_REFRESH]);
      expect(savedSetting(), mailbox).toBeUndefined();
      expect(h.audits, mailbox).toEqual([expect.objectContaining({ action: "integration.gmail.refused", ipAddress: "203.0.113.20", after: { email: mailbox, companyDomain: "example.com", endedOlderConnection: false } })]);
    }
  });

  it("refusing the mailbox an older connection uses ends that connection too (its access was handed back)", async () => {
    h.rows["select:app_settings"] = connected({ email: "personal@gmail.com", connectedBy: "admin-1" });
    googleSays("personal@gmail.com");
    await expect(gmail.completeGmailConnection("sign-in-code", OWNER, META)).rejects.toThrow(/isn't on the company's email domain/);
    expect(h.fake.find("delete", "app_settings")).toHaveLength(1);
    expect(h.audits).toEqual([expect.objectContaining({ action: "integration.gmail.refused", after: expect.objectContaining({ endedOlderConnection: true }) })]);
  });

  it("refusing another mailbox leaves the company mailbox connected", async () => {
    h.rows["select:app_settings"] = connected({ email: "office@example.com" });
    googleSays("someone@gmail.com");
    await expect(gmail.completeGmailConnection("sign-in-code", OWNER, META)).rejects.toThrow(gmail.GmailError);
    expect(h.fake.find("delete", "app_settings")).toEqual([]);
    expect(revoked()).toEqual([NEW_REFRESH]);
  });

  it("connects the owner's sign-in to a mailbox on the company domain", async () => {
    googleSays("Office@Example.com");
    expect(await gmail.completeGmailConnection("sign-in-code", OWNER, META)).toBe("Office@Example.com");
    expect(savedSetting()?.value).toMatchObject({ email: "office@example.com", connectedBy: "owner-1", broken: false });
    expect(revoked()).toEqual([]);
    expect(h.audits).toEqual([expect.objectContaining({ action: "integration.gmail.connect", ipAddress: "203.0.113.20" })]);
  });

  it("only the owner can disconnect", async () => {
    h.rows["select:app_settings"] = connected();
    await expect(gmail.disconnectGmail({ id: "admin-1", role: "admin" }, META)).rejects.toThrow("Only the owner can connect or disconnect Gmail.");
    expect(h.fake.find("delete", "app_settings")).toEqual([]);
    expect(h.requests).toEqual([]);
    await gmail.disconnectGmail(OWNER, META);
    expect(h.fake.find("delete", "app_settings")).toHaveLength(1);
    expect(revoked()).toEqual([REFRESH]);
    expect(h.audits).toEqual([expect.objectContaining({ action: "integration.gmail.disconnect", ipAddress: "203.0.113.20" })]);
  });

  it("Settings can warn about an older connection off the company domain, or not made by the owner", async () => {
    h.rows["select:app_settings"] = connected({ email: "personal@gmail.com", connectedBy: "admin-1" });
    h.rows["select:user"] = [{ name: "Ada Admin", role: "admin" }];
    h.rows["select:inbound_emails"] = [{ n: 0 }];
    expect(await gmail.gmailStatus()).toMatchObject({ connected: true, companyEmail: "office@example.com", companyDomain: "example.com", onCompanyDomain: false, connectedByOwner: false, connectedByName: "Ada Admin" });
    h.rows["select:app_settings"] = connected({ email: "office@example.com" });
    h.rows["select:user"] = [{ name: "Olive Owner", role: "owner" }];
    expect(await gmail.gmailStatus()).toMatchObject({ onCompanyDomain: true, connectedByOwner: true });
  });
});
