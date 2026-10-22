/** The `schedule` app setting: code defaults, validated on read (src/server/schedule-settings.ts). */
import { z } from "zod";
import { isIsoDate } from "@/lib/calendar-date";
import { SCHEDULE_ENTRY_KINDS } from "./constants";

export const SCHEDULE_SETTING_KEY = "schedule";

const isoDay = z.string().refine((s) => isIsoDate(s), "Enter a valid date");
const stateLabel = z.string().trim().min(1).max(30);

export const readinessCheckSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{2,40}$/, "Use 2–40 lowercase letters, digits or _"),
  label: z.string().trim().min(1).max(60),
  states: z.object({ todo: stateLabel, in_progress: stateLabel, done: stateLabel, not_needed: stateLabel }),
  /**
   * The check follows bookings of this kind: "in_progress" with the date while one is
   * booked, back to "todo" when none is left ("done" and "not_needed" are never changed).
   * A pressure wash shows as done once its last booked day has passed.
   */
  linkedEntryKind: z.enum(SCHEDULE_ENTRY_KINDS).nullable().default(null),
});
export type ReadinessCheck = z.infer<typeof readinessCheckSchema>;

export const DEFAULT_READINESS_CHECKS: readonly ReadinessCheck[] = [
  { key: "pressure_wash", label: "Pressure washing", states: { todo: "To book", in_progress: "Booked", done: "Done", not_needed: "Not needed" }, linkedEntryKind: "pressure_wash" },
  { key: "paint", label: "Colours & paint", states: { todo: "Waiting", in_progress: "Ordered", done: "Received", not_needed: "Not needed" }, linkedEntryKind: null },
  { key: "colour_consult", label: "Colour consult", states: { todo: "Needed", in_progress: "Booked", done: "Done", not_needed: "Not needed" }, linkedEntryKind: "colour_consult" },
  { key: "deposit", label: "Deposit received", states: { todo: "Not yet", in_progress: "Invoice sent", done: "Received", not_needed: "Not required" }, linkedEntryKind: null },
];

export const scheduleSettingsSchema = z.object({
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).default(1),
  workDays: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .default([1, 2, 3, 4, 5])
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  holidayRegion: z.enum(["BC", "none"]).default("BC"),
  extraClosedDays: z
    .array(z.object({ date: isoDay, label: z.string().trim().min(1).max(60) }))
    .max(100)
    .default([])
    .refine((days) => new Set(days.map((d) => d.date)).size === days.length, "Each closed day can only be listed once")
    .transform((days) => [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))),
  defaultSpanDays: z.union([z.literal(7), z.literal(14), z.literal(28)]).default(14),
  /** Used for the sidebar suggestion before a crew is chosen. Hours/day come from pricing.hoursPerCrewDay. */
  defaultCrewSize: z.number().int().min(1).max(20).default(3),
  /** estimates.job_type values that get the exterior (weather) wording. */
  exteriorJobTypes: z
    .array(z.string().trim().max(40))
    .max(20)
    .default(["exterior", "interior_exterior", "staining"])
    .transform((types) => [...new Set(types.map((t) => t.toLowerCase()).filter(Boolean))]),
  readinessChecks: z
    .array(readinessCheckSchema)
    .max(12)
    .default(() => DEFAULT_READINESS_CHECKS.map((c) => ({ ...c, states: { ...c.states } })))
    .refine((checks) => new Set(checks.map((c) => c.key)).size === checks.length, "Each readiness check needs its own key"),
});
export type ScheduleSettings = z.infer<typeof scheduleSettingsSchema>;
export type ScheduleSettingsInput = z.input<typeof scheduleSettingsSchema>;

export function defaultScheduleSettings(): ScheduleSettings {
  return scheduleSettingsSchema.parse({});
}
