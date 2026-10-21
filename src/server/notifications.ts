import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { after } from "next/server";
import webpush from "web-push";
import { z } from "zod";
import { db } from "@/db";
import { appSettings, customers, estimates, notifications, proposals, pushSubscriptions, user } from "@/db/schema";
import type { Role } from "@/db/schema/auth";
import { can } from "@/lib/authz/permissions";
import { formatCAD } from "@/lib/money";

// Never cache: each person sees only their own notices.

export interface NewNotification {
  kind: string;
  title: string;
  body?: string | null;
  /** A path inside the app. */
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

export interface NotificationDTO {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: string;
  read: boolean;
}

/** Office roles that hear about every estimate. */
const ALWAYS_TOLD: Role[] = ["owner", "admin", "operations_manager"];
const VAPID_SETTING = "web_push_vapid";

// ---------------------------------------------------------------------------
// Web Push keys: from the environment when set, otherwise made once and kept in
// app_settings. The private key never leaves the server.
// ---------------------------------------------------------------------------

interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

let cachedKeys: VapidKeys | null = null;

async function vapidKeys(): Promise<VapidKeys> {
  if (cachedKeys) return cachedKeys;
  const subject = process.env.VAPID_SUBJECT || `mailto:${process.env.EMAIL_FROM?.match(/<?([^<>\s]+@[^<>\s]+)>?/)?.[1] ?? "info@grandviewpainting.ca"}`;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    cachedKeys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject };
    return cachedKeys;
  }
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, VAPID_SETTING) });
  const stored = z.object({ publicKey: z.string().min(20), privateKey: z.string().min(20) }).safeParse(row?.value);
  if (stored.success) {
    cachedKeys = { ...stored.data, subject };
    return cachedKeys;
  }
  const made = webpush.generateVAPIDKeys();
  // If two servers race, the first saved pair wins and both use it.
  await db.insert(appSettings).values({ key: VAPID_SETTING, value: made }).onConflictDoNothing({ target: appSettings.key });
  const saved = await db.query.appSettings.findFirst({ where: eq(appSettings.key, VAPID_SETTING) });
  const keys = z.object({ publicKey: z.string(), privateKey: z.string() }).parse(saved?.value ?? made);
  cachedKeys = { ...keys, subject };
  return cachedKeys;
}

export async function vapidPublicKey(): Promise<string> {
  return (await vapidKeys()).publicKey;
}

async function push(userIds: string[], n: NewNotification) {
  const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds));
  if (!subs.length) return;
  const keys = await vapidKeys();
  const payload = JSON.stringify({ title: n.title, body: n.body ?? "", href: n.href ?? "/", tag: n.entityId ? `${n.kind}:${n.entityId}` : n.kind });
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          vapidDetails: keys,
          TTL: 60 * 60 * 24,
          urgency: "normal",
        });
        await db.update(pushSubscriptions).set({ lastSuccessAt: new Date(), failureCount: 0 }).where(eq(pushSubscriptions.id, s.id));
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410: the browser dropped this subscription, so forget it.
        if (status === 404 || status === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        else await db.update(pushSubscriptions).set({ failureCount: sql`${pushSubscriptions.failureCount} + 1` }).where(eq(pushSubscriptions.id, s.id));
      }
    }),
  );
}

/** Saves a notice for each person and pushes it to their devices. Never throws: a notice must not break the action behind it. */
export async function notify(userIds: string[], n: NewNotification): Promise<void> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  try {
    await db.insert(notifications).values(
      ids.map((userId) => ({ userId, kind: n.kind, title: n.title, body: n.body ?? null, href: n.href ?? null, entityType: n.entityType ?? null, entityId: n.entityId ?? null })),
    );
    await push(ids, n);
  } catch (e) {
    console.error("[notifications] could not notify", n.kind, e instanceof Error ? e.message : e);
  }
}

/** Runs a notice after the response is sent, so the customer or user never waits for it. */
export function notifyLater(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    // Outside a request (scripts, tests): just run it.
    void task();
  }
}

/** Active office people who hear about every job (owner, admins, operations managers), plus `extra` user ids, minus `except`. */
export async function officeRecipients(extra: (string | null | undefined)[] = [], except?: string | null): Promise<{ id: string; role: Role }[]> {
  const office = await db
    .select({ id: user.id, role: user.role })
    .from(user)
    .where(and(eq(user.active, true), inArray(user.role, ALWAYS_TOLD)));
  const ids = extra.filter((x): x is string => !!x);
  const more = ids.length ? await db.select({ id: user.id, role: user.role }).from(user).where(and(eq(user.active, true), inArray(user.id, ids))) : [];
  return [...office, ...more].filter((u, i, all) => all.findIndex((x) => x.id === u.id) === i && u.id !== except);
}

export type ProposalEvent = "viewed" | "accepted" | "declined";

/**
 * Tells the office when a customer opens, accepts or declines a proposal: the owner,
 * admins and operations managers, plus whoever prepared the estimate. Amounts only
 * go to people allowed to see company financials. Never throws.
 */
export async function notifyProposalEvent(event: ProposalEvent, proposalId: string, opts: { reopened?: boolean; actorId?: string | null } = {}): Promise<void> {
  try {
    const [row] = await db
      .select({
        estimateId: estimates.id,
        number: estimates.number,
        title: estimates.title,
        estimatorId: estimates.estimatorId,
        createdBy: estimates.createdBy,
        customer: customers.displayName,
        acceptedTotals: proposals.acceptedTotals,
        acceptedName: proposals.acceptedName,
        acceptedMethod: proposals.acceptedMethod,
      })
      .from(proposals)
      .innerJoin(estimates, eq(estimates.id, proposals.estimateId))
      .innerJoin(customers, eq(customers.id, estimates.customerId))
      .where(eq(proposals.id, proposalId));
    if (!row) return;

    const recipients = await officeRecipients([row.estimatorId, row.createdBy], opts.actorId);
    if (!recipients.length) return;

    const who = row.customer;
    const job = row.title ? ` (${row.title})` : "";
    const base = { kind: `proposal.${event}`, href: `/estimates/${row.estimateId}`, entityType: "proposal", entityId: proposalId };
    if (event === "accepted") {
      const total = (row.acceptedTotals as Record<string, string> | null)?.price;
      const how = row.acceptedMethod && row.acceptedMethod !== "online" ? ` – marked accepted for them` : "";
      const withMoney = recipients.filter((u) => can(u.role, "financials.read")).map((u) => u.id);
      const without = recipients.filter((u) => !can(u.role, "financials.read")).map((u) => u.id);
      const title = `${who} accepted their proposal${how}`;
      await notify(withMoney, { ...base, title, body: `Estimate #${row.number}${job}${total ? ` · ${formatCAD(total)} + GST` : ""}. The job has been created.` });
      await notify(without, { ...base, title, body: `Estimate #${row.number}${job}. The job has been created.` });
      return;
    }
    const title = event === "viewed" ? (opts.reopened ? `${who} opened their proposal again` : `${who} opened their proposal`) : `${who} declined their proposal`;
    await notify(
      recipients.map((u) => u.id),
      { ...base, title, body: `Estimate #${row.number}${job}` },
    );
  } catch (e) {
    console.error("[notifications] proposal event failed", event, e instanceof Error ? e.message : e);
  }
}

export async function listNotifications(userId: string, limit = 30): Promise<{ items: NotificationDTO[]; unread: number }> {
  const [rows, [count]] = await Promise.all([
    db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(Math.min(Math.max(limit, 1), 100)),
    db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);
  return {
    items: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, href: r.href, createdAt: r.createdAt.toISOString(), read: !!r.readAt })),
    unread: Number(count?.n ?? 0),
  };
}

/** Marks some or all of a person's notices read. Only ever their own. */
export async function markRead(userId: string, ids: string[] | "all"): Promise<void> {
  const mine = eq(notifications.userId, userId);
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(mine, isNull(notifications.readAt), ids === "all" ? undefined : inArray(notifications.id, ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])));
}

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000).startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(10).max(500), auth: z.string().min(10).max(500) }),
});

export async function savePushSubscription(userId: string, raw: unknown, userAgent: string | null): Promise<void> {
  const sub = pushSubscriptionSchema.parse(raw);
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, failureCount: 0 } });
}

export async function deletePushSubscription(userId: string, endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}
