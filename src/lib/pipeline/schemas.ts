/** zod schemas for the leads list server actions. Pure, so tests and the browser can share them. */
import { z } from "zod";
import { isIsoDate } from "@/lib/calendar-date";
import { BULK_LIMIT } from "./list-view";

const uuid = z.string().uuid();

export const idsSchema = z
  .array(uuid)
  .min(1)
  .max(BULK_LIMIT, `Select ${BULK_LIMIT} or fewer leads.`)
  .transform((a) => [...new Set(a)]);

/** A Vancouver calendar day ("2026-10-24"). */
export const businessDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")
  .refine(isIsoDate, "Invalid date")
  .refine((d) => d >= "2000-01-01" && d <= "2100-12-31", "Date out of range");

/** Optional reason on a single move; blank means "keep the previous reason". */
export const lostReasonSchema = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => v || undefined);

export const bulkMoveStageInput = z
  .object({ ids: idsSchema, stageId: uuid, lostReason: z.string().trim().min(1).max(200).optional() })
  .strict();

export const followUpInput = z.object({ ids: idsSchema, date: businessDaySchema.nullable() }).strict();

/** Better Auth user ids are text, not UUIDs; the service looks the user up. */
export const assignEstimatorInput = z.object({ ids: idsSchema, estimatorId: z.string().trim().min(1).max(64).nullable() }).strict();
