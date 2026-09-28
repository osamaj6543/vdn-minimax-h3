/** Mirror of the gateway's wire schemas (server/schemas.py). */

export type Task = "t2v" | "i2v" | "l2v" | "fl2v" | "ref2v";
export type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobView {
  job_id: string;
  task: Task;
  state: JobState;
  prompt: string;
  num_frames: number;
  num_steps: number;
  seed: number;
  priority: string;
  pool: string;
  image_keys: string[];
  error: string | null;
  artifact_url: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  step_seconds: number[];
}

/** The signed-in caller, as far as the browser needs to know.
 *
 * Mirrors the server's UserDto (`src/lib/server/appwrite.ts`). Deliberately
 * minimal: no tokens, no session material, nothing the client cannot be told.
 */
export interface User {
  id: string;
  email: string;
  name: string;
  labels: string[];
  /** ISO date string. */
  registeredAt: string;
}

export const TERMINAL_STATES: JobState[] = ["succeeded", "failed", "cancelled"];
export const TASK_LABELS: Record<Task, string> = {
  t2v: "Text → Video",
  i2v: "First frame → Video",
  l2v: "Last frame → Video",
  fl2v: "First + last → Video",
  ref2v: "References → Video",
};

/** Frames must be 17n+5 (repo rule); 345 = 14.4 s at 24 fps. */
export const FRAME_OPTIONS = Array.from({ length: 14 }, (_, i) => 17 * (i + 7) + 5);

export function framesToSeconds(frames: number): number {
  return Math.round((frames / 24) * 10) / 10;
}
