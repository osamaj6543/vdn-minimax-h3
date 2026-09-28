"use client";

/** Job presentation layer: status pill, denoise progress, auth-gated player and
 *  the library's hover-preview thumbnail.
 */
import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Play } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { fetchArtifactUrl } from "@/lib/api";
import { jobProgress, thumbTint, STATE_META } from "@/lib/format";
import { framesToSeconds, type JobState, type JobView } from "@/lib/types";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Artifact cache                                                             */
/* -------------------------------------------------------------------------- */

/** Blob URLs are expensive to build (the artifact endpoint is auth-gated, so a
 *  plain `src` is impossible) and expensive to hold. One small LRU keeps a
 *  re-visit from re-downloading while capping memory at a few clips.
 */
const CACHE = new Map<string, string>();
const CACHE_MAX = 8;

async function cachedArtifactUrl(artifactId: string): Promise<string> {
  const hit = CACHE.get(artifactId);
  if (hit) {
    CACHE.delete(artifactId); // re-insert to mark as most recent
    CACHE.set(artifactId, hit);
    return hit;
  }
  const url = await fetchArtifactUrl(artifactId);
  CACHE.set(artifactId, url);
  while (CACHE.size > CACHE_MAX) {
    const oldest = CACHE.keys().next().value;
    if (oldest === undefined) break;
    const stale = CACHE.get(oldest);
    CACHE.delete(oldest);
    if (stale) URL.revokeObjectURL(stale);
  }
  return url;
}

/** Resolves an artifact to a blob URL once `enabled`. The URL is owned by the
 *  cache (revoked on eviction), never by the component. */
function useArtifact(artifactId: string | null, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    if (!artifactId || !enabled) return;
    let cancelled = false;
    cachedArtifactUrl(artifactId)
      .then((blobUrl) => {
        if (!cancelled) setUrl(blobUrl);
      })
      .catch((exc: unknown) => {
        if (!cancelled) {
          setFailure({
            id: artifactId,
            message: exc instanceof Error ? exc.message : "Could not load video",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [artifactId, enabled]);

  // Keyed by artifact id, so a failure never leaks onto another job's tile.
  const error = failure && failure.id === artifactId ? failure.message : null;
  return { url, error, loading: enabled && !url && !error };
}

/* -------------------------------------------------------------------------- */
/* Status + progress                                                          */
/* -------------------------------------------------------------------------- */

const TONE: Record<string, string> = {
  queued: "border-hairline bg-white/[0.04] text-muted-foreground",
  live: "border-gold/30 bg-gold/10 text-gold-soft",
  success: "border-success/25 bg-success/10 text-success",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
  muted: "border-hairline bg-white/[0.03] text-muted-foreground",
};

export function JobStatusBadge({
  state,
  className,
}: {
  state: JobState;
  className?: string;
}) {
  const meta = STATE_META[state];
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[0.7rem] font-medium",
        TONE[meta.tone],
        className,
      )}
    >
      {meta.tone === "live" ? (
        <span className="status-dot text-gold" />
      ) : (
        <span className="size-1.5 rounded-full bg-current opacity-70" />
      )}
      {meta.label}
    </span>
  );
}

/** Denoise progress, straight from the worker's per-NFE samples. */
export function JobProgress({
  job,
  showLabel = false,
  className,
}: {
  job: JobView;
  showLabel?: boolean;
  className?: string;
}) {
  const progress = jobProgress(job);
  if (job.state === "queued") return null;

  const width = job.state === "running" ? Math.max(progress * 100, 3) : progress * 100;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {showLabel && (
        <div className="flex items-center justify-between text-[0.7rem] text-muted-foreground">
          <span>
            {job.state === "succeeded"
              ? "Completed"
              : `NFE ${Math.min(job.step_seconds.length, job.num_steps)}/${job.num_steps}`}
          </span>
          <span className="num">{Math.round(progress * 100)}%</span>
        </div>
      )}
      <span className="track">
        <span
          className={cn(
            "block h-full rounded-full",
            job.state === "failed" || job.state === "cancelled"
              ? "bg-destructive/60"
              : "animate-sweep bg-gradient-to-r from-gold/50 via-gold to-gold/60",
          )}
          style={{ width: `${width}%` }}
        />
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Player                                                                     */
/* -------------------------------------------------------------------------- */

/** Auth-gated mp4 in a 16:9 frame, with the actions an operator expects. */
export function VideoPlayer({
  job,
  autoPlay = true,
}: {
  job: JobView;
  autoPlay?: boolean;
}) {
  const artifact = useArtifact(job.artifact_url, Boolean(job.artifact_url));

  return (
    <div className="panel overflow-hidden">
      <div className="relative aspect-video w-full bg-black">
        {artifact.url ? (
          <video
            src={artifact.url}
            controls
            autoPlay={autoPlay}
            loop
            playsInline
            className="size-full object-contain"
          />
        ) : artifact.error ? (
          <div className="grid size-full place-items-center p-6 text-center text-sm text-destructive">
            {artifact.error}
          </div>
        ) : (
          <div className="grid size-full place-items-center">
            <span className="flex flex-col items-center gap-3 text-xs text-muted-foreground">
              <Loader2 className="size-5 animate-spin text-gold" />
              Streaming artifact…
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-hairline px-4 py-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-[0.7rem] text-muted-foreground">
            {framesToSeconds(job.num_frames).toFixed(1)}s · {job.num_frames} frames · 24 fps ·{" "}
            {job.num_steps} steps
          </span>
          <span className="truncate font-mono text-[0.7rem] text-muted-foreground/70">
            {job.job_id}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {artifact.url && (
            <a
              href={artifact.url}
              download={`${job.job_id}.mp4`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Download className="size-3.5" />
              Download mp4
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Library thumbnail                                                          */
/* -------------------------------------------------------------------------- */

/** 16:9 tile. The clip is fetched only after the pointer rests on the card, so
 *  a library of 50 renders does not pull 50 videos on load. */
export function JobThumb({
  job,
  className,
}: {
  job: JobView;
  className?: string;
}) {
  const playable = job.state === "succeeded" && Boolean(job.artifact_url);
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const artifact = useArtifact(job.artifact_url, playable && armed);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function arm() {
    if (!playable || armed) return;
    timer.current = setTimeout(() => setArmed(true), 350);
  }

  function disarm() {
    if (timer.current) clearTimeout(timer.current);
  }

  return (
    <div
      onMouseEnter={arm}
      onMouseLeave={disarm}
      onFocus={arm}
      className={cn(
        "relative aspect-video w-full overflow-hidden bg-surface-raised",
        className,
      )}
    >
      {artifact.url ? (
        <video
          src={artifact.url}
          muted
          autoPlay
          loop
          playsInline
          className="size-full object-cover"
        />
      ) : (
        <>
          <div className={cn("size-full bg-gradient-to-br", thumbTint(job.job_id))} />
          <div
            aria-hidden
            className="grid-lines absolute inset-0 opacity-50"
          />
          <div className="absolute inset-0 grid place-items-center">
            {playable ? (
              <span className="grid size-11 place-items-center rounded-full border border-white/10 bg-black/45 backdrop-blur-sm transition-transform duration-300 group-hover:scale-105">
                <Play className="size-4 translate-x-px text-gold-soft" fill="currentColor" />
              </span>
            ) : job.state === "running" ? (
              <span className="shimmer grid size-11 place-items-center rounded-full border border-gold/20 bg-black/40">
                <Loader2 className="size-4 animate-spin text-gold" />
              </span>
            ) : (
              <span className="grid size-11 place-items-center rounded-full border border-white/5 bg-black/30 text-muted-foreground">
                <Play className="size-4 translate-x-px" />
              </span>
            )}
          </div>
        </>
      )}

      <div className="absolute top-2.5 left-2.5">
        <JobStatusBadge state={job.state} className="backdrop-blur-sm" />
      </div>
      <div className="absolute top-2.5 right-2.5 rounded-md border border-white/10 bg-black/50 px-1.5 py-0.5 text-[0.65rem] text-white/80 backdrop-blur-sm num">
        {framesToSeconds(job.num_frames).toFixed(1)}s
      </div>

      {job.state === "running" && (
        <JobProgress job={job} className="absolute inset-x-0 bottom-0 px-2.5 pb-2.5" />
      )}
    </div>
  );
}

