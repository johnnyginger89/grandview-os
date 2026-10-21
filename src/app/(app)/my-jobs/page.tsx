import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/authz/guard";
import { todayIso } from "@/lib/calendar-date";
import { shortDay } from "@/lib/schedule/format";
import type { FieldJobView } from "@/lib/schedule/types";
import { listFieldJobs } from "@/server/my-jobs";
import { workOrderIdsForFieldJobs } from "@/server/work-orders";
import { canOpenMyJobs } from "./access";
import { JobCard } from "./job-card";

export const metadata = { title: "My Jobs" };

type Section = FieldJobView["section"];

function JobList({ jobs, workOrders }: { jobs: FieldJobView[]; workOrders: Record<string, string> }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {jobs.map((job) => (
        <JobCard key={job.entryId} job={job} workOrderHref={workOrders[job.entryId] ? `/my-jobs/work-orders/${workOrders[job.entryId]}` : null} />
      ))}
    </div>
  );
}

function JobSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const id = `my-jobs-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-sm font-semibold uppercase tracking-wide text-muted">
        {title} <span className="font-normal">({count})</span>
      </h2>
      {children}
    </section>
  );
}

export default async function MyJobs() {
  const user = await requireUser();
  if (!(await canOpenMyJobs(user))) redirect("/no-access");
  const jobs = await listFieldJobs(user);
  const workOrders = jobs.length ? await workOrderIdsForFieldJobs(user, jobs.map((j) => j.entryId)) : {};
  const by = (s: Section) => jobs.filter((j) => j.section === s);
  const [today, thisWeek, upcoming, recent] = [by("today"), by("this_week"), by("upcoming"), by("recent")];
  const current = today.length + thisWeek.length + upcoming.length;

  return (
    <>
      <PageHeader title="My Jobs" description={`Signed in as ${user.name}`} />
      {jobs.length === 0 ? (
        <EmptyState title="No jobs assigned to you yet" description="When a project manager schedules your crew on a job, it shows up here." />
      ) : (
        <div className="space-y-8">
          {today.length > 0 && (
            <JobSection title={`Today · ${shortDay(todayIso())}`} count={today.length}>
              <JobList jobs={today} workOrders={workOrders} />
            </JobSection>
          )}
          {thisWeek.length > 0 && (
            <JobSection title="This week" count={thisWeek.length}>
              <JobList jobs={thisWeek} workOrders={workOrders} />
            </JobSection>
          )}
          {upcoming.length > 0 && (
            <JobSection title="Coming up" count={upcoming.length}>
              <JobList jobs={upcoming} workOrders={workOrders} />
            </JobSection>
          )}
          {current === 0 && <p className="text-sm text-muted">Nothing booked for your crew in the next two months.</p>}
          {recent.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-muted">
                Recently finished <span className="font-normal">({recent.length})</span>
              </summary>
              <div className="mt-3">
                <JobList jobs={recent} workOrders={workOrders} />
              </div>
            </details>
          )}
        </div>
      )}
    </>
  );
}
