/** Work order inputs and the `work_orders` setting. Shared by the staff forms and the server (which parses again). */
import { z } from "zod";
import { DEFAULT_WORK_ORDER_SETTINGS } from "@/db/seed-data";

export const WORK_ORDER_SETTING_KEY = "work_orders";
export const MAX_CHECKLIST_ITEMS = 30;
export const MAX_CHECKLIST_TEXT = 200;
export const MAX_LINK_DAYS = 365;
export const LINK_DAY_CHOICES = [30, 60, 90] as const;
export const CHECKLIST_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** Optional free text: CRLF normalised, trimmed, empty → null. */
const longText = (max: number, what: string) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((s) => (s ?? "").replace(/\r\n?/g, "\n").trim())
    .refine((s) => s.length <= max, `Keep ${what} under ${max.toLocaleString("en-CA")} characters.`)
    .transform((s) => s || null);

export const checklistItemSchema = z.object({
  id: z.string().regex(CHECKLIST_ID_RE, "A checklist item is invalid. Reload the page and try again."),
  text: z.string().trim().min(1, "Checklist items can't be blank.").max(MAX_CHECKLIST_TEXT, `Keep checklist items under ${MAX_CHECKLIST_TEXT} characters.`),
});

const checklistSchema = z
  .array(checklistItemSchema)
  .max(MAX_CHECKLIST_ITEMS, `A work order can have at most ${MAX_CHECKLIST_ITEMS} checklist items.`)
  .refine((items) => new Set(items.map((i) => i.id)).size === items.length, "A checklist item is listed twice. Reload the page and try again.");

export const workOrderFieldsSchema = z.object({
  title: z.string().trim().min(1, "Give the work order a title.").max(200, "Keep the title under 200 characters."),
  /** Null = all crews on the job. */
  crewId: z.string().uuid("Choose a crew.").nullable(),
  specialInstructions: longText(4000, "the special instructions"),
  equipment: longText(2000, "the equipment list"),
  safetyNotes: longText(2000, "the safety notes"),
  accessNotes: longText(1000, "the access notes"),
  showCustomerPhone: z.boolean(),
  checklist: checklistSchema,
});
export type WorkOrderFieldsInput = z.input<typeof workOrderFieldsSchema>;

export const createWorkOrderSchema = workOrderFieldsSchema.extend({ projectId: z.string().uuid("Project not found.") });
export const updateWorkOrderSchema = workOrderFieldsSchema.extend({ id: z.string().uuid("Work order not found.") });
export const issueWorkOrderSchema = z.object({ id: z.string().uuid("Work order not found."), changeNote: longText(500, "the note") });
export const workOrderIdSchema = z.object({ id: z.string().uuid("Work order not found.") });

export const createLinkSchema = z.object({
  workOrderId: z.string().uuid("Work order not found."),
  label: z.string().trim().min(1, "Say who the link is for, for example “Niko's crew”.").max(80, "Keep the name under 80 characters."),
  days: z.coerce
    .number("Enter how many days the link should work.")
    .int("Enter a whole number of days.")
    .min(1, "A link has to work for at least 1 day.")
    .max(MAX_LINK_DAYS, `A link can work for at most ${MAX_LINK_DAYS} days.`),
});
export const revokeLinkSchema = z.object({ linkId: z.string().uuid("Link not found.") });

export const workOrderSettingsSchema = z.object({
  defaultChecklist: z
    .array(z.string().trim().min(1).max(MAX_CHECKLIST_TEXT, `Keep checklist items under ${MAX_CHECKLIST_TEXT} characters.`))
    .max(MAX_CHECKLIST_ITEMS, `The default checklist can have at most ${MAX_CHECKLIST_ITEMS} items.`)
    .default(() => [...DEFAULT_WORK_ORDER_SETTINGS.defaultChecklist]),
  defaultLinkDays: z
    .number()
    .int("Enter a whole number of days.")
    .min(1, "Links have to work for at least 1 day.")
    .max(MAX_LINK_DAYS, `Links can work for at most ${MAX_LINK_DAYS} days.`)
    .default(DEFAULT_WORK_ORDER_SETTINGS.defaultLinkDays),
  createOnSale: z.boolean().default(DEFAULT_WORK_ORDER_SETTINGS.createOnSale),
  showHours: z.boolean().default(DEFAULT_WORK_ORDER_SETTINGS.showHours),
  showPaint: z.boolean().default(DEFAULT_WORK_ORDER_SETTINGS.showPaint),
});
export type WorkOrderSettings = z.output<typeof workOrderSettingsSchema>;

export function defaultWorkOrderSettings(): WorkOrderSettings {
  return workOrderSettingsSchema.parse({});
}
