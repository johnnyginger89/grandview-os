import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { contacts, crewMembers, crews, customers, estimates, opportunities, projects, projectScheduling, properties, scheduleEntries } from "@/db/schema";
import type { ProjectStatus } from "@/db/schema/projects";
import { addDays, todayIso, type IsoDate } from "@/lib/calendar-date";
import { isTentative } from "@/lib/schedule/confirmation";
import type { ScheduleEntryKind, StartConfirmation } from "@/lib/schedule/constants";
import { startOfWeek } from "@/lib/schedule/dates";
import { jobTitle, kindLabel } from "@/lib/schedule/format";
import type { FieldJobView } from "@/lib/schedule/types";
import { calendarsFor, countWorkingDays, isWorkingDay, type WorkCalendar } from "@/lib/schedule/working-days";
import { formatAddress, fullName, mapsUrl } from "@/lib/utils";
import { getScheduleSettings } from "./schedule-settings";

/*
 * The crew-safe projection behind /my-jobs. Field users see only bookings of the
 * active crews they belong to, from a week ago to 60 days ahead. The query names
 * every column it reads (no prices, no hours, no internal notes, no readiness), and
 * toFieldJobView copies fields one by one. Only crew leads get the customer's phone.
 * An architecture test keeps money and hour identifiers out of this file.
 */

export type { FieldJobView };

export const RECENT_DAYS = 7;
export const AHEAD_DAYS = 60;

/** Exactly what listFieldJobs reads from the database for one booking. */
export interface FieldJobRow {
  entryId: string;
  kind: ScheduleEntryKind;
  phaseLabel: string | null;
  startDate: IsoDate;
  endDate: IsoDate;
  crewNotes: string | null;
  crewId: string;
  crewName: string;
  worksSaturdays: boolean;
  /** For the job's chat link. */
  projectId: string;
  projectNumber: number | null;
  projectName: string;
  estimateTitle: string | null;
  projectStatus: ProjectStatus;
  confirmation: StartConfirmation | null;
  customerName: string;
  street: string | null;
  unit: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  accessNotes: string | null;
  builtBefore1990: boolean | null;
  projectTypes: string[] | null;
  /** Filled for lead crews only. */
  contactFirstName?: string | null;
  contactLastName?: string | null;
  contactPhone?: string | null;
  customerPhone?: string | null;
}

function sectionOf(start: IsoDate, end: IsoDate, today: IsoDate): FieldJobView["section"] {
  if (end < today) return "recent";
  if (start <= today) return "today";
  return start <= addDays(startOfWeek(today, 1), 6) ? "this_week" : "upcoming";
}

/** Pure, field-by-field whitelist. Exported for tests. */
export function toFieldJobView(row: FieldJobRow, opts: { isLead: boolean; today: IsoDate; cal: WorkCalendar }): FieldJobView {
  const section = sectionOf(row.startDate, row.endDate, opts.today);
  const workingDays = countWorkingDays(row.startDate, row.endDate, opts.cal);
  const dayNumber = section === "today" && isWorkingDay(opts.today, opts.cal) ? countWorkingDays(row.startDate, opts.today, opts.cal) : null;
  const address = row.street ? formatAddress({ street: row.street, unit: row.unit, city: row.city, province: row.province, postalCode: row.postalCode }) : null;
  const phone = (row.contactPhone || row.customerPhone || "").trim();
  const contactName = fullName(row.contactFirstName, row.contactLastName) || row.customerName;
  return {
    entryId: row.entryId,
    projectId: row.projectId,
    kind: row.kind,
    kindLabel: kindLabel(row.kind),
    phaseLabel: row.phaseLabel,
    startDate: row.startDate,
    endDate: row.endDate,
    workingDays,
    dayNumber,
    section,
    crewName: row.crewName,
    tentative: isTentative(row.kind, row.confirmation ?? "none"),
    onHold: row.projectStatus === "on_hold",
    projectNumber: row.projectNumber ?? 0,
    jobTitle: jobTitle(row.projectName, row.estimateTitle),
    customerName: row.customerName,
    projectTypes: [...(row.projectTypes ?? [])],
    address,
    mapsUrl: address ? mapsUrl(address) : null,
    accessNotes: row.accessNotes?.trim() || null,
    builtBefore1990: row.builtBefore1990 === true,
    crewNotes: row.crewNotes?.trim() || null,
    contact: opts.isLead && phone ? { name: contactName, phone } : null,
  };
}

/** The signed-in user's crew bookings (any role; empty when they're in no crew). */
export async function listFieldJobs(viewer: { id: string }, now: Date = new Date()): Promise<FieldJobView[]> {
  if (!viewer.id) return [];
  const memberships = await db
    .select({ crewId: crewMembers.crewId, isLead: crewMembers.isLead })
    .from(crewMembers)
    .innerJoin(crews, eq(crews.id, crewMembers.crewId))
    .where(and(eq(crewMembers.userId, viewer.id), eq(crews.active, true)));
  if (!memberships.length) return [];
  const leadOf = new Set(memberships.filter((m) => m.isLead).map((m) => m.crewId));
  const today = todayIso(now);
  const from = addDays(today, -RECENT_DAYS);
  const to = addDays(today, AHEAD_DAYS);

  const rows = await db
    .select({
      entryId: scheduleEntries.id,
      kind: scheduleEntries.kind,
      phaseLabel: scheduleEntries.phaseLabel,
      startDate: scheduleEntries.startDate,
      endDate: scheduleEntries.endDate,
      crewNotes: scheduleEntries.crewNotes,
      crewId: crews.id,
      crewName: crews.name,
      worksSaturdays: crews.worksSaturdays,
      projectId: projects.id,
      projectNumber: projects.number,
      projectName: projects.name,
      estimateTitle: estimates.title,
      projectStatus: projects.status,
      confirmation: projectScheduling.confirmation,
      customerId: customers.id,
      customerName: customers.displayName,
      street: properties.street,
      unit: properties.unit,
      city: properties.city,
      province: properties.province,
      postalCode: properties.postalCode,
      accessNotes: properties.accessNotes,
      builtBefore1990: properties.builtBefore1990,
      projectTypes: opportunities.projectTypes,
    })
    .from(scheduleEntries)
    .innerJoin(crews, eq(crews.id, scheduleEntries.crewId))
    .innerJoin(projects, eq(projects.id, scheduleEntries.projectId))
    .innerJoin(customers, eq(customers.id, projects.customerId))
    .leftJoin(properties, eq(properties.id, projects.propertyId))
    .leftJoin(estimates, eq(estimates.id, projects.estimateId))
    .leftJoin(opportunities, eq(opportunities.id, projects.opportunityId))
    .leftJoin(projectScheduling, eq(projectScheduling.projectId, projects.id))
    .where(
      and(
        inArray(scheduleEntries.crewId, memberships.map((m) => m.crewId)),
        isNull(scheduleEntries.deletedAt),
        ne(projects.status, "cancelled"),
        gte(scheduleEntries.endDate, from),
        lte(scheduleEntries.startDate, to),
      ),
    )
    .orderBy(asc(scheduleEntries.startDate), asc(projects.number), asc(scheduleEntries.id))
    .limit(300);
  if (!rows.length) return [];

  // Phone numbers are read only for jobs of crews this user leads.
  const leadCustomerIds = [...new Set(rows.filter((r) => leadOf.has(r.crewId)).map((r) => r.customerId))];
  const phones = new Map<string, { firstName: string | null; lastName: string | null; phone: string | null; customerPhone: string | null }>();
  if (leadCustomerIds.length) {
    const found = await db
      .select({ customerId: customers.id, customerPhone: customers.phone, firstName: contacts.firstName, lastName: contacts.lastName, phone: contacts.phone })
      .from(customers)
      .leftJoin(contacts, and(eq(contacts.customerId, customers.id), eq(contacts.isPrimary, true)))
      .where(inArray(customers.id, leadCustomerIds));
    for (const f of found) if (!phones.has(f.customerId)) phones.set(f.customerId, f);
  }

  const settings = await getScheduleSettings();
  const first = rows.reduce((m, r) => (r.startDate < m ? r.startDate : m), today);
  const last = rows.reduce((m, r) => (r.endDate > m ? r.endDate : m), today);
  const { calFor } = calendarsFor(settings, first, last);

  return rows.map((r) => {
    const isLead = leadOf.has(r.crewId);
    const c = isLead ? phones.get(r.customerId) : undefined;
    const row: FieldJobRow = {
      entryId: r.entryId,
      kind: r.kind,
      phaseLabel: r.phaseLabel,
      startDate: r.startDate,
      endDate: r.endDate,
      crewNotes: r.crewNotes,
      crewId: r.crewId,
      crewName: r.crewName,
      worksSaturdays: r.worksSaturdays,
      projectId: r.projectId,
      projectNumber: r.projectNumber,
      projectName: r.projectName,
      estimateTitle: r.estimateTitle,
      projectStatus: r.projectStatus,
      confirmation: r.confirmation,
      customerName: r.customerName,
      street: r.street,
      unit: r.unit,
      city: r.city,
      province: r.province,
      postalCode: r.postalCode,
      accessNotes: r.accessNotes,
      builtBefore1990: r.builtBefore1990,
      projectTypes: r.projectTypes,
      contactFirstName: c?.firstName ?? null,
      contactLastName: c?.lastName ?? null,
      contactPhone: c?.phone ?? null,
      customerPhone: c?.customerPhone ?? null,
    };
    return toFieldJobView(row, { isLead, today, cal: calFor({ worksSaturdays: r.worksSaturdays }) });
  });
}

/** True when the user may see this booking on /my-jobs (their active crew, not deleted, not cancelled). */
export async function canSeeFieldEntry(viewer: { id: string }, entryId: string): Promise<boolean> {
  if (!viewer.id || !/^[0-9a-f-]{36}$/i.test(entryId)) return false;
  const [row] = await db
    .select({ id: scheduleEntries.id })
    .from(scheduleEntries)
    .innerJoin(crews, eq(crews.id, scheduleEntries.crewId))
    .innerJoin(crewMembers, and(eq(crewMembers.crewId, crews.id), eq(crewMembers.userId, viewer.id)))
    .innerJoin(projects, eq(projects.id, scheduleEntries.projectId))
    .where(and(eq(scheduleEntries.id, entryId), isNull(scheduleEntries.deletedAt), eq(crews.active, true), ne(projects.status, "cancelled")))
    .limit(1);
  return !!row;
}
