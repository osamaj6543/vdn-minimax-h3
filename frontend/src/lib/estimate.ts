/** Render-time estimates for the studio rail.
 *
 * A number is never invented: we prefer the tenant's own recent renders
 * (the worker stores per-NFE timings on every job), and only fall back to the
 * published VDN-H3 reference — 6.9 s of denoising for 8 steps on 8×B200 GPUs
 * (README) — clearly labelled as a reference figure.
 */
import type { JobView } from "@/lib/types";

/** README reference: 6.9 s denoise / 8 steps ≈ 0.86 s per NFE. */
export const REFERENCE_STEP_SECONDS = 6.9 / 8;
export const REFERENCE_LABEL = "8×B200 reference";

export interface StepTiming {
  /** Seconds per NFE. */
  seconds: number;
  /** How many samples the mean is built from. */
  samples: number;
  /** How to describe the source in the UI, e.g. "your last 4 renders". */
  label: string;
}

/** Mean seconds per NFE over the most recent measured renders (newest first). */
export function meanStepSeconds(jobs: JobView[], maxJobs = 8): StepTiming | null {
  let samples = 0;
  let total = 0;
  let used = 0;

  for (const job of jobs) {
    if (job.state !== "succeeded" || job.step_seconds.length === 0) continue;
    used += 1;
    for (const seconds of job.step_seconds) {
      if (seconds > 0) {
        total += seconds;
        samples += 1;
      }
    }
    if (used >= maxJobs) break;
  }

  if (samples === 0) return null;
  return {
    seconds: total / samples,
    samples,
    label: used === 1 ? "your last render" : `your last ${used} renders`,
  };
}

/** Denoising time for a step count, plus the basis to show next to it. */
export function estimateDenoise(
  steps: number,
  timing: StepTiming | null,
): { seconds: number; perStep: number; basis: string; fromHistory: boolean } {
  const perStep = timing?.seconds ?? REFERENCE_STEP_SECONDS;
  return {
    seconds: Math.max(0, steps) * perStep,
    perStep,
    basis: timing?.label ?? REFERENCE_LABEL,
    fromHistory: timing !== null,
  };
}
