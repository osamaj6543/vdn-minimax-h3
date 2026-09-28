"use client";

/** Library: filter, search and inspect every render in the workspace. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Ban,
  Copy,
  Film,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { JobElapsed } from "@/components/job-elapsed";
import { JobProgress, JobStatusBadge, JobThumb } from "@/components/job-bits";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cancelJob, listJobs } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import {
  averageStepSeconds,
  formatRelativeTime,
  formatSeconds,
  jobHeadline,
} from "@/lib/format";
import {
  TERMINAL_STATES,
  TASK_LABELS,
  framesToSeconds,
  type JobState,
  type JobView,
  type Task,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type FilterKey = "all" | "live" | JobState;
type ViewMode = "grid" | "list";

const FILTERS: { key: FilterKey; label: string; match: (job: JobView) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  {
    key: "live",
    label: "In progress",
    match: (job) => !TERMINAL_STATES.includes(job.state),
  },
  { key: "succeeded", label: "Ready", match: (job) => job.state === "succeeded" },
  { key: "failed", label: "Failed", match: (job) => job.state === "failed" },
  { key: "cancelled", label: "Cancelled", match: (job) => job.state === "cancelled" },
];

const LIVE_POLL_MS = 5000;
const IDLE_POLL_MS = 25000;

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Kept separate from `jobs` so an outage reads as an outage, not as an empty
  // library: a gateway that is down must never look like "no renders yet".
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [task, setTask] = useState<Task | "all">("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>("grid");
  const jobsRef = useRef<JobView[] | null>(null);
  const lastFetch = useRef(0);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const result = await listJobs(60);
      const sorted = [...result.jobs].sort(
        (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
      );
      setJobs(sorted);
      setLoadError(null);
      lastFetch.current = Date.now();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not load renders";
      setLoadError(message);
      if (!silent) toast.error(message);
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    // Fast poll only while something is actually rendering; otherwise a slow
    // heartbeat keeps the list fresh without hammering the gateway.
    const tick = () => {
      const live = jobsRef.current?.some((job) => !TERMINAL_STATES.includes(job.state));
      const stale = Date.now() - lastFetch.current > IDLE_POLL_MS;
      if (live || stale) void refresh(true);
    };
    const kickoff = setTimeout(tick, 0);
    const timer = setInterval(tick, LIVE_POLL_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(timer);
    };
  }, [refresh]);

  const counts = useMemo(() => {
    const source = jobs ?? [];
    return Object.fromEntries(
      FILTERS.map((entry) => [
        entry.key,
        source.filter((job) => entry.match(job)).length,
      ]),
    ) as Record<FilterKey, number>;
  }, [jobs]);

  const visible = useMemo(() => {
    const source = jobs ?? [];
    const active = FILTERS.find((entry) => entry.key === filter) ?? FILTERS[0];
    const needle = query.trim().toLowerCase();
    return source.filter((job) => {
      if (!active.match(job)) return false;
      if (task !== "all" && job.task !== task) return false;
      if (!needle) return true;
      return (
        job.prompt.toLowerCase().includes(needle) ||
        job.job_id.toLowerCase().includes(needle) ||
        (TASK_LABELS[job.task] ?? job.task).toLowerCase().includes(needle)
      );
    });
  }, [jobs, filter, task, query]);

  async function onCopyPrompt(job: JobView) {
    await copyText(job.prompt, "Prompt copied");
  }

  async function onCancel(job: JobView) {
    try {
      const updated = await cancelJob(job.job_id);
      setJobs((current) =>
        current
          ? current.map((entry) => (entry.job_id === updated.job_id ? updated : entry))
          : current,
      );
      toast.success(updated.state === "cancelled" ? "Render cancelled" : "Cancel requested");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cancel failed");
    }
  }

  const liveCount = counts.live ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-2xl font-medium tracking-tight sm:text-[1.75rem]">
            Library
          </h1>
          <p className="text-sm text-muted-foreground">
            {jobs === null
              ? "Loading renders…"
              : `${jobs.length} render${jobs.length === 1 ? "" : "s"}`}
            {liveCount > 0 && (
              <>
                {" · "}
                <span className="text-gold-soft">
                  {liveCount} in progress
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-hairline bg-white/[0.02] p-0.5">
            {([
              { key: "grid" as ViewMode, icon: LayoutGrid, label: "Grid view" },
              { key: "list" as ViewMode, icon: List, label: "List view" },
            ]).map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                type="button"
                aria-label={label}
                aria-pressed={view === key}
                onClick={() => setView(key)}
                className={cn(
                  "grid size-7 place-items-center rounded-md transition-colors",
                  view === key
                    ? "bg-white/[0.07] text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh()}
            disabled={refreshing}
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-pressed={filter === entry.key}
              onClick={() => setFilter(entry.key)}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-full border px-3 text-[0.75rem] transition-colors",
                filter === entry.key
                  ? "border-gold/30 bg-gold/10 text-gold-soft"
                  : "border-hairline bg-white/[0.02] text-muted-foreground hover:text-foreground",
              )}
            >
              {entry.label}
              <span className="num text-[0.7rem] opacity-70">{counts[entry.key] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search prompt or job id"
              aria-label="Search renders"
              className="pl-8"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <Select
            value={task}
            onValueChange={(value) => value && setTask(value as Task | "all")}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modes</SelectItem>
              {(Object.keys(TASK_LABELS) as Task[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {TASK_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {jobs && jobs.length > 0 && loadError && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/30 bg-warning/[0.08] px-3 py-2 text-[0.72rem] text-warning">
          <TriangleAlert className="size-3.5 shrink-0" />
          <span>Last refresh failed — the list below may be stale.</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{loadError}</span>
        </div>
      )}

      {jobs === null ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : jobs.length === 0 && loadError ? (
        <EmptyState
          title="Gateway unreachable"
          body={loadError}
          action={
            <Button variant="brand" size="sm" onClick={() => refresh()}>
              <RefreshCw className="size-3.5" />
              Retry
            </Button>
          }
        />
      ) : jobs.length === 0 ? (
        <EmptyState
          title="No renders yet"
          body="Queue your first VDN-H3 render and it will appear here with live status, timings and a playable artifact."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="Nothing matches these filters"
          body="Clear the search or pick another status to see renders again."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQuery("");
                setFilter("all");
                setTask("all");
              }}
            >
              Reset filters
            </Button>
          }
        />
      ) : view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((job) => (
            <JobCard
              key={job.job_id}
              job={job}
              onCopy={() => onCopyPrompt(job)}
              onCancel={() => onCancel(job)}
            />
          ))}
        </div>
      ) : (
        <JobList
          jobs={visible}
          onCopy={onCopyPrompt}
          onCancel={onCancel}
        />
      )}
    </div>
  );
}



function JobCard({
  job,
  onCopy,
  onCancel,
}: {
  job: JobView;
  onCopy: () => void;
  onCancel: () => void;
}) {
  const average = averageStepSeconds(job);
  const href = `/jobs/${job.job_id}` as const;

  return (
    <article className="group panel flex flex-col overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:ring-gold/20">
      <Link href={href} aria-label="Open render detail" className="block">
        <JobThumb job={job} />
      </Link>

      <div className="flex flex-1 flex-col gap-3.5 p-4">
        <Link href={href} className="min-w-0">
          <p className="line-clamp-2 text-[0.82rem] leading-snug text-foreground/90 transition-colors group-hover:text-foreground">
            {jobHeadline(job, 150)}
          </p>
        </Link>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[0.7rem]">
          <Meta label="Mode" value={TASK_LABELS[job.task] ?? job.task} />
          <Meta
            label="Spec"
            value={`${framesToSeconds(job.num_frames).toFixed(1)}s · ${job.num_steps} steps`}
          />
          <Meta label="Seed" value={String(job.seed)} mono />
          {job.state === "running" ? (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Elapsed</dt>
              <dd className="num">
                <JobElapsed job={job} />
              </dd>
            </div>
          ) : (
            <Meta
              label="Avg NFE"
              value={average === null ? "—" : formatSeconds(average, 2)}
              mono
            />
          )}
        </dl>

        {job.state === "running" && <JobProgress job={job} showLabel />}

        {job.error && job.state === "failed" && (
          <p className="line-clamp-2 rounded-lg border border-destructive/25 bg-destructive/[0.07] px-2.5 py-2 text-[0.7rem] text-destructive">
            {job.error}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-hairline pt-3">
          <JobStatusBadge state={job.state} />
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              title="Copy prompt"
              aria-label="Copy prompt"
              onClick={onCopy}
            >
              <Copy className="size-3.5" />
            </Button>
            {(job.state === "queued" || job.state === "running") && (
              <Button
                variant="ghost"
                size="icon-sm"
                title="Cancel render"
                aria-label="Cancel render"
                onClick={onCancel}
              >
                <Ban className="size-3.5" />
              </Button>
            )}
            <Link
              href={href}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7")}
            >
              Open
            </Link>
          </div>
        </div>
        <p className="text-[0.65rem] text-muted-foreground">
          Created {formatRelativeTime(job.created_at)}
          {job.finished_at ? ` · finished ${formatRelativeTime(job.finished_at)}` : ""}
        </p>
      </div>
    </article>
  );
}


function JobList({
  jobs,
  onCopy,
  onCancel,
}: {
  jobs: JobView[];
  onCopy: (job: JobView) => void;
  onCancel: (job: JobView) => void;
}) {
  return (
    <div className="panel overflow-hidden">
      <ul className="divide-y divide-hairline">
        {jobs.map((job) => (
          <li
            key={job.job_id}
            className="flex flex-wrap items-center gap-4 px-4 py-3 transition-colors hover:bg-white/[0.02]"
          >
            <Link
              href={`/jobs/${job.job_id}`}
              className="w-28 shrink-0 overflow-hidden rounded-lg border border-hairline"
            >
              <JobThumb job={job} />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Link href={`/jobs/${job.job_id}`} className="min-w-0">
                <p className="truncate text-[0.82rem] text-foreground/90">
                  {jobHeadline(job, 110)}
                </p>
              </Link>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.68rem] text-muted-foreground">
                <span>{TASK_LABELS[job.task] ?? job.task}</span>
                <span className="num">
                  {framesToSeconds(job.num_frames).toFixed(1)}s · {job.num_steps} steps
                </span>
                <span className="font-mono text-[0.62rem]">
                  {job.job_id.slice(0, 12)}…
                </span>
                <span>{formatRelativeTime(job.created_at)}</span>
              </div>
              {job.state === "running" && (
                <JobProgress job={job} showLabel className="max-w-md" />
              )}
            </div>
            <div className="ml-auto flex items-center gap-3">
              {job.state === "running" && (
                <JobElapsed
                  job={job}
                  prefix=""
                  className="num text-[0.7rem] text-muted-foreground"
                />
              )}
              <JobStatusBadge state={job.state} />
              <Button
                variant="ghost"
                size="icon-sm"
                title="Copy prompt"
                aria-label="Copy prompt"
                onClick={() => onCopy(job)}
              >
                <Copy className="size-3.5" />
              </Button>
              {(job.state === "queued" || job.state === "running") && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Cancel render"
                  aria-label="Cancel render"
                  onClick={() => onCancel(job)}
                >
                  <Ban className="size-3.5" />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Meta({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("truncate", mono && "num font-mono text-[0.65rem]")}>{value}</dd>
    </div>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="grid size-11 place-items-center rounded-xl border border-hairline bg-white/[0.03] text-muted-foreground">
        <Film className="size-5" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mx-auto max-w-md text-[0.75rem] leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
      {action ?? (
        <Link href="/dashboard" className={buttonVariants({ variant: "brand", size: "sm" })}>
          <Sparkles className="size-3.5" />
          Create a render
        </Link>
      )}
    </div>
  );
}

