"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeErrorMessage } from "@/lib/action-error";
import { assertPermission } from "@/lib/authz/guard";
import { createRate, deleteFactor, rateHistory, saveFactor, saveMaterial, saveRateVersion, setRateActive, updateRateIdentity } from "@/server/rates";

export type Result = { ok: true } | { ok: false; error: string };
const err = (e: unknown): Result => ({ ok: false, error: safeErrorMessage(e) });

export interface RateFormInput {
  id: string | null;
  identity: { code: string; name: string; customerLabel: string; category: string; unit: string; basis: string; dimensionSource: string };
  values: Record<string, string | number | null>;
  valuesChanged: boolean;
}

export async function saveRateAction(input: RateFormInput): Promise<Result> {
  try {
    const user = await assertPermission("rates.write");
    const identity = input.identity as Parameters<typeof updateRateIdentity>[1];
    if (input.id) {
      await updateRateIdentity(input.id, identity, user.id);
      if (input.valuesChanged) await saveRateVersion(input.id, input.values as never, user.id);
    } else {
      await createRate(identity, input.values as never, user.id);
    }
    revalidatePath("/rates");
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

export async function setRateActiveAction(id: string, active: boolean): Promise<Result> {
  try {
    const user = await assertPermission("rates.write");
    await setRateActive(z.string().uuid().parse(id), active, user.id);
    revalidatePath("/rates");
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

export async function rateHistoryAction(id: string) {
  await assertPermission("rates.read");
  const rows = await rateHistory(z.string().uuid().parse(id));
  return rows.map((r) => ({ version: r.version, productionRate: r.productionRate, defaultCoats: r.defaultCoats, changeNote: r.changeNote, createdAt: r.createdAt.toISOString() }));
}

export async function saveMaterialAction(id: string | null, values: Record<string, string>): Promise<Result> {
  try {
    const user = await assertPermission("rates.write");
    await saveMaterial(id, values as never, user.id);
    revalidatePath("/rates");
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

export async function saveFactorAction(id: string | null, values: { kind: string; label: string; value: string }): Promise<Result> {
  try {
    const user = await assertPermission("rates.write");
    await saveFactor(id, values as never, user.id);
    revalidatePath("/rates");
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

export async function deleteFactorAction(id: string): Promise<Result> {
  try {
    const user = await assertPermission("rates.write");
    await deleteFactor(z.string().uuid().parse(id), user.id);
    revalidatePath("/rates");
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}
