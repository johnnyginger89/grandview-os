"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DEFAULT_PROPOSAL_TEMPLATE, SUGGESTED_NOTES } from "@/db/seed-data";
import { safeErrorMessage } from "@/lib/action-error";
import { assertPermission } from "@/lib/authz/guard";
import { SECTION_KEYS } from "@/lib/proposal-template/schema";
import { getSetting, saveProposalTemplateSection, setSetting } from "@/server/settings";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const sectionKey = z.enum(SECTION_KEYS);
const version = z.string().datetime({ offset: true }).nullable();
const REVIEW_KEY = "proposal_template_review";

/** Save one section of Settings → Proposals. `expectedUpdatedAt` is the version the form loaded. */
export async function saveProposalTemplateSectionAction(section: string, value: unknown, expectedUpdatedAt: string | null): Promise<Result<{ updatedAt: string }>> {
  try {
    const user = await assertPermission("settings.manage");
    const r = await saveProposalTemplateSection(sectionKey.parse(section), value, user.id, version.parse(expectedUpdatedAt));
    revalidatePath("/settings/proposals");
    return { ok: true, updatedAt: r.updatedAt };
  } catch (e) {
    return { ok: false, error: safeErrorMessage(e) };
  }
}

export async function resetProposalTemplateSectionAction(section: string, expectedUpdatedAt: string | null): Promise<Result<{ updatedAt: string }>> {
  try {
    const user = await assertPermission("settings.manage");
    const key = sectionKey.parse(section);
    const r = await saveProposalTemplateSection(key, DEFAULT_PROPOSAL_TEMPLATE[key], user.id, version.parse(expectedUpdatedAt));
    revalidatePath("/settings/proposals");
    return { ok: true, updatedAt: r.updatedAt };
  } catch (e) {
    return { ok: false, error: safeErrorMessage(e) };
  }
}

/** Overview checklist: the owner has read one of the "changed / suggested wording" notes. */
export async function markProposalNoteReviewedAction(id: string): Promise<Result> {
  try {
    const user = await assertPermission("settings.manage");
    const note = z.enum(SUGGESTED_NOTES.map((n) => n.id) as [string, ...string[]]).parse(id);
    const reviewed = await getSetting<string[]>(REVIEW_KEY, []);
    if (!reviewed.includes(note)) await setSetting(REVIEW_KEY, [...reviewed, note], user.id);
    revalidatePath("/settings/proposals");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: safeErrorMessage(e) };
  }
}
