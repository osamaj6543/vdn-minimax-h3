"use client";

/** Ticking elapsed time for a live render. Self-stopping once the job ends. */
import { useEffect, useState } from "react";

import { formatClock, jobElapsedSeconds } from "@/lib/format";
import type { JobView } from "@/lib/types";

export function JobElapsed({
  job,
  prefix = "",
  className,
}: {
  job: JobView;
  prefix?: string;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const live = job.finished_at === null;

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);

  const seconds = jobElapsedSeconds(job, now);
  if (seconds === null) return null;

  return (
    <span className={className}>
      {prefix}
      {formatClock(seconds)}
    </span>
  );
}
