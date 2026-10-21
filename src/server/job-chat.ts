import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appSettings, crewMembers, crews, jobChannelMembers, jobMessages, jobPhotos, projects, scheduleEntries, user, type JobMessageKind } from "@/db/schema";
import type { Role } from "@/db/schema/auth";
import type { ProjectStatus } from "@/db/schema/projects";
import { outer } from "@/db/sql";
import { can, ROLE_LABELS } from "@/lib/authz/permissions";
import { dayRangeInstants, todayIso, type IsoDate } from "@/lib/calendar-date";
import { calendarsFor, isWorkingDay } from "@/lib/schedule/working-days";
import { audit } from "./audit";
import { notify, notifyCollapsed, notifyLater } from "./notifications";
import { getScheduleSettings } from "./schedule-settings";

/*
 * One chat channel per job, like Slack. Who's in it:
 *   - the owner and operations managers, always (and the job's project manager);
 *   - everyone in a crew booked on the job (the colour consultant, pressure washer,
 *     carpenter, painters…), from the moment they're booked;
 *   - anyone the office adds by hand.
 * Other office staff who can see every job may read and post too, without being told
 * about each message. Field logins only ever reach channels they're in. Photos are
 * private to the channel. Nothing here reads money.
 */

export class ChatError extends Error {
  readonly expose = true;
}

export interface Viewer {
  id: string;
  role: Role;
  name?: string;
}

const ALWAYS_IN: Role[] = ["owner", "operations_manager"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GONE = "This job's chat isn't available to you.";
/** Booking kinds whose crews post an end-of-day update. */
const UPDATE_KINDS = ["work", "carpentry", "pressure_wash", "touch_up", "other"] as const;

type ProjectRow = { id: string; number: number | null; name: string; status: string; projectManagerId: string | null };

async function project(projectId: string): Promise<ProjectRow | null> {
  if (!UUID_RE.test(projectId)) return null;
  const [p] = await db
    .select({ id: projects.id, number: projects.number, name: projects.name, status: projects.status, projectManagerId: projects.projectManagerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return p ?? null;
}

/** Projects where `userId` is in a crew with a booking (any date). */
async function bookedProjectIds(userId: string, projectIds?: string[]): Promise<string[]> {
  const rows = await db
    .selectDistinct({ projectId: scheduleEntries.projectId })
    .from(scheduleEntries)
    .innerJoin(crewMembers, eq(crewMembers.crewId, scheduleEntries.crewId))
    .innerJoin(crews, eq(crews.id, scheduleEntries.crewId))
    .where(and(eq(crewMembers.userId, userId), eq(crews.active, true), isNull(scheduleEntries.deletedAt), projectIds ? inArray(scheduleEntries.projectId, projectIds) : undefined));
  return rows.map((r) => r.projectId);
}

async function manualProjectIds(userId: string, projectIds?: string[]): Promise<string[]> {
  const rows = await db
    .select({ projectId: jobChannelMembers.projectId })
    .from(jobChannelMembers)
    .where(and(eq(jobChannelMembers.userId, userId), eq(jobChannelMembers.manual, true), projectIds ? inArray(jobChannelMembers.projectId, projectIds) : undefined));
  return rows.map((r) => r.projectId);
}

export interface ChannelAccess {
  project: { id: string; number: number; title: string; status: string };
  /** Told about new messages. */
  member: boolean;
  /** May add and remove people. */
  canManage: boolean;
}

/** Whether `viewer` may open this job's channel, or null. */
export async function channelAccess(viewer: Viewer, projectId: string): Promise<ChannelAccess | null> {
  const p = await project(projectId);
  if (!p) return null;
  const office = can(viewer.role, "projects.read_all");
  const [booked, manual] = await Promise.all([bookedProjectIds(viewer.id, [p.id]), manualProjectIds(viewer.id, [p.id])]);
  const member = ALWAYS_IN.includes(viewer.role) || p.projectManagerId === viewer.id || booked.length > 0 || manual.length > 0;
  if (!office && !member) return null;
  if (!office && p.status === "cancelled") return null;
  // The full job name ("Kim Lee – Interior repaint"): many jobs are "Interior repaint".
  return { project: { id: p.id, number: p.number ?? 0, title: p.name, status: p.status }, member, canManage: can(viewer.role, "projects.write") };
}

/** Everyone told about this channel's messages (active logins only). */
export async function channelMemberIds(projectId: string): Promise<string[]> {
  const p = await project(projectId);
  if (!p) return [];
  const [always, booked, manual] = await Promise.all([
    db.select({ id: user.id }).from(user).where(and(eq(user.active, true), or(inArray(user.role, ALWAYS_IN), p.projectManagerId ? eq(user.id, p.projectManagerId) : undefined))),
    db
      .selectDistinct({ id: crewMembers.userId })
      .from(scheduleEntries)
      .innerJoin(crewMembers, eq(crewMembers.crewId, scheduleEntries.crewId))
      .innerJoin(crews, eq(crews.id, scheduleEntries.crewId))
      .innerJoin(user, eq(user.id, crewMembers.userId))
      .where(and(eq(scheduleEntries.projectId, p.id), isNull(scheduleEntries.deletedAt), eq(crews.active, true), eq(user.active, true))),
    db
      .select({ id: jobChannelMembers.userId })
      .from(jobChannelMembers)
      .innerJoin(user, eq(user.id, jobChannelMembers.userId))
      .where(and(eq(jobChannelMembers.projectId, p.id), eq(jobChannelMembers.manual, true), eq(user.active, true))),
  ]);
  return [...new Set([...always, ...booked, ...manual].map((r) => r.id))];
}

// ---------------------------------------------------------------------------
// Channel list
// ---------------------------------------------------------------------------

export interface ChannelSummary {
  projectId: string;
  projectNumber: number;
  title: string;
  status: string;
  lastAt: string | null;
  lastText: string | null;
  unread: number;
}

const ACTIVE_STATUSES: ProjectStatus[] = ["need_to_schedule", "scheduled", "in_progress", "walk_through", "on_hold"];

/** The channels `viewer` can open: busiest first, then active jobs. */
export async function listChannels(viewer: Viewer, limit = 100): Promise<ChannelSummary[]> {
  let ids: string[];
  if (can(viewer.role, "projects.read_all")) {
    const withMessages = await db
      .selectDistinct({ projectId: jobMessages.projectId })
      .from(jobMessages)
      .where(and(isNull(jobMessages.deletedAt), gt(jobMessages.createdAt, new Date(Date.now() - 120 * 86_400_000))));
    const active = await db.select({ id: projects.id }).from(projects).where(inArray(projects.status, ACTIVE_STATUSES)).orderBy(desc(projects.number)).limit(300);
    ids = [...new Set([...withMessages.map((r) => r.projectId), ...active.map((r) => r.id)])];
  } else {
    ids = [...new Set([...(await bookedProjectIds(viewer.id)), ...(await manualProjectIds(viewer.id))])];
  }
  if (!ids.length) return [];
  const lastAt = sql<Date | null>`(select max(${jobMessages.createdAt}) from ${jobMessages} where ${jobMessages.projectId} = ${outer(projects.id)} and ${jobMessages.deletedAt} is null)`;
  const lastText = sql<string | null>`(select case when ${jobMessages.kind} = 'daily_update' then 'Daily update: ' || ${jobMessages.body} else ${jobMessages.body} end from ${jobMessages}
    where ${jobMessages.projectId} = ${outer(projects.id)} and ${jobMessages.deletedAt} is null order by ${jobMessages.createdAt} desc limit 1)`;
  const unread = sql<number>`(select count(*)::int from ${jobMessages} where ${jobMessages.projectId} = ${outer(projects.id)} and ${jobMessages.deletedAt} is null
    and ${jobMessages.authorId} is distinct from ${viewer.id} and ${jobMessages.createdAt} > coalesce(${jobChannelMembers.lastReadAt}, 'epoch'::timestamptz))`;
  const rows = await db
    .select({ projectId: projects.id, number: projects.number, name: projects.name, status: projects.status, lastAt, lastText, unread })
    .from(projects)
    .leftJoin(jobChannelMembers, and(eq(jobChannelMembers.projectId, projects.id), eq(jobChannelMembers.userId, viewer.id)))
    .where(and(inArray(projects.id, ids), can(viewer.role, "projects.read_all") ? undefined : ne(projects.status, "cancelled")));
  return rows
    .map((r) => ({
      projectId: r.projectId,
      projectNumber: r.number ?? 0,
      title: r.name,
      status: r.status,
      lastAt: r.lastAt ? new Date(r.lastAt).toISOString() : null,
      lastText: r.lastText ? r.lastText.slice(0, 140) : null,
      unread: Number(r.unread) || 0,
    }))
    .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? "") || b.projectNumber - a.projectNumber)
    .slice(0, limit);
}

/** Unread messages across `viewer`'s channels (for the menu). */
export async function unreadTotal(viewer: Viewer): Promise<number> {
  const list = await listChannels(viewer, 300);
  return list.reduce((s, c) => s + c.unread, 0);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface PhotoDTO {
  id: string;
  width: number;
  height: number;
}

export interface MessageDTO {
  id: string;
  kind: JobMessageKind;
  body: string;
  percentComplete: number | null;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
  photos: PhotoDTO[];
  mine: boolean;
}

const PAGE = 50;

/** Newest last. `after` for polling, `before` for older pages. */
export async function listMessages(viewer: Viewer, projectId: string, opts: { after?: Date | null; before?: Date | null } = {}): Promise<{ messages: MessageDTO[]; hasMore: boolean } | null> {
  const access = await channelAccess(viewer, projectId);
  if (!access) return null;
  const rows = await db
    .select({ id: jobMessages.id, kind: jobMessages.kind, body: jobMessages.body, percent: jobMessages.percentComplete, authorId: jobMessages.authorId, authorName: user.name, createdAt: jobMessages.createdAt })
    .from(jobMessages)
    .leftJoin(user, eq(user.id, jobMessages.authorId))
    .where(
      and(
        eq(jobMessages.projectId, access.project.id),
        isNull(jobMessages.deletedAt),
        opts.after ? gt(jobMessages.createdAt, opts.after) : undefined,
        opts.before ? lt(jobMessages.createdAt, opts.before) : undefined,
      ),
    )
    .orderBy(opts.after ? asc(jobMessages.createdAt) : desc(jobMessages.createdAt))
    .limit(PAGE + 1);
  const hasMore = !opts.after && rows.length > PAGE;
  const page = (opts.after ? rows : rows.slice(0, PAGE).reverse()).slice(0, PAGE);
  const ids = page.map((m) => m.id);
  const photos = ids.length
    ? await db
        .select({ id: jobPhotos.id, messageId: jobPhotos.messageId, width: jobPhotos.width, height: jobPhotos.height })
        .from(jobPhotos)
        .where(inArray(jobPhotos.messageId, ids))
        .orderBy(asc(jobPhotos.createdAt))
    : [];
  return {
    hasMore,
    messages: page.map((m) => ({
      id: m.id,
      kind: m.kind,
      body: m.body,
      percentComplete: m.percent,
      authorId: m.authorId,
      authorName: m.authorName ?? (m.kind === "system" ? null : "Former user"),
      createdAt: m.createdAt.toISOString(),
      photos: photos.filter((p) => p.messageId === m.id).map((p) => ({ id: p.id, width: p.width, height: p.height })),
      mine: !!m.authorId && m.authorId === viewer.id,
    })),
  };
}

export const MAX_PHOTOS_PER_MESSAGE = 10;

export const postMessageSchema = z
  .object({
    body: z
      .string()
      .max(4000, "Keep the message under 4,000 characters.")
      .transform((s) => s.replace(/\r\n?/g, "\n").trim()),
    kind: z.enum(["message", "daily_update"]).default("message"),
    percentComplete: z.number().int().min(0).max(100).nullable().optional(),
    photoIds: z.array(z.string().uuid()).max(MAX_PHOTOS_PER_MESSAGE, `Up to ${MAX_PHOTOS_PER_MESSAGE} photos per message.`).default([]),
  })
  .refine((v) => v.body.length > 0 || v.photoIds.length > 0, "Write a message or add a photo.");

export async function postMessage(viewer: Viewer, projectId: string, raw: unknown): Promise<MessageDTO> {
  const input = postMessageSchema.parse(raw);
  const access = await channelAccess(viewer, projectId);
  if (!access) throw new ChatError(GONE);
  if (access.project.status === "cancelled") throw new ChatError("This job was cancelled.");
  const now = new Date();
  const message = await db.transaction(async (tx) => {
    const [m] = await tx
      .insert(jobMessages)
      .values({ projectId: access.project.id, authorId: viewer.id, kind: input.kind, body: input.body, percentComplete: input.kind === "daily_update" ? (input.percentComplete ?? null) : null, createdAt: now })
      .returning({ id: jobMessages.id });
    if (input.photoIds.length) {
      // Only the sender's own photos for this job that aren't on another message yet.
      const attached = await tx
        .update(jobPhotos)
        .set({ messageId: m.id })
        .where(and(inArray(jobPhotos.id, input.photoIds), eq(jobPhotos.projectId, access.project.id), eq(jobPhotos.uploadedBy, viewer.id), isNull(jobPhotos.messageId)))
        .returning({ id: jobPhotos.id });
      if (attached.length !== input.photoIds.length) throw new ChatError("A photo didn't finish uploading. Remove it and try again.");
    }
    await tx
      .insert(jobChannelMembers)
      .values({ projectId: access.project.id, userId: viewer.id, lastReadAt: now })
      .onConflictDoUpdate({ target: [jobChannelMembers.projectId, jobChannelMembers.userId], set: { lastReadAt: now } });
    return m;
  });

  const who = viewer.name?.split(" ")[0] || "Someone";
  const snippet = input.body ? input.body.replace(/\s+/g, " ").slice(0, 140) : `${input.photoIds.length} ${input.photoIds.length === 1 ? "photo" : "photos"}`;
  notifyLater(async () => {
    const ids = (await channelMemberIds(access.project.id)).filter((id) => id !== viewer.id);
    await notifyCollapsed(ids, {
      kind: "chat.message",
      title: input.kind === "daily_update" ? `Daily update on #${access.project.number} ${access.project.title}` : `${who} in #${access.project.number} ${access.project.title}`,
      body: input.kind === "daily_update" ? `${who}${input.percentComplete != null ? ` · ${input.percentComplete}% done` : ""}: ${snippet}` : snippet,
      href: `/chat/${access.project.id}`,
      entityType: "project",
      entityId: access.project.id,
    });
  });

  const [row] = (await listMessages(viewer, access.project.id, { after: new Date(now.getTime() - 1) }))?.messages.filter((x) => x.id === message.id) ?? [];
  return row;
}

/** Notes the app posts itself ("Colours signed by Kim Lee"). Never throws. */
export async function postSystemMessage(projectId: string, body: string): Promise<void> {
  try {
    if (!UUID_RE.test(projectId)) return;
    await db.insert(jobMessages).values({ projectId, kind: "system", body: body.slice(0, 1000) });
  } catch (e) {
    console.error("[chat] could not post a system message", e instanceof Error ? e.message : e);
  }
}

export async function markChannelRead(viewer: Viewer, projectId: string): Promise<void> {
  const access = await channelAccess(viewer, projectId);
  if (!access) return;
  const now = new Date();
  await db
    .insert(jobChannelMembers)
    .values({ projectId: access.project.id, userId: viewer.id, lastReadAt: now })
    .onConflictDoUpdate({ target: [jobChannelMembers.projectId, jobChannelMembers.userId], set: { lastReadAt: now } });
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export const PHOTO_MAX_BYTES = 3 * 1024 * 1024;
export const THUMB_MAX_BYTES = 400 * 1024;

/** The real type from the file's first bytes; the browser's word for it isn't trusted. */
export function sniffImage(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

const dims = z.coerce.number().int().min(1).max(10000);

/** A photo the sender has made smaller in the browser, plus its thumbnail. It joins a message when that is posted. */
export async function savePhoto(viewer: Viewer, projectId: string, input: { data: Uint8Array; thumb: Uint8Array; width: unknown; height: unknown }): Promise<PhotoDTO> {
  const access = await channelAccess(viewer, projectId);
  if (!access) throw new ChatError(GONE);
  const width = dims.parse(input.width);
  const height = dims.parse(input.height);
  if (!input.data.length || input.data.length > PHOTO_MAX_BYTES) throw new ChatError("That photo is too big. Try a smaller one.");
  if (!input.thumb.length || input.thumb.length > THUMB_MAX_BYTES) throw new ChatError("That photo couldn't be read. Try another one.");
  const contentType = sniffImage(input.data);
  if (!contentType || !sniffImage(input.thumb)) throw new ChatError("Only JPEG, PNG or WebP photos can be posted.");
  const [row] = await db
    .insert(jobPhotos)
    .values({
      projectId: access.project.id,
      uploadedBy: viewer.id,
      contentType,
      byteSize: input.data.length,
      width,
      height,
      data: Buffer.from(input.data),
      thumb: Buffer.from(input.thumb),
      sha256: createHash("sha256").update(input.data).digest("hex"),
    })
    .returning({ id: jobPhotos.id });
  return { id: row.id, width, height };
}

/** A photo for someone in the channel, or null (also for a photo not yet on a message, except to its sender). */
export async function photoFile(viewer: Viewer, projectId: string, photoId: string, variant: "full" | "thumb"): Promise<{ contentType: string; data: Buffer; sha256: string } | null> {
  if (!UUID_RE.test(photoId)) return null;
  const access = await channelAccess(viewer, projectId);
  if (!access) return null;
  const [p] = await db
    .select({
      contentType: jobPhotos.contentType,
      data: variant === "full" ? jobPhotos.data : jobPhotos.thumb,
      sha256: jobPhotos.sha256,
      messageId: jobPhotos.messageId,
      uploadedBy: jobPhotos.uploadedBy,
    })
    .from(jobPhotos)
    .where(and(eq(jobPhotos.id, photoId), eq(jobPhotos.projectId, access.project.id)))
    .limit(1);
  if (!p || (!p.messageId && p.uploadedBy !== viewer.id)) return null;
  return { contentType: variant === "full" ? p.contentType : (sniffImage(p.data) ?? "image/jpeg"), data: p.data, sha256: p.sha256 };
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export interface ChannelMember {
  id: string;
  name: string;
  roleLabel: string;
  why: "always" | "project_manager" | "booked" | "added";
  removable: boolean;
}

export async function channelMembers(projectId: string): Promise<{ members: ChannelMember[]; candidates: { id: string; name: string; roleLabel: string }[] }> {
  const p = await project(projectId);
  if (!p) return { members: [], candidates: [] };
  const [everyone, booked, manual] = await Promise.all([
    db.select({ id: user.id, name: user.name, role: user.role }).from(user).where(eq(user.active, true)).orderBy(asc(user.name)),
    db
      .selectDistinct({ id: crewMembers.userId })
      .from(scheduleEntries)
      .innerJoin(crewMembers, eq(crewMembers.crewId, scheduleEntries.crewId))
      .innerJoin(crews, eq(crews.id, scheduleEntries.crewId))
      .where(and(eq(scheduleEntries.projectId, p.id), isNull(scheduleEntries.deletedAt), eq(crews.active, true))),
    db.select({ id: jobChannelMembers.userId }).from(jobChannelMembers).where(and(eq(jobChannelMembers.projectId, p.id), eq(jobChannelMembers.manual, true))),
  ]);
  const bookedIds = new Set(booked.map((b) => b.id));
  const manualIds = new Set(manual.map((m) => m.id));
  const why = (u: { id: string; role: Role }): ChannelMember["why"] | null =>
    ALWAYS_IN.includes(u.role) ? "always" : u.id === p.projectManagerId ? "project_manager" : bookedIds.has(u.id) ? "booked" : manualIds.has(u.id) ? "added" : null;
  const members: ChannelMember[] = [];
  const candidates: { id: string; name: string; roleLabel: string }[] = [];
  for (const u of everyone) {
    const w = why(u);
    if (w) members.push({ id: u.id, name: u.name, roleLabel: ROLE_LABELS[u.role], why: w, removable: w === "added" });
    else candidates.push({ id: u.id, name: u.name, roleLabel: ROLE_LABELS[u.role] });
  }
  const order = { always: 0, project_manager: 1, booked: 2, added: 3 };
  members.sort((a, b) => order[a.why] - order[b.why] || a.name.localeCompare(b.name));
  return { members, candidates };
}

const memberSchema = z.object({ projectId: z.string().uuid(), userId: z.string().min(1).max(100) });

/** Callers check projects.write. */
export async function addChannelMember(actor: Viewer, raw: unknown): Promise<{ projectId: string }> {
  const { projectId, userId } = memberSchema.parse(raw);
  const p = await project(projectId);
  if (!p) throw new ChatError("This job no longer exists.");
  const [u] = await db.select({ id: user.id, name: user.name, active: user.active }).from(user).where(eq(user.id, userId)).limit(1);
  if (!u?.active) throw new ChatError("That person no longer has a login.");
  await db
    .insert(jobChannelMembers)
    .values({ projectId: p.id, userId: u.id, manual: true, addedBy: actor.id, addedAt: new Date() })
    .onConflictDoUpdate({ target: [jobChannelMembers.projectId, jobChannelMembers.userId], set: { manual: true, addedBy: actor.id, addedAt: new Date() } });
  await audit({ actorId: actor.id, action: "chat.member_add", entityType: "project", entityId: p.id, after: { userId: u.id } });
  await postSystemMessage(p.id, `${u.name} was added to this chat.`);
  return { projectId: p.id };
}

/** Only people added by hand can be removed; the rest are in because of their role or a booking. */
export async function removeChannelMember(actor: Viewer, raw: unknown): Promise<{ projectId: string }> {
  const { projectId, userId } = memberSchema.parse(raw);
  const [row] = await db
    .update(jobChannelMembers)
    .set({ manual: false })
    .where(and(eq(jobChannelMembers.projectId, projectId), eq(jobChannelMembers.userId, userId), eq(jobChannelMembers.manual, true)))
    .returning({ projectId: jobChannelMembers.projectId });
  if (!row) throw new ChatError("That person can't be removed: they're in this chat because of their role or a booking.");
  await audit({ actorId: actor.id, action: "chat.member_remove", entityType: "project", entityId: projectId, after: { userId } });
  return { projectId };
}

// ---------------------------------------------------------------------------
// The 4 pm reminder
// ---------------------------------------------------------------------------

const REMINDER_SETTING = "daily_update_reminders";

/** The hour (0–23) in Vancouver. */
export function vancouverHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", hour: "numeric", hourCycle: "h23" }).format(now));
}

/**
 * At 4 pm Vancouver time: for each crew booked on a job today (a working day for that
 * crew), if nobody in the crew has posted today's update in the job's chat, remind the
 * crew lead (or everyone in the crew when there's no lead). Runs once a day.
 */
export async function sendDailyUpdateReminders(now: Date = new Date(), opts: { force?: boolean } = {}): Promise<{ ran: boolean; reminded: number }> {
  if (!opts.force && vancouverHour(now) !== 16) return { ran: false, reminded: 0 };
  const today: IsoDate = todayIso(now);
  const [last] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, REMINDER_SETTING)).limit(1);
  if (!opts.force && (last?.value as { lastDay?: string } | undefined)?.lastDay === today) return { ran: false, reminded: 0 };
  await db
    .insert(appSettings)
    .values({ key: REMINDER_SETTING, value: { lastDay: today } })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: { lastDay: today }, updatedAt: now } });

  const booked = await db
    .select({ projectId: scheduleEntries.projectId, crewId: crews.id, worksSaturdays: crews.worksSaturdays, number: projects.number, name: projects.name })
    .from(scheduleEntries)
    .innerJoin(crews, eq(crews.id, scheduleEntries.crewId))
    .innerJoin(projects, eq(projects.id, scheduleEntries.projectId))
    .where(
      and(
        isNull(scheduleEntries.deletedAt),
        sql`${scheduleEntries.startDate} <= ${today}`,
        sql`${scheduleEntries.endDate} >= ${today}`,
        inArray(scheduleEntries.kind, [...UPDATE_KINDS]),
        eq(crews.active, true),
        notInArray(projects.status, ["cancelled", "closed", "complete", "invoiced"]),
      ),
    );
  if (!booked.length) return { ran: true, reminded: 0 };
  const settings = await getScheduleSettings();
  const { calFor } = calendarsFor(settings, today, today);
  const pairs = [...new Map(booked.filter((b) => isWorkingDay(today, calFor({ worksSaturdays: b.worksSaturdays }))).map((b) => [`${b.projectId}|${b.crewId}`, b])).values()];
  if (!pairs.length) return { ran: true, reminded: 0 };

  const crewIds = [...new Set(pairs.map((p) => p.crewId))];
  const members = await db
    .select({ crewId: crewMembers.crewId, userId: crewMembers.userId, isLead: crewMembers.isLead })
    .from(crewMembers)
    .innerJoin(user, eq(user.id, crewMembers.userId))
    .where(and(inArray(crewMembers.crewId, crewIds), eq(user.active, true)));
  const { start, end } = dayRangeInstants(today, today);
  const posted = await db
    .select({ projectId: jobMessages.projectId, authorId: jobMessages.authorId })
    .from(jobMessages)
    .where(and(inArray(jobMessages.projectId, [...new Set(pairs.map((p) => p.projectId))]), eq(jobMessages.kind, "daily_update"), isNull(jobMessages.deletedAt), sql`${jobMessages.createdAt} >= ${start}`, sql`${jobMessages.createdAt} < ${end}`));

  let reminded = 0;
  for (const pair of pairs) {
    const crew = members.filter((m) => m.crewId === pair.crewId);
    if (!crew.length) continue;
    if (posted.some((p) => p.projectId === pair.projectId && crew.some((m) => m.userId === p.authorId))) continue;
    const leads = crew.filter((m) => m.isLead);
    const to = (leads.length ? leads : crew).map((m) => m.userId);
    await notify(to, {
      kind: "chat.reminder",
      title: `Daily update for #${pair.number} ${pair.name}`,
      body: "Post a few photos and how far you got today.",
      href: `/chat/${pair.projectId}?update=1`,
      entityType: "project",
      entityId: pair.projectId,
    });
    reminded += to.length;
  }
  return { ran: true, reminded };
}
