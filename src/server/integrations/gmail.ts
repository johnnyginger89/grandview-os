import "server-only";
import { GMAIL_CONNECT_MESSAGES } from "@/lib/gmail-connect-messages";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activities, appSettings, contacts, customers, inboundEmails, user } from "@/db/schema";
import { seal, sealedSchema, unseal } from "@/lib/crypto/secret-box";
import type { EmailMessage, EmailResult } from "@/lib/email";
import { audit } from "../audit";
import { notify, officeRecipients } from "../notifications";
import { getCompany } from "../settings";

/*
 * Gmail: the company mailbox (info@) connected once by the owner with Google sign-in.
 * Everything Grandview OS emails then goes out from that mailbox (so it sits in Gmail's
 * Sent folder and replies come back there), and every few minutes new mail from a
 * customer's address is copied into their file and the office is told. Google keeps the
 * originals. The refresh token is stored encrypted. Customer email is still only ever
 * sent by a person clicking Send after seeing it (CLAUDE.md rule 8).
 */

const SETTING = "integration_gmail";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GMAIL_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"];

export class GmailError extends Error {
  readonly expose = true;
}

const storedSchema = z.object({
  refreshToken: sealedSchema,
  email: z.string(),
  connectedBy: z.string().nullable(),
  connectedAt: z.string(),
  historyId: z.string().nullable().default(null),
  lastSyncAt: z.string().nullable().default(null),
  /** Bringing in the last 60 days of customer email: Gmail's next page, or "done". Null = not started. */
  backfill: z.string().nullable().default(null),
  /** What the last check did, shown in Settings so "is it working?" has an answer. */
  lastResult: z
    .object({ checked: z.number(), imported: z.number(), error: z.string().nullable().default(null) })
    .nullable()
    .default(null),
  /** Google refused the refresh token (revoked or expired): connect again. */
  broken: z.boolean().default(false),
});
type Stored = z.infer<typeof storedSchema>;

function config() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const base = (process.env.APP_URL || process.env.BETTER_AUTH_URL || "").replace(/\/$/, "");
  return clientId && clientSecret && base ? { clientId, clientSecret, redirectUri: `${base}/api/integrations/google/callback` } : null;
}

async function stored(): Promise<Stored | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SETTING)).limit(1);
  const parsed = storedSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : null;
}

async function save(value: Stored) {
  await db.insert(appSettings).values({ key: SETTING, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export interface GmailStatus {
  /** GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are set on the server. */
  configured: boolean;
  connected: boolean;
  broken: boolean;
  email: string | null;
  connectedAt: string | null;
  connectedByName: string | null;
  lastSyncAt: string | null;
  lastResult: { checked: number; imported: number; error: string | null } | null;
  /** Still bringing in the last 60 days of customer email. */
  catchingUp: boolean;
  /** Customer emails copied in so far. */
  importedTotal: number;
  /** What to enter as the redirect URI in Google Cloud. */
  redirectUri: string | null;
}

export async function gmailStatus(): Promise<GmailStatus> {
  const c = config();
  const s = await stored();
  const readable = !!s && unseal(s.refreshToken) !== null;
  const [by] = s?.connectedBy ? await db.select({ name: user.name }).from(user).where(eq(user.id, s.connectedBy)).limit(1) : [];
  return {
    configured: !!c,
    connected: !!s && readable && !s.broken,
    broken: !!s && (!readable || s.broken),
    email: s?.email ?? null,
    connectedAt: s?.connectedAt ?? null,
    connectedByName: by?.name ?? null,
    lastSyncAt: s?.lastSyncAt ?? null,
    lastResult: s?.lastResult ?? null,
    catchingUp: !!s && s.backfill !== "done",
    importedTotal: s ? Number((await db.select({ n: sql<number>`count(*)::int` }).from(inboundEmails))[0]?.n ?? 0) : 0,
    redirectUri: c?.redirectUri ?? null,
  };
}

/** Where to send the owner to sign in to Google. `state` guards the return trip. */
export function googleAuthUrl(state: string, loginHint?: string | null): string {
  const c = config();
  if (!c) throw new GmailError("Gmail isn't set up on the server yet (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).");
  const params = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    // Always ask, so Google sends a refresh token even if it was granted before.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

const tokenSchema = z.object({ access_token: z.string(), expires_in: z.number().optional(), refresh_token: z.string().optional(), scope: z.string().optional() });

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body), signal: AbortSignal.timeout(10_000), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: res.ok, json };
}

/** After Google sends the owner back: swap the code for tokens and keep the refresh token, encrypted. */
export async function completeGmailConnection(code: string, actor: { id: string }): Promise<string> {
  const c = config();
  if (!c) throw new GmailError(GMAIL_CONNECT_MESSAGES.setup);
  const { ok, json } = await tokenRequest({ code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: c.redirectUri, grant_type: "authorization_code" });
  const t = tokenSchema.safeParse(json);
  if (!ok || !t.success) throw new GmailError(GMAIL_CONNECT_MESSAGES.incomplete);
  if (!t.data.refresh_token) throw new GmailError(GMAIL_CONNECT_MESSAGES.lasting);
  const granted = (t.data.scope ?? "").split(" ");
  if (!granted.includes("https://www.googleapis.com/auth/gmail.send") || !granted.includes("https://www.googleapis.com/auth/gmail.readonly"))
    throw new GmailError(GMAIL_CONNECT_MESSAGES.scopes);
  const profile = z.object({ emailAddress: z.string(), historyId: z.coerce.string() }).parse(await gmailFetch("/profile", {}, t.data.access_token));
  cache = { token: t.data.access_token, expires: Date.now() + (t.data.expires_in ?? 3000) * 1000 };
  await save({ refreshToken: seal(t.data.refresh_token), email: profile.emailAddress.toLowerCase(), connectedBy: actor.id, connectedAt: new Date().toISOString(), historyId: profile.historyId, lastSyncAt: null, backfill: null, lastResult: null, broken: false });
  await audit({ actorId: actor.id, action: "integration.gmail.connect", entityType: "settings", entityId: SETTING, after: { email: profile.emailAddress } });
  return profile.emailAddress;
}

export async function disconnectGmail(actor: { id: string }): Promise<void> {
  const s = await stored();
  const refresh = s ? unseal(s.refreshToken) : null;
  if (refresh) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: "POST", signal: AbortSignal.timeout(5000) }).catch(() => undefined);
  await db.delete(appSettings).where(eq(appSettings.key, SETTING));
  cache = null;
  await audit({ actorId: actor.id, action: "integration.gmail.disconnect", entityType: "settings", entityId: SETTING, before: { email: s?.email ?? null } });
}

let cache: { token: string; expires: number } | null = null;

async function accessToken(s: Stored): Promise<string> {
  if (cache && cache.expires > Date.now() + 60_000) return cache.token;
  const c = config();
  const refresh = unseal(s.refreshToken);
  if (!c || !refresh) throw new GmailError("Gmail needs to be connected again (Settings → Integrations).");
  const { ok, json } = await tokenRequest({ refresh_token: refresh, client_id: c.clientId, client_secret: c.clientSecret, grant_type: "refresh_token" });
  const t = tokenSchema.safeParse(json);
  if (!ok || !t.success) {
    if (json.error === "invalid_grant") await save({ ...s, broken: true });
    throw new GmailError("Gmail needs to be connected again (Settings → Integrations).");
  }
  cache = { token: t.data.access_token, expires: Date.now() + (t.data.expires_in ?? 3000) * 1000 };
  return cache.token;
}

async function gmailFetch(path: string, init: RequestInit = {}, token: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${GMAIL}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  } catch {
    throw new GmailError("Gmail isn't answering right now.");
  }
  if (res.status === 404) throw new GmailNotFound();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new GmailError(`Gmail refused it: ${body?.error?.message ?? `HTTP ${res.status}`}.`);
  }
  return res.json();
}

class GmailNotFound extends GmailError {
  constructor() {
    super("Not found in Gmail.");
  }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** One header line: no line breaks (they would start new headers), non-ASCII encoded. */
function header(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function address(name: string | null | undefined, email: string): string {
  const e = email.replace(/[\r\n<>,;"]/g, "").trim();
  if (!name?.trim()) return e;
  const n = name.replace(/[\r\n"]/g, "").trim();
  return /^[\x20-\x7e]*$/.test(n) ? `"${n}" <${e}>` : `${header(n)} <${e}>`;
}

/** The raw RFC 2822 message Gmail's API takes (base64url). Plain text, UTF-8. */
export function buildMime(m: { from: string; fromName?: string | null; to: string; subject: string; text: string; replyTo?: string; inReplyTo?: string | null }): string {
  const body = Buffer.from(m.text.replace(/\r?\n/g, "\r\n"), "utf8")
    .toString("base64")
    .replace(/.{76}/g, "$&\r\n");
  const lines = [
    `From: ${address(m.fromName, m.from)}`,
    `To: ${address(null, m.to)}`,
    `Subject: ${header(m.subject)}`,
    ...(m.replyTo ? [`Reply-To: ${address(null, m.replyTo)}`] : []),
    ...(m.inReplyTo ? [`In-Reply-To: ${header(m.inReplyTo)}`, `References: ${header(m.inReplyTo)}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

/**
 * Sends through the connected Gmail mailbox, or returns null when Gmail isn't connected
 * (the caller then uses the other provider). A connection that has broken fails loudly
 * instead of quietly sending from somewhere else.
 */
export async function sendViaGmail(msg: EmailMessage & { fromName?: string | null; threadId?: string | null }): Promise<EmailResult | null> {
  const s = await stored();
  if (!s) return null;
  try {
    const token = await accessToken(s);
    const fromName = msg.fromName ?? (await getCompany().then((c) => (c.displayName || c.name || "").trim() || null).catch(() => null));
    const raw = buildMime({ from: s.email, fromName, to: msg.to, subject: msg.subject, text: msg.text, replyTo: msg.replyTo && msg.replyTo.toLowerCase() !== s.email ? msg.replyTo : undefined });
    const sent = z
      .object({ id: z.string(), threadId: z.string().optional() })
      .parse(await gmailFetch("/messages/send", { method: "POST", body: JSON.stringify({ raw, ...(msg.threadId ? { threadId: msg.threadId } : {}) }) }, token));
    return { status: "sent", provider: "gmail", providerMessageId: sent.id, threadId: sent.threadId };
  } catch (e) {
    return { status: "failed", provider: "gmail", error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Bringing customers' emails in
// ---------------------------------------------------------------------------

/** "Kim Lee <kim@example.com>" → name and lower-case address. */
export function parseFrom(value: string): { name: string | null; address: string } | null {
  const m = value.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^<>\s]+@[^<>\s]+)>\s*$/) ?? value.match(/^\s*()([^<>\s]+@[^<>\s]+)\s*$/);
  if (!m) return null;
  return { name: m[1]?.trim() || null, address: m[2].toLowerCase() };
}

/** The new part of a reply: stops at the quoted earlier message ("On … wrote:", "-----Original Message-----", "> " lines). */
export function newPartOf(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^On .+wrote:\s*$/.test(l) || /^On .+$/.test(l) && /wrote:\s*$/.test(lines[i + 1] ?? "")) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(l) || /^From: .+/.test(l) && /^(Sent|Date): /.test(lines[i + 1] ?? "")) break;
    if (/^>/.test(l)) break;
    out.push(l);
  }
  return out.join("\n").trim();
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

function plainText(part: GmailPart | undefined): string | null {
  if (!part) return null;
  if (part.mimeType === "text/plain" && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const p of part.parts ?? []) {
    const t = plainText(p);
    if (t) return t;
  }
  return null;
}

const headerOf = (headers: { name: string; value: string }[] | undefined, name: string) => headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

async function customerByEmail(addressLower: string): Promise<{ id: string; name: string } | null> {
  const [c] = await db
    .select({ id: customers.id, name: customers.displayName })
    .from(customers)
    .leftJoin(contacts, eq(contacts.customerId, customers.id))
    .where(or(sql`lower(${customers.email}) = ${addressLower}`, sql`lower(${contacts.email}) = ${addressLower}`))
    .orderBy(desc(customers.updatedAt))
    .limit(1);
  return c ?? null;
}

const historySchema = z.object({
  historyId: z.coerce.string().optional(),
  nextPageToken: z.string().optional(),
  history: z.array(z.object({ messagesAdded: z.array(z.object({ message: z.object({ id: z.string(), threadId: z.string().optional(), labelIds: z.array(z.string()).optional() }) })).optional() })).optional(),
});

const metaSchema = z.object({
  id: z.string(),
  threadId: z.string().optional(),
  internalDate: z.coerce.number().optional(),
  labelIds: z.array(z.string()).optional(),
  payload: z.object({ headers: z.array(z.object({ name: z.string(), value: z.string() })).optional() }).optional(),
});

/**
 * Copies one Gmail message into the customer's file if it's from a customer (or a
 * customer contact). Returns true when it was new. `notify` is off for older mail
 * brought in when Gmail is first connected.
 */
async function importMessage(id: string, token: string, mailbox: string, now: Date, opts: { notify: boolean }): Promise<boolean> {
  const meta = metaSchema.parse(await gmailFetch(`/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, {}, token));
  if (meta.labelIds?.some((l) => l === "SENT" || l === "DRAFT")) return false;
  const from = parseFrom(headerOf(meta.payload?.headers, "From"));
  if (!from || from.address === mailbox) return false;
  const customer = await customerByEmail(from.address);
  if (!customer) return false;
  const [seen] = await db.select({ id: inboundEmails.id }).from(inboundEmails).where(eq(inboundEmails.gmailMessageId, meta.id)).limit(1);
  if (seen) return false;
  const full = z.object({ snippet: z.string().optional(), payload: z.unknown() }).parse(await gmailFetch(`/messages/${encodeURIComponent(id)}?format=full`, {}, token));
  const text = plainText(full.payload as GmailPart) ?? full.snippet ?? "";
  const body = newPartOf(text).slice(0, 20_000) || (full.snippet ?? "");
  const subject = headerOf(meta.payload?.headers, "Subject").slice(0, 300) || "(no subject)";
  const receivedAt = meta.internalDate ? new Date(meta.internalDate) : now;
  const [row] = await db
    .insert(inboundEmails)
    .values({ gmailMessageId: meta.id, threadId: meta.threadId ?? null, customerId: customer.id, fromAddress: from.address, fromName: from.name, subject, bodyText: body, receivedAt })
    .onConflictDoNothing({ target: inboundEmails.gmailMessageId })
    .returning({ id: inboundEmails.id });
  if (!row) return false;
  await db.insert(activities).values({
    customerId: customer.id,
    type: "email",
    body: `Email from ${from.name ?? from.address}: ${subject}${body ? `\n${body.slice(0, 600)}${body.length > 600 ? "…" : ""}` : ""}`,
    meta: { inbound: true, gmailMessageId: meta.id, threadId: meta.threadId ?? null },
    // On the timeline when it arrived, not when it was copied in.
    createdAt: receivedAt,
  });
  if (opts.notify) {
    const recipients = await officeRecipients();
    await notify(
      recipients.map((u) => u.id),
      { kind: "email.inbound", title: `${customer.name} emailed: ${subject}`, body: body.replace(/\s+/g, " ").slice(0, 140) || null, href: `/customers/${customer.id}`, entityType: "customer", entityId: customer.id },
    );
  }
  return true;
}

/** Older messages looked at per check while catching up on the last 60 days. */
const BACKFILL_PER_RUN = 100;

/**
 * Every 10 minutes: new mail since the last check that's from a customer's (or a customer
 * contact's) address is copied into their file and the office is told. Right after Gmail is
 * connected it also works back through the last 60 days of the inbox, a batch per check,
 * without notifications.
 */
export async function syncGmail(now: Date = new Date()): Promise<{ ran: boolean; checked: number; imported: number; catchingUp: boolean }> {
  const s = await stored();
  if (!s || s.broken) return { ran: false, checked: 0, imported: 0, catchingUp: false };
  try {
    return await runSync(s, now);
  } catch (e) {
    const error = e instanceof GmailError ? e.message : "Gmail couldn't be checked. It will try again in 10 minutes.";
    const latest = (await stored()) ?? s;
    await save({ ...latest, lastSyncAt: now.toISOString(), lastResult: { checked: 0, imported: 0, error } });
    throw e;
  }
}

async function runSync(s: Stored, now: Date) {
  const token = await accessToken(s);
  let historyId = s.historyId;
  let checked = 0;
  let imported = 0;

  if (!historyId) {
    historyId = z.object({ historyId: z.coerce.string() }).parse(await gmailFetch("/profile", {}, token)).historyId;
  } else {
    const ids: string[] = [];
    let pageToken: string | undefined;
    try {
      for (let page = 0; page < 10; page++) {
        const q = new URLSearchParams({ startHistoryId: historyId, historyTypes: "messageAdded", labelId: "INBOX", maxResults: "100", ...(pageToken ? { pageToken } : {}) });
        const h = historySchema.parse(await gmailFetch(`/history?${q}`, {}, token));
        for (const r of h.history ?? [])
          for (const a of r.messagesAdded ?? []) if (!a.message.labelIds?.some((l) => l === "SENT" || l === "DRAFT") && !ids.includes(a.message.id)) ids.push(a.message.id);
        if (h.historyId) historyId = h.historyId;
        if (!h.nextPageToken) break;
        pageToken = h.nextPageToken;
      }
    } catch (e) {
      // Google keeps about a week of history; after a long gap, start again from now (and catch up again).
      if (!(e instanceof GmailNotFound)) throw e;
      historyId = z.object({ historyId: z.coerce.string() }).parse(await gmailFetch("/profile", {}, token)).historyId;
      await save({ ...s, historyId, backfill: null, lastSyncAt: now.toISOString(), lastResult: { checked: 0, imported: 0, error: null } });
      return { ran: true, checked: 0, imported: 0, catchingUp: true };
    }
    for (const id of ids) {
      checked++;
      if (await importMessage(id, token, s.email, now, { notify: true })) imported++;
    }
  }

  // Catching up: the last 60 days of the inbox, a page per check, oldest mail not notified.
  let backfill = s.backfill;
  if (backfill !== "done") {
    const q = new URLSearchParams({ q: "in:inbox newer_than:60d", maxResults: String(BACKFILL_PER_RUN), ...(backfill ? { pageToken: backfill } : {}) });
    const list = z
      .object({ messages: z.array(z.object({ id: z.string() })).optional(), nextPageToken: z.string().optional() })
      .parse(await gmailFetch(`/messages?${q}`, {}, token));
    for (const m of list.messages ?? []) {
      checked++;
      if (await importMessage(m.id, token, s.email, now, { notify: false })) imported++;
    }
    backfill = list.nextPageToken ?? "done";
  }

  const latest = (await stored()) ?? s;
  await save({ ...latest, historyId, backfill, lastSyncAt: now.toISOString(), lastResult: { checked, imported, error: null } });
  return { ran: true, checked, imported, catchingUp: backfill !== "done" };
}

/** Is Gmail the way email goes out right now? (For the composer's "Sends from …" line.) */
export async function gmailSender(): Promise<string | null> {
  const s = await stored();
  return s && !s.broken ? s.email : null;
}

/** Recent emails from a customer, newest first (the customer file). */
export async function inboundForCustomer(customerId: string, limit = 20) {
  return db
    .select({ id: inboundEmails.id, subject: inboundEmails.subject, fromName: inboundEmails.fromName, fromAddress: inboundEmails.fromAddress, receivedAt: inboundEmails.receivedAt, threadId: inboundEmails.threadId, bodyText: inboundEmails.bodyText })
    .from(inboundEmails)
    .where(and(eq(inboundEmails.customerId, customerId)))
    .orderBy(desc(inboundEmails.receivedAt))
    .limit(limit);
}
