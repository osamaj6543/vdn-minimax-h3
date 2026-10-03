"use client";

/** The latest few renders, framed as a strip under the studio form. */
import Link from "next/link";
import { ArrowUpRight, Film, TriangleAlert } from "lucide-react";

import { JobProgress, JobStatusBadge, JobThumb } from "@/components/job-bits";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime, jobHeadline } from "@/lib/format";
import { TASK_LABELS, framesToSeconds, type JobView } from "@/lib/types";

export function RecentRenders({
  jobs,
  loading = false,
  problem = null,
}: {
  jobs: JobView[];
  loading?: boolean;
  /** Set when the last fetch failed (e.g. gateway down), so an outage is not
   *  reported as "no renders yet". */
  problem?: string | null;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium tracking-tight">Recent renders</h2>
          <p className="text-[0.7rem] text-muted-foreground">
            The newest jobs in this workspace, with live status
          </p>
        </div>
        <Link
          href="/jobs"
          className="group flex items-center gap-1 text-[0.75rem] text-muted-foreground transition-colors hover:text-foreground"
        >
          Open library
          <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : jobs.length === 0 && problem ? (
        <div className="panel flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="grid size-10 place-items-center rounded-xl border border-warning/30 bg-warning/[0.08] text-warning">
            <TriangleAlert className="size-4" />
          </span>
          <p className="text-sm font-medium">Gateway unreachable</p>
          <p className="max-w-md text-[0.75rem] leading-relaxed text-muted-foreground">
            {problem}
          </p>
        </div>
      ) : jobs.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 px-6 py-12 text-center">
          <span className="grid size-10 place-items-center rounded-xl border border-hairline bg-tint/[0.03] text-muted-foreground">
            <Film className="size-4" />
          </span>
          <p className="text-sm">No renders yet</p>
          <p className="max-w-sm text-[0.75rem] text-muted-foreground">
            Write a prompt above and queue your first VDN-H3 render — it will show
            up here and in the library.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {jobs.map((job) => (
            <Link
              key={job.job_id}
              href={`/jobs/${job.job_id}`}
              className="group panel overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:ring-gold/25"
            >
              <JobThumb job={job} />
              <div className="flex flex-col gap-2 p-3.5">
                <p className="line-clamp-2 min-h-9 text-[0.8rem] leading-snug text-foreground/90">
                  {jobHeadline(job, 140)}
                </p>
                <div className="flex items-center justify-between gap-2 text-[0.68rem] text-muted-foreground">
                  <span className="truncate">{TASK_LABELS[job.task]}</span>
                  <span className="shrink-0">{formatRelativeTime(job.created_at)}</span>
                </div>
                {job.state === "running" ? (
                  <JobProgress job={job} showLabel />
                ) : (
                  <div className="flex items-center justify-between">
                    <JobStatusBadge state={job.state} />
                    <span className="text-[0.68rem] text-muted-foreground num">
                      {framesToSeconds(job.num_frames).toFixed(1)}s · {job.num_steps} steps
                    </span>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
