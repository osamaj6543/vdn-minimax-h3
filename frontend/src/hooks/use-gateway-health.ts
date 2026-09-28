"use client";

/** Live gateway reachability, for the shell's connection pill.
 *
 * Probes our own `/api/health`, which relays the gateway's `/healthz` from the
 * server — so the browser needs no knowledge of (or access to) the gateway, and
 * an operator can still tell "gateway down" from "my render is slow".
 */
import { useCallback, useEffect, useState } from "react";

import { checkHealth, type HealthReport } from "@/lib/api";

export type HealthState = "checking" | "online" | "offline";

const POLL_MS = 30_000;

export function useGatewayHealth(): {
  state: HealthState;
  /** Last probe result, including the failure cause when offline. */
  report: HealthReport | null;
  recheck: () => Promise<HealthState>;
} {
  const [state, setState] = useState<HealthState>("checking");
  const [report, setReport] = useState<HealthReport | null>(null);

  const probe = useCallback(async (): Promise<HealthState> => {
    const result = await checkHealth();
    const next: HealthState = result.ok ? "online" : "offline";
    setReport(result);
    setState(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const result = await checkHealth();
      if (cancelled) return;
      setReport(result);
      setState(result.ok ? "online" : "offline");
    };
    const kickoff = setTimeout(run, 0);
    const timer = setInterval(run, POLL_MS);
    const onFocus = () => run();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearTimeout(kickoff);
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return { state, report, recheck: probe };
}
