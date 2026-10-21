import "server-only";
import { and, asc, count, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { outer } from "@/db/sql";
import { crewMembers, crews, projects, scheduleEntries, user } from "@/db/schema";
import { todayIso } from "@/lib/calendar-date";
import { crewActiveSchema, crewMembersSchema, crewSchema, reorderCrewsSchema } from "@/lib/schedule/schemas";
import type { CrewDTO, CrewMemberDTO, CrewWithMembersDTO } from "@/lib/schedule/types";
import { audit } from "./audit";

/*
 * Crews and their members. Adding someone to a crew is an access grant (they see
 * that crew's jobs, addresses and, as lead, the customer's phone on /my-jobs), so
 * every change is audited with before/after. Callers check schedule.manage.
 */

export class CrewError extends Error {
  readonly expose = true;
}

type Actor = { id: string };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const memberCount = sql<number>`(select count(*)::int from ${crewMembers} where ${crewMembers.crewId} = ${outer(crews.id)})`;

const crewColumns = {
  id: crews.id,
  name: crews.name,
  kind: crews.kind,
  trade: crews.trade,
  subCompany: crews.subCompany,
  color: crews.color,
  crewSize: crews.crewSize,
  hoursPerDay: crews.hoursPerDay,
  worksSaturdays: crews.worksSaturdays,
  active: crews.active,
  sortOrder: crews.sortOrder,
  notes: crews.notes,
  memberCount,
};

interface CrewRow {
  id: string;
  name: string;
  kind: CrewDTO["kind"];
  trade: CrewDTO["trade"];
  subCompany: string | null;
  color: CrewDTO["color"];
  crewSize: number;
  hoursPerDay: string;
  worksSaturdays: boolean;
  active: boolean;
  sortOrder: number;
  memberCount: number | string;
}

export function toCrewDTO(r: CrewRow): CrewDTO {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    trade: r.trade,
    subCompany: r.subCompany,
    color: r.color,
    crewSize: r.crewSize,
    hoursPerDay: r.hoursPerDay,
    worksSaturdays: r.worksSaturdays,
    active: r.active,
    sortOrder: r.sortOrder,
    memberCount: Number(r.memberCount) || 0,
  };
}

export async function listCrews(opts: { includeInactive?: boolean; withMembers: true }): Promise<CrewWithMembersDTO[]>;
export async function listCrews(opts?: { includeInactive?: boolean; withMembers?: false }): Promise<CrewDTO[]>;
export async function listCrews(opts: { includeInactive?: boolean; withMembers?: boolean } = {}): Promise<CrewDTO[] | CrewWithMembersDTO[]> {
  const rows = await db
    .select(crewColumns)
    .from(crews)
    .where(opts.includeInactive ? undefined : eq(crews.active, true))
    .orderBy(asc(crews.sortOrder), asc(crews.name));
  if (!opts.withMembers) return rows.map(toCrewDTO);
  const members = await membersOf(rows.map((r) => r.id));
  return rows.map((r) => ({ ...toCrewDTO(r), notes: r.notes, members: members.get(r.id) ?? [] }));
}

async function membersOf(crewIds: string[]): Promise<Map<string, CrewMemberDTO[]>> {
  const out = new Map<string, CrewMemberDTO[]>();
  if (!crewIds.length) return out;
  const rows = await db
    .select({ crewId: crewMembers.crewId, userId: crewMembers.userId, name: user.name, role: user.role, active: user.active, isLead: crewMembers.isLead })
    .from(crewMembers)
    .innerJoin(user, eq(user.id, crewMembers.userId))
    .where(inArray(crewMembers.crewId, crewIds))
    .orderBy(sql`${crewMembers.isLead} desc`, asc(user.name));
  for (const r of rows) out.set(r.crewId, [...(out.get(r.crewId) ?? []), { userId: r.userId, name: r.name, role: r.role, active: r.active, isLead: r.isLead }]);
  return out;
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

/** Create (no id) or update a crew. */
export async function saveCrew(raw: unknown, actor: Actor): Promise<{ id: string }> {
  const input = crewSchema.parse(raw);
  const values = {
    name: input.name,
    kind: input.kind,
    trade: input.trade,
    subCompany: input.subCompany,
    color: input.color,
    crewSize: input.crewSize,
    hoursPerDay: input.hoursPerDay,
    worksSaturdays: input.worksSaturdays,
    notes: input.notes,
  };
  try {
    return await db.transaction(async (tx) => {
      const [clash] = await tx
        .select({ id: crews.id })
        .from(crews)
        .where(and(sql`lower(${crews.name}) = lower(${input.name})`, input.id ? ne(crews.id, input.id) : undefined));
      if (clash) throw new CrewError("A crew with that name already exists.");

      if (!input.id) {
        const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${crews.sortOrder}), -1)::int + 1` }).from(crews);
        const [row] = await tx
          .insert(crews)
          .values({ ...values, sortOrder: Number(next) || 0, createdBy: actor.id })
          .returning({ id: crews.id });
        await audit({ actorId: actor.id, action: "schedule.crew.save", entityType: "crew", entityId: row.id, after: values }, tx);
        return { id: row.id };
      }

      const [before] = await tx.select().from(crews).where(eq(crews.id, input.id)).for("update");
      if (!before) throw new CrewError("Crew not found.");
      await tx
        .update(crews)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(crews.id, input.id));
      const was = Object.fromEntries(Object.keys(values).map((k) => [k, before[k as keyof typeof before]]));
      await audit({ actorId: actor.id, action: "schedule.crew.save", entityType: "crew", entityId: input.id, before: was, after: values }, tx);
      return { id: input.id };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new CrewError("A crew with that name already exists.");
    throw e;
  }
}

/** Deactivating is refused while the crew still has bookings ending today or later. */
export async function setCrewActive(raw: unknown, actor: Actor): Promise<void> {
  const input = crewActiveSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [crew] = await tx.select({ id: crews.id, active: crews.active }).from(crews).where(eq(crews.id, input.id)).for("update");
    if (!crew) throw new CrewError("Crew not found.");
    if (crew.active === input.active) return;
    if (!input.active) {
      const [{ n }] = await tx
        .select({ n: count() })
        .from(scheduleEntries)
        .innerJoin(projects, eq(projects.id, scheduleEntries.projectId))
        .where(and(eq(scheduleEntries.crewId, input.id), isNull(scheduleEntries.deletedAt), gte(scheduleEntries.endDate, todayIso()), ne(projects.status, "cancelled")));
      if (Number(n) > 0) throw new CrewError(`Move its ${n} upcoming booking${Number(n) === 1 ? "" : "s"} first.`);
    }
    await tx.update(crews).set({ active: input.active, updatedAt: new Date() }).where(eq(crews.id, input.id));
    await audit({ actorId: actor.id, action: "schedule.crew.active", entityType: "crew", entityId: input.id, before: { active: crew.active }, after: { active: input.active } }, tx);
  });
}

/** Replace a crew's members. Members must be active users; at most one lead. */
export async function setCrewMembers(raw: unknown, actor: Actor): Promise<void> {
  const input = crewMembersSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [crew] = await tx.select({ id: crews.id }).from(crews).where(eq(crews.id, input.crewId)).for("update");
    if (!crew) throw new CrewError("Crew not found.");
    const ids = input.members.map((m) => m.userId);
    if (ids.length) {
      const found = await tx.select({ id: user.id, active: user.active }).from(user).where(inArray(user.id, ids));
      const active = new Set(found.filter((u) => u.active).map((u) => u.id));
      if (ids.some((id) => !active.has(id))) throw new CrewError("Crew members must be active users.");
    }
    const before = await tx
      .select({ userId: crewMembers.userId, isLead: crewMembers.isLead })
      .from(crewMembers)
      .where(eq(crewMembers.crewId, input.crewId))
      .orderBy(asc(crewMembers.userId));
    await tx.delete(crewMembers).where(eq(crewMembers.crewId, input.crewId));
    if (input.members.length) {
      await tx.insert(crewMembers).values(input.members.map((m) => ({ crewId: input.crewId, userId: m.userId, isLead: m.isLead, addedBy: actor.id })));
    }
    const after = [...input.members].sort((a, b) => (a.userId < b.userId ? -1 : 1));
    await audit({ actorId: actor.id, action: "schedule.crew.members", entityType: "crew", entityId: input.crewId, before, after }, tx);
  });
}

/** Set the calendar order: ids in the new order (sort_order = position). */
export async function reorderCrews(raw: unknown, actor: Actor): Promise<void> {
  const input = reorderCrewsSchema.parse(raw);
  await db.transaction(async (tx) => {
    const found = await tx.select({ id: crews.id, sortOrder: crews.sortOrder }).from(crews).where(inArray(crews.id, input.ids));
    if (found.length !== input.ids.length) throw new CrewError("A crew in that list no longer exists. Refresh the page.");
    for (const [i, id] of input.ids.entries()) await tx.update(crews).set({ sortOrder: i, updatedAt: new Date() }).where(eq(crews.id, id));
    const before = Object.fromEntries(found.map((c) => [c.id, c.sortOrder]));
    await audit({ actorId: actor.id, action: "schedule.crew.reorder", entityType: "crew", entityId: null, before, after: Object.fromEntries(input.ids.map((id, i) => [id, i])) }, tx);
  });
}

/** The active crews a user belongs to. */
export async function crewIdsForUser(userId: string): Promise<{ crewId: string; isLead: boolean }[]> {
  if (!userId) return [];
  return db
    .select({ crewId: crewMembers.crewId, isLead: crewMembers.isLead })
    .from(crewMembers)
    .innerJoin(crews, eq(crews.id, crewMembers.crewId))
    .where(and(eq(crewMembers.userId, userId), eq(crews.active, true)));
}

/** Members by crew id (for person double-booking checks). */
export async function memberIdsByCrew(crewIds: string[]): Promise<Map<string, string[]>> {
  const ids = crewIds.filter((id) => UUID_RE.test(id));
  const out = new Map<string, string[]>();
  if (!ids.length) return out;
  const rows = await db.select({ crewId: crewMembers.crewId, userId: crewMembers.userId }).from(crewMembers).where(inArray(crewMembers.crewId, ids));
  for (const r of rows) out.set(r.crewId, [...(out.get(r.crewId) ?? []), r.userId]);
  return out;
}
