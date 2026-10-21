"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError } from "@/lib/action-error";
import { assertPermission, AuthorizationError } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { noticePreviewSchema, noticeSendSchema } from "@/lib/schedule/schemas";
import type { NoticePreview } from "@/lib/schedule/types";
import { ScheduleError, type ScheduleErrorReason } from "@/server/schedule";
import { composeStartNotice, sendStartNotice } from "@/server/start-notices";

/*
 * Start notices from the project page. This file is named actions.ts because the
 * architecture test allows sendStartNotice only in server action files of that
 * name (CLAUDE.md rule 8: a human click after a preview).
 */

export type NoticePreviewResult = { ok: true; preview: NoticePreview } | { ok: false; error: string };
export type NoticeSendResult = { ok: true; message: string } | { ok: false; error: string; reason?: ScheduleErrorReason };

async function assertCanNotify() {
  const user = await assertPermission("schedule.write");
  if (!can(user.role, "messages.send")) throw new AuthorizationError();
  return user;
}

function fail(e: unknown): { ok: false; error: string; reason?: ScheduleErrorReason } {
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check the email." };
  const r = actionError(e);
  return e instanceof ScheduleError && e.reason ? { ...r, reason: e.reason } : r;
}

export async function previewStartNoticeAction(input: unknown): Promise<NoticePreviewResult> {
  try {
    const user = await assertCanNotify();
    const v = noticePreviewSchema.parse(input);
    return { ok: true, preview: await composeStartNotice(v.projectId, v.kind, { name: user.name }, { variant: v.variant }) };
  } catch (e) {
    const { ok, error } = fail(e);
    return { ok, error };
  }
}

export async function sendStartNoticeAction(input: unknown): Promise<NoticeSendResult> {
  try {
    const user = await assertCanNotify();
    const v = noticeSendSchema.parse(input);
    const r = await sendStartNotice(v, { id: user.id, name: user.name });
    revalidatePath(`/projects/${v.projectId}`);
    revalidatePath("/schedule");
    return { ok: true, message: r.status === "sent" ? "Sent" : "Logged (email delivery is not configured in this environment)" };
  } catch (e) {
    return fail(e);
  }
}
