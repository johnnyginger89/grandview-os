import { getCurrentUser } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { colourEmailDraft, listColourSelections } from "@/server/colour-selections";
import { ColoursPanel } from "./colours-panel";

/** "Colours" card on the job page: the customer's colour forms, filled in here, by the colour consultant or by the customer's link. */
export async function ColoursCard({ projectId, className }: { projectId: string; className?: string }) {
  const viewer = await getCurrentUser();
  if (!viewer || !can(viewer.role, "projects.read_all")) return null;
  const canEdit = can(viewer.role, "projects.write");
  const list = await listColourSelections(projectId);
  const drafts = canEdit
    ? Object.fromEntries(
        await Promise.all(
          list.filter((s) => s.status === "draft" || s.status === "sent").map(async (s) => [s.id, await colourEmailDraft(s.id, { name: viewer.name })] as const),
        ),
      )
    : {};
  return <ColoursPanel className={className} projectId={projectId} canEdit={canEdit} selections={list} emailDrafts={drafts} />;
}
