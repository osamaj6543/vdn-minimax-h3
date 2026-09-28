"use client";

/** Render detail: artifact, live denoise progress, per-NFE timings and the
 *  exact request that produced it.
 */
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  Clock,
  Copy,
  Cpu,
  Film,
  Gauge,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Timer,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { JobElapsed } from "@/components/job-elapsed";
import { JobProgress, JobStatusBadge, VideoPlayer } from "@/components/job-bits";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cancelJob, getJob } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import {
  averageStepSeconds,
  formatAbsolute,
  formatClock,
  formatRelativeTime,
  formatSeconds,
  jobProgress,
  jobWallSeconds,
} from "@/lib/format";
import { TERMINAL_STATES, TASK_LABELS, framesToSeconds, type JobView } from "@/lib/types";
import { cn } from "@/lib/utils";

const POLL_MS = 4000;

export default function JobDetailPage({ params }: PageProps<"/jobs/[id]">) {
  const { id } = use(params);
  const router = useRouter();
  const [job, setJob] = useState<JobView | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setJob(await getJob(id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load render");
    }
  }, [id]);

  useEffect(() => {
    // Initial load, kicked off a timer instead of the effect body; the poll
    // loop below takes over while the render is still alive.
    const kickoff = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(kickoff);
  }, [refresh]);

  useEffect(() => {
    if (!job || TERMINAL_STATES.includes(job.state)) return;
    const timer = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [job, refresh]);

  async function onCancel() {
    setCancelling(true);
    try {
      const updated = await cancelJob(id);
      setJob(updated);
      toast.success(updated.state === "cancelled" ? "Render cancelled" : "Cancel requested");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  }

  if (!job) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-lg" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <Skeleton className="aspect-video w-full max-w-4xl rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-20 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const live = !TERMINAL_STATES.includes(job.state);
  const progress = jobProgress(job);
  const wall = jobWallSeconds(job);
  const perNfe = averageStepSeconds(job);
  const cancelled = job.state === "cancelled";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Button
            variant="outline"
            size="icon"
            aria-label="Back to library"
            onClick={() => router.push("/jobs")}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-sm font-medium">
                {job.job_id.slice(0, 18)}…
              </h1>
              <JobStatusBadge state={job.state} />
              <span className="rounded-full border border-hairline bg-white/[0.03] px-2.5 py-0.5 text-[0.7rem] text-muted-foreground">
                {TASK_LABELS[job.task] ?? job.task}
              </span>
            </div>
            <p className="text-[0.72rem] text-muted-foreground">
              Created {formatAbsolute(job.created_at)}
              {job.finished_at ? ` · finished ${formatAbsolute(job.finished_at)}` : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => copyText(job.job_id, "Job id copied")}
          >
            <Copy className="size-3.5" />
            Job id
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => copyText(job.prompt, "Prompt copied")}
          >
            <Copy className="size-3.5" />
            Prompt
          </Button>
          {live && (
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw className="size-3.5" />
              Refresh
            </Button>
          )}
          {job.state === "running" && (
            <Button variant="destructive" size="sm" onClick={onCancel} disabled={cancelling}>
              {cancelling ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Ban className="size-3.5" />
              )}
              Cancel render
            </Button>
          )}
        </div>
      </header>

      {live && (
        <section className="panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-xl border border-gold/25 bg-gold/10 text-gold-soft">
                <Loader2 className="size-4 animate-spin" />
              </span>
              <div className="flex flex-col">
                <p className="text-sm font-medium">
                  {job.state === "queued" ? "Waiting for a worker" : "Denoising"}
                </p>
                <p className="text-[0.7rem] text-muted-foreground">
                  {job.state === "queued"
                    ? `Queued in the ${job.priority} lane on pool ${job.pool}`
                    : `${Math.min(job.step_seconds.length, job.num_steps)}/${job.num_steps} NFEs done · pool ${job.pool}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-[0.72rem] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Clock className="size-3.5" />
                <JobElapsed job={job} className="num" />
              </span>
              <span className="hidden items-center gap-1.5 sm:flex">
                <Gauge className="size-3.5" />
                <span className="num">{Math.round(progress * 100)}%</span>
              </span>
              <span className="hidden text-[0.65rem] sm:inline">
                refreshing every {POLL_MS / 1000}s
              </span>
            </div>
          </div>
          <JobProgress job={job} showLabel className="mt-4" />
        </section>
      )}

      {job.state === "succeeded" && <VideoPlayer job={job} />}

      {job.state === "failed" && (
        <section className="panel border-destructive/30 p-5">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl border border-destructive/30 bg-destructive/10 text-destructive">
              <TriangleAlert className="size-4" />
            </span>
            <div className="flex flex-col">
              <p className="text-sm font-medium text-destructive">Render failed</p>
              <p className="text-[0.7rem] text-muted-foreground">
                The worker reported an error. Prompt and settings below are intact —
                adjust and re-queue from the studio.
              </p>
            </div>
          </div>
          <pre className="mt-4 max-h-64 overflow-auto rounded-lg border border-hairline bg-black/40 p-3 font-mono text-[0.7rem] whitespace-pre-wrap text-destructive/90">
            {job.error ?? "No error detail was recorded."}
          </pre>
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ variant: "brand", size: "sm" }), "mt-4")}
          >
            Back to studio
          </Link>
        </section>
      )}

      {cancelled && (
        <section className="panel flex items-center gap-3 p-5 text-sm text-muted-foreground">
          <Ban className="size-4" />
          This render was cancelled before an artifact was kept.
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          icon={Film}
          label="Clip"
          value={`${framesToSeconds(job.num_frames).toFixed(1)}s`}
          hint={`${job.num_frames} frames · 24 fps`}
        />
        <Tile
          icon={Gauge}
          label="Sampling"
          value={`${job.num_steps} steps`}
          hint={job.num_steps === 8 ? "Fast lane (distilled)" : "High quality"}
        />
        <Tile
          icon={Cpu}
          label="Avg NFE"
          value={perNfe === null ? "—" : formatSeconds(perNfe, 2)}
          hint={`${job.step_seconds.length} samples`}
        />
        <Tile
          icon={Timer}
          label="Wall time"
          value={wall === null ? "—" : formatClock(wall)}
          hint={live ? "still running" : "queue → artifact"}
        />
      </section>

      {job.step_seconds.length > 0 && (
        <section className="panel p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium tracking-tight">Per-NFE timings</h2>
              <p className="text-[0.7rem] text-muted-foreground">
                Seconds per denoising step, as measured by the worker
              </p>
            </div>
            <div className="flex items-center gap-4 text-[0.7rem] text-muted-foreground">
              <span className="num">
                min {formatSeconds(Math.min(...job.step_seconds), 2)}
              </span>
              <span className="num">
                max {formatSeconds(Math.max(...job.step_seconds), 2)}
              </span>
              <span className="num">avg {formatSeconds(perNfe, 2)}</span>
            </div>
          </div>
          <StepBars values={job.step_seconds} expected={job.num_steps} />
        </section>
      )}

      <section className="panel p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium tracking-tight">Request</h2>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => copyText(job.prompt, "Prompt copied")}
          >
            <Copy className="size-3" />
            Copy
          </Button>
        </div>
        <Separator className="my-3" />
        <p className="rounded-lg border border-hairline bg-black/30 p-3 text-[0.8rem] leading-relaxed whitespace-pre-wrap">
          {job.prompt}
        </p>
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-[0.75rem] sm:grid-cols-2">
          <Detail label="Task" value={TASK_LABELS[job.task] ?? job.task} />
          <Detail label="Priority" value={job.priority} />
          <Detail label="Seed" value={String(job.seed)} mono />
          <Detail label="Pool" value={job.pool} mono />
          <Detail
            label="Images"
            value={
              job.image_keys.length > 0
                ? `${job.image_keys.length} attached`
                : "none (text-only)"
            }
          />
          <Detail label="Created" value={formatRelativeTime(job.created_at)} />
          {job.started_at && (
            <Detail label="Started" value={formatAbsolute(job.started_at)} />
          )}
          {job.finished_at && (
            <Detail label="Finished" value={formatAbsolute(job.finished_at)} />
          )}
        </dl>
        {job.image_keys.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {job.image_keys.map((key, index) => (
              <li
                key={key}
                className="flex items-center gap-1.5 rounded-lg border border-hairline bg-white/[0.02] px-2 py-1 font-mono text-[0.65rem] text-muted-foreground"
              >
                <ImageIcon className="size-3" />
                {index + 1}. {key.slice(0, 16)}…
              </li>
            ))}
          </ul>
        )}
      </section>


    </div>
  );
}


function Tile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="panel flex items-center gap-3 p-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-hairline bg-white/[0.03] text-gold/80">
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="text-[0.6rem] tracking-[0.18em] text-muted-foreground uppercase">
          {label}
        </span>
        <span className="truncate text-sm font-medium num">{value}</span>
        <span className="truncate text-[0.65rem] text-muted-foreground">{hint}</span>
      </div>
    </div>
  );
}

/** Bar per NFE, scaled to the slowest step in the run. Missing steps (a render
 *  still in flight) render as empty slots so the bar count matches `expected`. */
function StepBars({ values, expected }: { values: number[]; expected: number }) {
  const slots = Math.max(expected, values.length);
  const peak = Math.max(...values, 0.0001);

  return (
    <div
      className="mt-4 flex h-24 items-end gap-1"
      role="img"
      aria-label={`${values.length} denoising steps, slowest ${peak.toFixed(2)} seconds`}
    >
      {Array.from({ length: slots }).map((_, index) => {
        const value = values[index];
        const height = value === undefined ? 0 : Math.max((value / peak) * 100, 4);
        return (
          <div
            key={index}
            title={
              value === undefined
                ? `NFE ${index + 1}: pending`
                : `NFE ${index + 1}: ${value.toFixed(2)}s`
            }
            className="group/bar relative flex h-full flex-1 items-end rounded-sm bg-white/[0.025]"
          >
            <span
              className="w-full rounded-sm bg-gradient-to-t from-gold/35 via-gold to-gold-soft transition-all"
              style={{ height: `${height}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hairline pb-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("truncate", mono && "font-mono text-[0.7rem] num")}>{value}</dd>
    </div>
  );
}

