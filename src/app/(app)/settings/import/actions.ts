"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeErrorMessage } from "@/lib/action-error";
import { assertPermission, AuthorizationError } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { createImportBatch, deleteImportBatch, rollbackImport, runImport, saveImportMapping } from "@/server/imports";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Importing customers needs both settings access and customer editing. */
async function importer() {
  const user = await assertPermission("settings.manage");
  if (!can(user.role, "customers.write")) throw new AuthorizationError();
  return user;
}

export async function uploadImportAction(_: unknown, form: FormData): Promise<Result<{ id: string }>> {
  try {
    const user = await importer();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new z.ZodError([{ code: "custom", message: "Choose the CSV file first.", path: ["file"] }]);
    const id = await createImportBatch({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, "markate", user.id);
    revalidatePath("/settings/import");
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: safeErrorMessage(e) };
  }
}

export async function saveMappingAction(batchId: string, mapping: string[]): Promise<Result> {
  try {
    const user = await importer();
    await saveImportMapping(batchId, mapping, user.id);
    revalidatePath(`/settings/import/${batchId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: safeErrorMessage(e) };
  }
}

export async function runImportAction(batchId: string): Promise<Result> {
  try {
    const user = await importer();
    await runImport(batchId, user.id);
    revalidatePath(`/settings/import/${batchId}`);
    revalidatePath("/customers");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: safeErrorMessage(e) };
  }
}

export async function rollbackImportAction(batchId: string): Promise<Result<{ removed: number; kept: { name: string; reason: string }[] }>> {
  try {
    const user = await importer();
    const r = await rollbackImport(batchId, user.id);
    revalidatePath(`/settings/import/${batchId}`);
    revalidatePath("/customers");
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: safeErrorMessage(e) };
  }
}

export async function deleteImportAction(batchId: string): Promise<Result> {
  try {
    const user = await importer();
    await deleteImportBatch(batchId, user.id);
    revalidatePath("/settings/import");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: safeErrorMessage(e) };
  }
}
