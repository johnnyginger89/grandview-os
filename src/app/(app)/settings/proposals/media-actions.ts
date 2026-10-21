"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeErrorMessage } from "@/lib/action-error";
import { assertPermission } from "@/lib/authz/guard";
import {
  archiveDocument,
  completeUpload,
  listMedia,
  startUpload,
  updateDocument,
  uploadChunk,
  type startUploadSchema,
  type UploadResult,
  type updateDocumentSchema,
} from "@/server/media";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Upload errors are shown as-is (no field names): they are written for the person uploading. */
function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check the file" };
  return { ok: false, error: safeErrorMessage(e) };
}
const uuid = z.string().uuid();

export async function startUploadAction(input: z.input<typeof startUploadSchema>): Promise<Result<{ uploadId: string; chunkSize: number }>> {
  try {
    const user = await assertPermission("settings.manage");
    return { ok: true, ...(await startUpload(input, user.id)) };
  } catch (e) {
    return fail(e);
  }
}

/** One chunk (≤ chunkSize) as FormData field "chunk". Chunks must be sent in order. */
export async function uploadChunkAction(uploadId: string, index: number, form: FormData): Promise<Result<{ received: number }>> {
  try {
    const user = await assertPermission("settings.manage");
    const chunk = form.get("chunk");
    if (!(chunk instanceof Blob)) throw new Error("Upload chunk missing. Please try again.");
    return { ok: true, ...(await uploadChunk(uuid.parse(uploadId), Number(index), new Uint8Array(await chunk.arrayBuffer()), user.id)) };
  } catch (e) {
    return fail(e);
  }
}

export async function completeUploadAction(uploadId: string): Promise<Result<UploadResult>> {
  try {
    const user = await assertPermission("settings.manage");
    const r = await completeUpload(uuid.parse(uploadId), user.id);
    revalidatePath("/settings/proposals");
    return { ok: true, ...r };
  } catch (e) {
    return fail(e);
  }
}

export async function updateDocumentAction(id: string, input: z.input<typeof updateDocumentSchema>): Promise<Result> {
  try {
    const user = await assertPermission("settings.manage");
    await updateDocument(uuid.parse(id), input, user.id);
    revalidatePath("/settings/proposals");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** "Stop showing to customers". */
export async function archiveDocumentAction(id: string): Promise<Result> {
  try {
    const user = await assertPermission("settings.manage");
    await archiveDocument(uuid.parse(id), user.id);
    revalidatePath("/settings/proposals");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Library picker: uploaded images (or documents), newest first. No file contents. */
export async function listMediaAction(kind: "image" | "document") {
  try {
    await assertPermission("settings.manage");
    const rows = await listMedia({ kind: z.enum(["image", "document"]).parse(kind) });
    return {
      ok: true as const,
      items: rows.map((r) => ({
        id: r.id,
        src: `media:${r.id}`,
        url: `/api/media/${r.id}`,
        purpose: r.purpose,
        title: r.title,
        alt: r.alt,
        width: r.width,
        height: r.height,
        effectiveOn: r.effectiveOn,
        expiresOn: r.expiresOn,
        archived: !!r.archivedAt,
        readyAt: r.readyAt?.toISOString() ?? null,
      })),
    };
  } catch (e) {
    return fail(e);
  }
}
