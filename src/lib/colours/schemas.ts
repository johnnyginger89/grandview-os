/** Colour selection form inputs and the `colour_form` setting. Shared by the forms and the server (which parses again). */
import { z } from "zod";
import { DEFAULT_COLOUR_FORM } from "@/db/seed-data";

export const COLOUR_FORM_SETTING_KEY = "colour_form";
export const MAX_COLOUR_ROWS = 150;
const ROW_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

const text = (max: number, what: string) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((s) => (s ?? "").replace(/\s+/g, " ").trim())
    .refine((s) => s.length <= max, `Keep ${what} under ${max} characters.`);

export const colourRowSchema = z.object({
  id: z.string().regex(ROW_ID_RE, "A row is invalid. Reload the page and try again."),
  room: text(80, "the room"),
  surface: text(80, "the surface"),
  colour: text(80, "the colour name"),
  code: text(40, "the colour code"),
  sheen: text(40, "the sheen"),
  lineId: z.string().uuid().nullable().optional().catch(null),
});
export type ColourRowInput = z.input<typeof colourRowSchema>;

/** Rows with nothing typed in are dropped; a row needs a colour (name or code) to count. */
export const colourRowsSchema = z
  .array(colourRowSchema)
  .max(MAX_COLOUR_ROWS, `A form can have at most ${MAX_COLOUR_ROWS} rows.`)
  .transform((rows) => rows.filter((r) => r.room || r.surface || r.colour || r.code || r.sheen))
  .refine((rows) => new Set(rows.map((r) => r.id)).size === rows.length, "A row is listed twice. Reload the page and try again.");

export const colourClientSchema = z.object({
  name: text(120, "the name"),
  email: text(200, "the email").refine((s) => !s || z.string().email().safeParse(s).success, "Check the email address."),
  phone: text(40, "the phone number"),
  address: text(300, "the address"),
});

export const colourDraftSchema = z.object({
  rows: colourRowsSchema,
  client: colourClientSchema,
  notes: z
    .union([z.string(), z.null()])
    .optional()
    .transform((s) => (s ?? "").replace(/\r\n?/g, "\n").trim())
    .refine((s) => s.length <= 2000, "Keep the notes under 2,000 characters.")
    .transform((s) => s || null),
});
export type ColourDraftInput = z.input<typeof colourDraftSchema>;

export const colourSignSchema = colourDraftSchema.extend({
  signedName: z.string().trim().min(2, "Type the customer's full name.").max(120),
  signature: z
    .string()
    .startsWith("data:image/png;base64,", "Please sign in the box.")
    .max(400_000, "The signature image is too large.")
    .refine((s) => s.length > 200, "Please sign in the box."),
  agreeChange: z.literal(true, { error: "Please tick that you understand the note about changing colours." }),
  agreeCoverage: z.literal(true, { error: "Please tick that you understand the note about whites and bright colours." }),
});
export type ColourSignInput = z.input<typeof colourSignSchema>;

const list = (max: number) => z.array(z.string().trim().min(1).max(60)).max(max);

export const colourFormSettingsSchema = z.object({
  changeWarning: z.string().trim().min(10, "Write the note about changing colours.").max(1000).default(DEFAULT_COLOUR_FORM.changeWarning),
  coverageWarning: z.string().trim().min(10, "Write the note about whites and bright colours.").max(1000).default(DEFAULT_COLOUR_FORM.coverageWarning),
  sheens: list(20).default(() => [...DEFAULT_COLOUR_FORM.sheens]),
  surfaces: list(60).default(() => [...DEFAULT_COLOUR_FORM.surfaces]),
  linkDays: z.number().int("Enter a whole number of days.").min(1).max(365).default(DEFAULT_COLOUR_FORM.linkDays),
});
export type ColourFormSettings = z.output<typeof colourFormSettingsSchema>;

export const colourLinkSchema = z.object({
  id: z.string().uuid("Colour form not found."),
  email: z
    .object({
      to: z.string().trim().toLowerCase().email("Enter the customer's email address."),
      subject: z.string().trim().min(1, "Write a subject.").max(200),
      body: z.string().trim().min(1, "Write the email.").max(5000),
    })
    .nullable(),
});

/** "SW 7008 Alabaster" → code "SW 7008", colour "Alabaster". Anything else is all colour name. */
export function splitColour(value: string | null | undefined): { code: string; colour: string } {
  const v = (value ?? "").trim();
  const code = "((?:[A-Z]{1,4}[- ]?)?\\d{2,5}(?:-\\d{1,3})?[A-Z]?)";
  const m = v.match(new RegExp(`^${code}\\s+(.+)$`, "i")) ?? v.match(new RegExp(`^${code}$`, "i"));
  return m ? { code: m[1].toUpperCase(), colour: (m[2] ?? "").trim() } : { code: "", colour: v };
}

/** "SW 7008 Alabaster", "Alabaster" or "SW 7008". */
export function colourLabel(r: { colour: string; code: string }): string {
  return [r.code, r.colour].filter(Boolean).join(" ");
}

export function defaultColourFormSettings(): ColourFormSettings {
  return colourFormSettingsSchema.parse({});
}
