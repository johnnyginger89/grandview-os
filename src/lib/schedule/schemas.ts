/**
 * Zod schemas shared by the schedule server actions and services. Actions parse
 * with these, and the services parse again (they also take `unknown`).
 */
import { z } from "zod";
import { diffDays, isIsoDate } from "@/lib/calendar-date";
import {
  CONFIRM_VIA,
  CREW_COLORS,
  CREW_KINDS,
  CREW_TRADES,
  MAX_BOOKING_SPAN_DAYS,
  MAX_WINDOW_DAYS,
  MAX_WORKING_DAYS,
  NOTICE_KINDS,
  NOTICE_VARIANTS,
  READINESS_STATES,
  SCHEDULE_ENTRY_KINDS,
} from "./constants";

export const isoDate = z.string().refine((s) => isIsoDate(s), "Enter a valid date");
const uuid = z.string().uuid();
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const hours = z.string().regex(/^\d{1,5}(\.\d{1,2})?$/, "Hours like 12 or 12.5").nullable();
const version = z.number().int().min(1);

const SPAN_MESSAGE = "Bookings can be at most 6 months long";

/** `/schedule` search params. Never fails: garbage becomes the defaults. */
export const windowQuerySchema = z.object({
  view: z.enum(["timeline", "month"]).catch("month"),
  /** Default: startOfWeek(todayIso()). */
  from: isoDate.optional().catch(undefined),
  span: z.coerce.number().pipe(z.union([z.literal(7), z.literal(14), z.literal(28)])).optional().catch(undefined),
  crews: z
    .unknown()
    .optional()
    .transform((v) => {
      const s = Array.isArray(v) ? v.join(",") : typeof v === "string" ? v : "";
      return s.length > 2000 ? [] : s.split(",").filter((x) => uuid.safeParse(x).success).slice(0, 50);
    }),
  focus: uuid.optional().catch(undefined),
});
export type WindowQuery = z.infer<typeof windowQuerySchema>;

/** Range for getScheduleWindow: at most 62 days. */
export const windowRangeSchema = z
  .object({ from: isoDate, to: isoDate, crewIds: z.array(uuid).max(50).optional() })
  .refine((v) => v.to >= v.from, { path: ["to"], message: "The end of the range is before its start" })
  .refine((v) => diffDays(v.from, v.to) < MAX_WINDOW_DAYS, { path: ["to"], message: `Show at most ${MAX_WINDOW_DAYS} days at a time` });

export const createEntrySchema = z
  .object({
    projectId: uuid,
    crewId: uuid.nullable(),
    kind: z.enum(SCHEDULE_ENTRY_KINDS).default("work"),
    startDate: isoDate,
    endDate: isoDate.optional(),
    workingDays: z.number().int().min(1).max(MAX_WORKING_DAYS).optional(),
    phaseLabel: optText(80),
    notes: optText(2000),
    crewNotes: optText(2000),
    allowNonWorkingStart: z.boolean().default(false),
    confirmOnHold: z.boolean().default(false),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { path: ["endDate"], message: "The end date is before the start date" })
  .refine((v) => !v.endDate || diffDays(v.startDate, v.endDate) <= MAX_BOOKING_SPAN_DAYS, { path: ["endDate"], message: SPAN_MESSAGE });
export type CreateEntryInput = z.input<typeof createEntrySchema>;

/** Like optText, but an absent field stays undefined ("leave as is"); "" or null clears it. */
const patchText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

export const UPDATE_ENTRY_FIELDS = ["crewId", "kind", "startDate", "endDate", "phaseLabel", "notes", "crewNotes", "plannedHours"] as const;

/** Only the fields present are changed. */
export const updateEntrySchema = z
  .object({
    id: uuid,
    version,
    crewId: uuid.nullable().optional(),
    kind: z.enum(SCHEDULE_ENTRY_KINDS).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    phaseLabel: patchText(80),
    notes: patchText(2000),
    crewNotes: patchText(2000),
    plannedHours: hours.optional(),
  })
  .superRefine((v, ctx) => {
    if (!UPDATE_ENTRY_FIELDS.some((k) => v[k] !== undefined)) ctx.addIssue({ code: "custom", path: [], message: "Nothing to change" });
    if (v.startDate && v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "The end date is before the start date" });
    else if (v.startDate && v.endDate && diffDays(v.startDate, v.endDate) > MAX_BOOKING_SPAN_DAYS) ctx.addIssue({ code: "custom", path: ["endDate"], message: SPAN_MESSAGE });
  });
export type UpdateEntryInput = z.input<typeof updateEntrySchema>;

export const deleteEntrySchema = z.object({ id: uuid, version });
export const splitEntrySchema = z.object({ id: uuid, version, firstPartEnd: isoDate });
/** Removes every booking of a project (e.g. a cancelled job). */
export const removeProjectEntriesSchema = z.object({ projectId: uuid });
export const projectIdSchema = z.object({ projectId: uuid });

export const readinessSchema = z.object({
  projectId: uuid,
  checkKey: z.string().regex(/^[a-z0-9_]{2,40}$/),
  state: z.enum(READINESS_STATES),
  /** Absent = keep the saved date / note; null or "" clears it. */
  dueDate: isoDate.nullable().optional(),
  note: patchText(500),
});

/** version 0 = no project_scheduling row yet. */
export const schedulingPrefsSchema = z.object({
  projectId: uuid,
  version: z.number().int().min(0),
  notBefore: isoDate.nullable(),
  schedulingNotes: optText(2000),
});

export const noticePreviewSchema = z.object({
  projectId: uuid,
  kind: z.enum(NOTICE_KINDS),
  variant: z.enum(NOTICE_VARIANTS).optional(),
});

export const noticeSendSchema = noticePreviewSchema.extend({
  /** SMS seam: only email today. */
  channel: z.literal("email").default("email"),
  variant: z.enum(NOTICE_VARIANTS),
  subject: z
    .string()
    .trim()
    .min(1, "Enter a subject")
    .max(200)
    .refine((s) => !/[\r\n]/.test(s), "The subject can't contain line breaks"),
  body: z.string().trim().min(1, "Enter a message").max(10_000),
  /** The first work day shown in the preview; the send is refused if the schedule changed since. */
  expectedStart: isoDate,
  /** Overrides "The start date is in the past". */
  sendAnyway: z.boolean().default(false),
});
export type NoticeSendInput = z.input<typeof noticeSendSchema>;

export const confirmSchema = z.object({
  projectId: uuid,
  kind: z.enum(NOTICE_KINDS),
  via: z.enum(CONFIRM_VIA),
  note: optText(500),
});

export const crewSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1, "Enter a name").max(60),
  kind: z.enum(CREW_KINDS),
  trade: z.enum(CREW_TRADES),
  subCompany: optText(120),
  color: z.enum(CREW_COLORS),
  crewSize: z.number().int().min(1).max(50),
  hoursPerDay: z
    .string()
    .trim()
    .regex(/^\d{1,2}(\.\d{1,2})?$/, "Hours like 8 or 7.5")
    .refine((h) => Number(h) > 0 && Number(h) <= 24, "Between 0 and 24 hours"),
  worksSaturdays: z.boolean(),
  notes: optText(1000),
});
export type CrewInput = z.input<typeof crewSchema>;

export const crewMembersSchema = z
  .object({
    crewId: uuid,
    members: z.array(z.object({ userId: z.string().min(1).max(64), isLead: z.boolean() })).max(30),
  })
  .refine((v) => v.members.filter((m) => m.isLead).length <= 1, { path: ["members"], message: "Only one crew lead" })
  .refine((v) => new Set(v.members.map((m) => m.userId)).size === v.members.length, { path: ["members"], message: "Duplicate member" });

export const crewActiveSchema = z.object({ id: uuid, active: z.boolean() });
export const reorderCrewsSchema = z.object({ ids: z.array(uuid).min(1).max(200) }).refine((v) => new Set(v.ids).size === v.ids.length, "Duplicate crew");
