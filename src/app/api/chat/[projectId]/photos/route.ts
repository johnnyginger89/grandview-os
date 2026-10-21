import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser, needsMfaEnrollment } from "@/lib/authz/guard";
import { safeErrorMessage } from "@/lib/action-error";
import { isSameOrigin } from "@/lib/same-origin";
import { ChatError, savePhoto } from "@/server/job-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** One photo (already made smaller in the browser) and its thumbnail; it joins a message when that's posted. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ projectId: string }> }) {
  if (!isSameOrigin(req)) return Response.json({ error: "Not allowed." }, { status: 403, headers: NO_STORE });
  const user = await getCurrentUser();
  if (!user || needsMfaEnrollment(user)) return Response.json({ error: "Please sign in again." }, { status: 401, headers: NO_STORE });
  const { projectId } = await ctx.params;
  try {
    const form = await req.formData();
    const photo = form.get("photo");
    const thumb = form.get("thumb");
    if (!(photo instanceof Blob) || !(thumb instanceof Blob)) return Response.json({ error: "Choose a photo." }, { status: 400, headers: NO_STORE });
    const saved = await savePhoto(user, projectId, {
      data: new Uint8Array(await photo.arrayBuffer()),
      thumb: new Uint8Array(await thumb.arrayBuffer()),
      width: form.get("width"),
      height: form.get("height"),
    });
    return Response.json({ photo: saved }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ error: "That photo couldn't be read. Try another one." }, { status: 400, headers: NO_STORE });
    const status = e instanceof ChatError ? 400 : 500;
    if (status === 500) console.error("[chat] photo upload failed", e instanceof Error ? e.message : e);
    return Response.json({ error: safeErrorMessage(e) }, { status, headers: NO_STORE });
  }
}
