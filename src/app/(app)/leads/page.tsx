import { asc } from "drizzle-orm";
import { Plus } from "lucide-react";
import { cookies } from "next/headers";
import { LinkButton } from "@/components/ui";
import { db } from "@/db";
import { pipelineStages } from "@/db/schema";
import { requirePermission } from "@/lib/authz/guard";
import { can } from "@/lib/authz/permissions";
import { decodeListPrefs, LIST_PREFS_COOKIE, parseListParams, type StageInfo } from "@/lib/pipeline/list-view";
import { listAssignableEstimators, listPipelineRows } from "@/server/pipeline-list";
import { getList } from "@/server/settings";
import { LeadsWorkspace } from "./leads-workspace";

export const metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePermission("pipeline.read");
  const state = parseListParams(await searchParams);
  // Read only: the browser writes this cookie (a cookie set by a Server Action would re-render the page).
  const prefs = decodeListPrefs((await cookies()).get(LIST_PREFS_COOKIE)?.value);
  const includeMoney = can(user.role, "estimates.read");
  const canEdit = can(user.role, "pipeline.write");

  const [stageRows, { rows, truncated }, lostReasons, leadSources, estimators] = await Promise.all([
    db.select().from(pipelineStages).orderBy(asc(pipelineStages.position)),
    listPipelineRows({ closed: state.closed, includeMoney }),
    getList("lost_reasons"),
    getList("lead_sources"),
    // Read-only roles see names from the rows; only editors need the full list.
    canEdit ? listAssignableEstimators() : Promise.resolve([]),
  ]);
  const stages: StageInfo[] = stageRows.map(({ id, key, name, kind, color, position, staleAfterDays }) => ({ id, key, name, kind, color, position, staleAfterDays }));

  return (
    <LeadsWorkspace
      initialView={state.view ?? prefs.view ?? "board"}
      initialState={state}
      initialPrefs={prefs}
      rows={rows}
      truncated={truncated}
      stages={stages}
      lostReasons={lostReasons}
      leadSources={leadSources}
      estimators={estimators}
      canEdit={canEdit}
      includeMoney={includeMoney}
      nowIso={new Date().toISOString()}
      headerActions={
        canEdit ? (
          <LinkButton href="/leads/new">
            <Plus className="size-4" /> New lead
          </LinkButton>
        ) : undefined
      }
    />
  );
}
