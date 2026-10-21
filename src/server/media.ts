import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, isNull, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { DOCUMENT_PURPOSES, IMAGE_PURPOSES, media, tasks, type DocumentPurpose } from "@/db/schema";
import { DOCUMENT_MAX_BYTES, IMAGE_MAX_BYTES, UPLOAD_CHUNK_BYTES } from "@/lib/media-limits";
import { BUSINESS_TZ } from "@/lib/time";
import { audit } from "./audit";
import { MediaError, sanitizeFilename, typeForFilename, validateAndProcess } from "./media-validation";

export const DOCUMENT_TITLES: Record<DocumentPurpose, string> = {
  insurance_certificate: "Liability insurance certificate",
  worksafebc_clearance: "WorkSafeBC clearance letter",
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-01-10");
const optDate = isoDate.nullable().optional().or(z.literal("").transform(() => null));

export const startUploadSchema = z
  .object({
    kind: z.enum(["image", "document"]),
    purpose: z.enum([...IMAGE_PURPOSES, ...DOCUMENT_PURPOSES]),
    filename: z.string().trim().min(1).max(255),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
    size: z.number().int().min(1, "This file is empty."),
    title: z.string().trim().max(120).optional(),
    alt: z.string().trim().max(300).optional(),
    effectiveOn: optDate,
    expiresOn: optDate,
  })
  .superRefine((v, ctx) => {
    const issue = (message: string, path: string) => ctx.addIssue({ code: "custom", message, path: [path] });
    const docPurpose = (DOCUMENT_PURPOSES as readonly string[]).includes(v.purpose);
    if ((v.kind === "document") !== docPurpose) issue("That upload type doesn't fit here.", "purpose");
    const byName = typeForFilename(v.filename, v.kind);
    if (/\.svg$/i.test(v.filename)) issue("SVG files aren't accepted. Please upload a JPG or PNG.", "filename");
    else if (!byName) issue(v.kind === "image" ? "Please upload a JPG, PNG or WebP picture." : "Please upload a PDF, JPG or PNG file.", "filename");
    else if (byName !== v.contentType) issue("The file name doesn't match its type. Please rename it or export it again.", "filename");
    const max = v.kind === "image" ? IMAGE_MAX_BYTES : DOCUMENT_MAX_BYTES;
    if (v.size > max) issue(`This file is too large. The limit is ${max / 1024 / 1024} MB.`, "size");
    if (v.effectiveOn && v.expiresOn && v.expiresOn < v.effectiveOn) issue("The expiry date must be after the effective date.", "expiresOn");
  });

/** Begin a chunked upload. Old abandoned uploads are cleared on the way. */
export async function startUpload(raw: z.input<typeof startUploadSchema>, userId: string) {
  const v = startUploadSchema.parse(raw);
  await db.delete(media).where(and(eq(media.status, "pending"), lt(media.createdAt, sql`now() - interval '24 hours'`)));
  const [row] = await db
    .insert(media)
    .values({
      kind: v.kind,
      purpose: v.purpose,
      contentType: v.contentType,
      declaredSize: v.size,
      originalFilename: sanitizeFilename(v.filename),
      title: v.title || (v.kind === "document" ? DOCUMENT_TITLES[v.purpose as DocumentPurpose] : null),
      alt: v.alt ?? null,
      effectiveOn: v.effectiveOn ?? null,
      expiresOn: v.expiresOn ?? null,
      createdBy: userId,
    })
    .returning({ id: media.id });
  return { uploadId: row.id, chunkSize: UPLOAD_CHUNK_BYTES };
}

/** Append one chunk. Chunks must arrive in order and never exceed the declared size. */
export async function uploadChunk(uploadId: string, index: number, chunk: Uint8Array, userId: string) {
  if (!z.string().uuid().safeParse(uploadId).success || !Number.isInteger(index) || index < 0) throw new MediaError("Upload not found. Please try again.");
  if (!chunk.length || chunk.length > UPLOAD_CHUNK_BYTES) throw new MediaError("Upload chunk has the wrong size. Please try again.");
  const buf = Buffer.from(chunk);
  const updated = await db
    .update(media)
    .set({
      data: sql`${media.data} || ${buf}::bytea`,
      partsReceived: sql`${media.partsReceived} + 1`,
      byteSize: sql`${media.byteSize} + ${buf.length}`,
    })
    .where(
      and(
        eq(media.id, uploadId),
        eq(media.status, "pending"),
        eq(media.createdBy, userId),
        eq(media.partsReceived, index),
        sql`${media.byteSize} + ${buf.length} <= ${media.declaredSize}`,
      ),
    )
    .returning({ id: media.id, byteSize: media.byteSize });
  if (!updated.length) throw new MediaError("This upload was interrupted. Please try again.");
  return { received: updated[0].byteSize };
}

export interface UploadResult {
  id: string;
  src: `media:${string}`;
  url: string;
  width: number | null;
  height: number | null;
}

/** Validate the whole file, re-encode images, and make it ready (and current, for documents). */
export async function completeUpload(uploadId: string, userId: string): Promise<UploadResult> {
  if (!z.string().uuid().safeParse(uploadId).success) throw new MediaError("Upload not found. Please try again.");
  const row = await db.query.media.findFirst({ where: and(eq(media.id, uploadId), eq(media.status, "pending"), eq(media.createdBy, userId)) });
  if (!row) throw new MediaError("Upload not found. Please try again.");
  if (row.byteSize !== row.declaredSize) throw new MediaError("The upload is incomplete. Please try again.");

  let processed;
  try {
    processed = await validateAndProcess({ kind: row.kind, declaredType: row.contentType, bytes: row.data });
  } catch (e) {
    await db.delete(media).where(eq(media.id, row.id));
    throw e;
  }
  const sha256 = createHash("sha256").update(processed.bytes).digest("hex");
  const now = new Date();

  const resultId = await db.transaction(async (tx) => {
    const dup = await tx.query.media.findFirst({
      where: and(eq(media.purpose, row.purpose), eq(media.sha256, sha256), eq(media.status, "ready")),
      columns: { id: true },
    });
    let id: string;
    if (dup) {
      await tx.delete(media).where(eq(media.id, row.id));
      id = dup.id;
      if (row.kind === "document") {
        // Re-uploading the same file makes it current again, with the dates just entered.
        await tx.update(media).set({ archivedAt: null, title: row.title, effectiveOn: row.effectiveOn, expiresOn: row.expiresOn }).where(eq(media.id, id));
      }
    } else {
      await tx
        .update(media)
        .set({
          status: "ready",
          readyAt: now,
          data: processed.bytes,
          byteSize: processed.bytes.length,
          contentType: processed.contentType,
          width: processed.width,
          height: processed.height,
          sha256,
        })
        .where(eq(media.id, row.id));
      id = row.id;
    }
    if (row.kind === "document") {
      await tx
        .update(media)
        .set({ archivedAt: now })
        .where(and(eq(media.purpose, row.purpose), eq(media.status, "ready"), isNull(media.archivedAt), ne(media.id, id)));
    }
    await audit(
      { actorId: userId, action: "media.upload", entityType: "media", entityId: id, after: { kind: row.kind, purpose: row.purpose, title: row.title, bytes: processed.bytes.length, sha256, duplicate: !!dup } },
      tx,
    );
    return id;
  });
  return { id: resultId, src: `media:${resultId}`, url: `/api/media/${resultId}`, width: processed.width, height: processed.height };
}

export const updateDocumentSchema = z
  .object({ title: z.string().trim().min(1, "Enter a title").max(120), effectiveOn: optDate, expiresOn: optDate })
  .refine((v) => !v.effectiveOn || !v.expiresOn || v.expiresOn >= v.effectiveOn, { message: "The expiry date must be after the effective date.", path: ["expiresOn"] });

export async function updateDocument(id: string, raw: z.input<typeof updateDocumentSchema>, userId: string) {
  const v = updateDocumentSchema.parse(raw);
  const before = await db.query.media.findFirst({ where: and(eq(media.id, id), eq(media.kind, "document"), eq(media.status, "ready")), columns: { title: true, effectiveOn: true, expiresOn: true } });
  if (!before) throw new MediaError("Document not found.");
  const after = { title: v.title, effectiveOn: v.effectiveOn ?? null, expiresOn: v.expiresOn ?? null };
  await db.update(media).set(after).where(eq(media.id, id));
  await audit({ actorId: userId, action: "media.update", entityType: "media", entityId: id, before, after });
}

/** "Stop showing to customers". */
export async function archiveDocument(id: string, userId: string) {
  const res = await db
    .update(media)
    .set({ archivedAt: new Date() })
    .where(and(eq(media.id, id), eq(media.kind, "document"), isNull(media.archivedAt)))
    .returning({ id: media.id });
  if (!res.length) throw new MediaError("Document not found or already hidden.");
  await audit({ actorId: userId, action: "media.archive", entityType: "media", entityId: id });
}

/** Today's calendar date in the business time zone, as YYYY-MM-DD. */
export function businessToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function addDays(isoDay: string, days: number): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type DocumentState = "valid" | "expiring" | "expired" | "missing";
export interface CurrentDocument {
  purpose: DocumentPurpose;
  defaultTitle: string;
  id: string | null;
  title: string | null;
  contentType: string | null;
  effectiveOn: string | null;
  expiresOn: string | null;
  readyAt: Date | null;
  status: DocumentState;
}

export function documentState(expiresOn: string | null, today: string): Exclude<DocumentState, "missing"> {
  if (!expiresOn) return "valid";
  if (expiresOn < today) return "expired";
  return expiresOn <= addDays(today, 30) ? "expiring" : "valid";
}

/** The current document per purpose (newest ready, not hidden), with its expiry state. Missing purposes included. */
export async function currentDocuments(now = new Date()): Promise<CurrentDocument[]> {
  const today = businessToday(now);
  const out: CurrentDocument[] = [];
  for (const purpose of DOCUMENT_PURPOSES) {
    const row = await db.query.media.findFirst({
      where: and(eq(media.purpose, purpose), eq(media.status, "ready"), isNull(media.archivedAt)),
      orderBy: desc(media.readyAt),
      columns: { id: true, title: true, contentType: true, effectiveOn: true, expiresOn: true, readyAt: true },
    });
    out.push(
      row
        ? { purpose, defaultTitle: DOCUMENT_TITLES[purpose], ...row, status: documentState(row.expiresOn, today) }
        : { purpose, defaultTitle: DOCUMENT_TITLES[purpose], id: null, title: null, contentType: null, effectiveOn: null, expiresOn: null, readyAt: null, status: "missing" },
    );
  }
  return out;
}

/** Documents a customer may see right now (current and not expired). */
export function visibleDocuments(docs: CurrentDocument[]): (CurrentDocument & { id: string })[] {
  return docs.filter((d): d is CurrentDocument & { id: string } => !!d.id && (d.status === "valid" || d.status === "expiring"));
}

/** The current, unexpired document for one purpose, with its bytes (for the customer link). */
export async function currentDocumentFile(purpose: DocumentPurpose, now = new Date()) {
  const today = businessToday(now);
  return db.query.media.findFirst({
    where: and(
      eq(media.purpose, purpose),
      eq(media.status, "ready"),
      isNull(media.archivedAt),
      sql`(${media.expiresOn} IS NULL OR ${media.expiresOn} >= ${today}::date)`,
    ),
    orderBy: desc(media.readyAt),
    columns: { id: true, title: true, contentType: true, data: true, sha256: true },
  });
}

export interface DocumentAlert {
  purpose: DocumentPurpose;
  status: Exclude<DocumentState, "valid">;
  message: string;
  taskTitle: string;
}

/** "Liability insurance…" → "liability insurance…", but "WorkSafeBC…" stays as written. */
const lowerFirst = (s: string) => (/^[A-Z][a-z]+\b/.test(s) && !/^[A-Z][a-z]+[A-Z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export function documentAlertsFrom(docs: CurrentDocument[]): DocumentAlert[] {
  const fmt = (d: string) => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  return docs
    .filter((d) => d.status !== "valid")
    .map((d) => {
      const name = d.title || d.defaultTitle;
      const status = d.status as DocumentAlert["status"];
      const message =
        status === "missing"
          ? `No ${lowerFirst(d.defaultTitle)} uploaded. Customers don't see one on proposals. Upload the current one →`
          : status === "expired"
            ? `${name} expired on ${fmt(d.expiresOn!)}. Customers no longer see it. Upload the current one →`
            : `${name} expires on ${fmt(d.expiresOn!)}. Upload the renewed one before then →`;
      const taskTitle = d.expiresOn ? `Upload current ${d.defaultTitle} (expires ${d.expiresOn})` : `Upload current ${d.defaultTitle}`;
      return { purpose: d.purpose, status, message, taskTitle };
    });
}

export async function documentAlerts(now = new Date()) {
  return documentAlertsFrom(await currentDocuments(now));
}

/** At most one open task per document problem. A task, never a customer email (rule 8). */
export async function ensureDocumentTasks(assigneeId: string, now = new Date()) {
  const alerts = (await documentAlerts(now)).filter((a) => a.status !== "missing");
  for (const a of alerts) {
    const open = await db.query.tasks.findFirst({ where: and(eq(tasks.title, a.taskTitle), isNull(tasks.completedAt)), columns: { id: true } });
    if (!open) await db.insert(tasks).values({ title: a.taskTitle, notes: "Settings → Proposals → Insurance & FAQ", assigneeId, dueAt: now, createdBy: null });
  }
}

export async function listMedia(filter: { kind?: "image" | "document"; purpose?: string } = {}) {
  return db
    .select({
      id: media.id,
      kind: media.kind,
      purpose: media.purpose,
      contentType: media.contentType,
      byteSize: media.byteSize,
      title: media.title,
      alt: media.alt,
      width: media.width,
      height: media.height,
      effectiveOn: media.effectiveOn,
      expiresOn: media.expiresOn,
      archivedAt: media.archivedAt,
      createdBy: media.createdBy,
      readyAt: media.readyAt,
    })
    .from(media)
    .where(
      and(
        eq(media.status, "ready"),
        filter.kind ? eq(media.kind, filter.kind) : undefined,
        filter.purpose ? eq(media.purpose, filter.purpose as never) : undefined,
      ),
    )
    .orderBy(desc(media.readyAt))
    .limit(500);
}
