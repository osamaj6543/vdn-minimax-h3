"use client";

/** Landing studio: the create form plus a live strip of the latest renders. */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Boxes, Gauge, Timer, Zap } from "lucide-react";

import { CreateVideoForm } from "@/components/create-video-form";
import { JobProgress, JobStatusBadge } from "@/components/job-bits";
import { RecentRenders } from "@/components/recent-renders";
import { listJobs } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { framesToSeconds, type JobView } from "@/lib/types";

const POLL_MS = 8000;

const FACTS = [
  { icon: Timer, label: "Denoise", value: "6.9s", hint: "8 steps, 8×B200" },
  { icon: Zap, label: "End-to-end", value: "9.0s", hint: "14.4s clip" },
  { icon: Gauge, label: "Pipeline", value: "8-step", hint: "distilled" },
  { icon: Boxes, label: "Modes", value: "5", hint: "t2v → ref2v" },
];

export default function DashboardPage() {
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await listJobs(12);
      setJobs(result.jobs);
      setProblem(null);
    } catch (error) {
      // Surfaced to RecentRenders: a down gateway must not read as "no renders".
      setProblem(error instanceof Error ? error.message : "Could not load renders");
    }
  }, []);

  useEffect(() => {
    // Kick the first load off a timer rather than the effect body, then poll.
    const tick = () => {
      void refresh();
    };
    const kickoff = setTimeout(tick, 0);
    const timer = setInterval(tick, POLL_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(timer);
    };
  }, [refresh]);

  const recent = jobs ?? [];
  const live = recent.find((job) => job.state === "running");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-2xl font-medium tracking-tight sm:text-[1.75rem]">
            Create
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Describe a shot, attach conditioning frames if the mode needs them,
            and VDN-H3 renders 768p / 24 fps with audio.
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-3">
          {FACTS.map(({ icon: Icon, label, value, hint }) => (
            <div key={label} className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-lg border border-hairline bg-white/[0.03] text-gold/80">
                <Icon className="size-4" />
              </span>
              <div className="flex flex-col">
                <dt className="text-[0.6rem] tracking-[0.18em] text-muted-foreground uppercase">
                  {label}
                </dt>
                <dd className="text-sm font-medium num">
                  {value} <span className="text-[0.7rem] font-normal text-muted-foreground">{hint}</span>
                </dd>
              </div>
            </div>
          ))}
        </dl>
      </header>

      {live && (
        <Link
          href={`/jobs/${live.job_id}`}
          className="panel flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]"
        >
          <JobStatusBadge state={live.state} />
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {live.prompt}
          </span>
          <JobProgress job={live} className="w-full sm:w-48" />
          <span className="text-[0.7rem] text-muted-foreground num">
            {formatRelativeTime(live.created_at)} ·{" "}
            {framesToSeconds(live.num_frames).toFixed(1)}s
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
        </Link>
      )}

      <CreateVideoForm jobs={recent} />

      <RecentRenders jobs={recent.slice(0, 4)} loading={jobs === null} problem={problem} />
    </div>
  );
}
