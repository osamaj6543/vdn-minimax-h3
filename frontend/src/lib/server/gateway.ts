import "server-only";

/** Gateway reachability, shared by the proxy route and /api/health.
 *
 * A failed call to the VDN gateway is an operational state, not a mystery: this
 * module turns the underlying `fetch` failure into a short cause code
 * (`ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`, …) that both the terminal and the
 * UI can show, plus one actionable sentence for the person running it.
 */
import { gatewayUrl } from "./config";

interface FetchFailure {
  cause?: { code?: string };
  name?: string;
  message?: string;
}

/** Short, human-readable reason a gateway call could not complete. */
export function describeFailure(error: unknown): string {
  const failure = error as FetchFailure;
  return (
    failure?.cause?.code ??
    (failure?.name === "TimeoutError" || failure?.name === "AbortError"
      ? "ETIMEDOUT"
      : undefined) ??
    failure?.name ??
    "unreachable"
  );
}

/** Actionable line for the browser, e.g. when the gateway is not started. */
export function unreachableDetail(cause: string): string {
  const base = `Gateway unreachable at ${gatewayUrl()} (${cause}).`;
  if (cause === "ECONNREFUSED") {
    return `${base} Start it with: python -m server.app (worker: python -m server.worker --engine fake).`;
  }
  if (cause === "ENOTFOUND") {
    return `${base} Check the GATEWAY_URL host.`;
  }
  return `${base} Check the gateway is running and GATEWAY_URL is correct.`;
}

/** Unauthenticated liveness probe of the gateway's own `/healthz`. */
export async function probeGateway(
  timeoutMs = 4000,
): Promise<{ ok: boolean; cause?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${gatewayUrl()}/healthz`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, cause: `HTTP_${response.status}` };
    const body = (await response.json()) as { ok?: boolean };
    return body.ok === true ? { ok: true } : { ok: false, cause: "healthz_false" };
  } catch (error) {
    return { ok: false, cause: describeFailure(error) };
  } finally {
    clearTimeout(timer);
  }
}
