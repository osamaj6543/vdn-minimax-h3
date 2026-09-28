/** Presentation helpers for the studio, library and job detail pages.
 *
 * Pure functions only — no React, no DOM — so the same rules apply everywhere
 * a job is rendered (card meta, table row, detail header).
 */
import type { JobState, JobView } from "@/lib/types";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ABSOLUTE = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "just now" → "12m ago" → "3h ago" → "4d ago" → "Sep 17, 14:02". */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "—";
  const delta = now - time;
  if (delta < 45 * SECOND) return "just now";
  if (delta < HOUR) return `${Math.max(1, Math.round(delta / MINUTE))}m ago`;
  if (delta < DAY) return `${Math.round(delta / HOUR)}h ago`;
  if (delta < 7 * DAY) return `${Math.round(delta / DAY)}d ago`;
  return ABSOLUTE.format(time);
}

export function formatAbsolute(iso: string | null): string {
  if (!iso) return "—";
  const time = Date.parse(iso);
  return Number.isNaN(time) ? "—" : ABSOLUTE.format(time);
}

/** `m:ss`, for clip length and elapsed render time. */
export function formatClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatSeconds(seconds: number | null, digits = 1): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  return `${seconds.toFixed(digits)}s`;
}

/** Share of a live render already denoised: completed NFEs / requested NFEs. */
export function jobProgress(job: JobView): number {
  if (job.state === "succeeded") return 1;
  if (job.num_steps <= 0) return 0;
  return Math.min(1, Math.max(0, job.step_seconds.length / job.num_steps));
}

/** Seconds since the render started; `null` until a worker claims the job. */
export function jobElapsedSeconds(job: JobView, now: number = Date.now()): number | null {
  if (!job.started_at) return null;
  const start = Date.parse(job.started_at);
  if (Number.isNaN(start)) return null;
  if (job.finished_at) {
    const finish = Date.parse(job.finished_at);
    if (!Number.isNaN(finish)) return Math.max(0, (finish - start) / SECOND);
  }
  return Math.max(0, (now - start) / SECOND);
}

/** Queue-to-artifact wall time, i.e. what the user actually waited. */
export function jobWallSeconds(job: JobView): number | null {
  if (!job.finished_at) return null;
  const start = Date.parse(job.created_at);
  const finish = Date.parse(job.finished_at);
  if (Number.isNaN(start) || Number.isNaN(finish)) return null;
  return Math.max(0, (finish - start) / SECOND);
}

/** Mean seconds per NFE for one job, from the worker's own timing samples. */
export function averageStepSeconds(job: JobView): number | null {
  if (job.step_seconds.length === 0) return null;
  const total = job.step_seconds.reduce((sum, value) => sum + value, 0);
  return total / job.step_seconds.length;
}

/** One line of a card title: the prompt, collapsed and clipped. */
export function jobHeadline(job: JobView, max = 96): string {
  const prompt = job.prompt.replace(/\s+/g, " ").trim();
  return prompt.length > max ? `${prompt.slice(0, max - 1)}…` : prompt;
}

export const STATE_META: Record<
  JobState,
  { label: string; tone: "queued" | "live" | "success" | "failed" | "muted" }
> = {
  queued: { label: "Queued", tone: "queued" },
  running: { label: "Rendering", tone: "live" },
  succeeded: { label: "Ready", tone: "success" },
  failed: { label: "Failed", tone: "failed" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

/** Dark gradient set for tiles whose artifact is not loaded yet. */
const THUMB_TINTS = [
  "from-[#1b2740] via-[#131a28] to-[#0c0f16]",
  "from-[#2a2036] via-[#1a1524] to-[#0d0b14]",
  "from-[#12303a] via-[#0f2128] to-[#081014]",
  "from-[#332616] via-[#221a10] to-[#120e08]",
  "from-[#1d2b2a] via-[#141f1f] to-[#0b1112]",
  "from-[#2c1f24] via-[#1d151a] to-[#100b0d]",
];

/** Deterministic per-job tint, so a tile looks the same on every visit. */
export function thumbTint(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return THUMB_TINTS[Math.abs(hash) % THUMB_TINTS.length];
}
