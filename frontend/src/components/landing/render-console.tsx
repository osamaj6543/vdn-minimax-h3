"use client";

/** The hero's product shot: a live-looking render console.
 *
 *  It is drawn from the studio's own primitives (`.panel`, `.well`, `.track`,
 *  `.status-dot`, the gold sweep) and reuses `thumbTint` from `@/lib/format`
 *  for the artifact tile, so what a visitor sees is exactly what the app
 *  renders — not a screenshot that can drift. The animation loops the eight
 *  published NFEs; `prefers-reduced-motion` pins it to the finished state, and
 *  the first paint is always the deterministic "queued" frame.
 */
import { useEffect, useState } from "react";
import { Check, Cpu, Film, Layers, Route, Timer } from "lucide-react";

import { VdnMark } from "@/components/brand";
import { REFERENCE } from "@/lib/landing";
import { thumbTint } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Per-NFE seconds from the published 8×B200 reference; they sum to 6.9 s. */
const STEP_SECONDS = [0.88, 0.86, 0.85, 0.87, 0.84, 0.86, 0.85, 0.89];
const SLOWEST = Math.max(...STEP_SECONDS);
const TICK_MS = 340;
const HOLD_MS = 3400;

const PROMPT =
  "integrated_multimodal_description: A slow dolly through a rain-slicked neon " +
  "alley; a courier in a translucent poncho looks up as a drone passes, puddle " +
  "reflections rippling. Audio: rain, distant traffic, a soft synth swell.";

const SPEC: { icon: typeof Layers; label: string; value: string }[] = [
  { icon: Layers, label: "Mode", value: "Text → Video" },
  { icon: Film, label: "Frames", value: `${REFERENCE.frames} (17n+5)` },
  { icon: Timer, label: "Steps", value: `${REFERENCE.steps} · distilled` },
  { icon: Route, label: "Pool", value: "b200 · priority high" },
];

export function RenderConsole() {
  const [done, setDone] = useState(0);
  const complete = done >= STEP_SECONDS.length;
  const elapsed = STEP_SECONDS.slice(0, done).reduce((sum, value) => sum + value, 0);
  const progress = done / STEP_SECONDS.length;

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      if (complete) return;
      // Deferred rather than called straight from the effect body: a synchronous
      // setState there would cascade a render the effect never needed
      // (react-hooks/set-state-in-effect).
      const pin = window.setTimeout(() => setDone(STEP_SECONDS.length), 0);
      return () => window.clearTimeout(pin);
    }

    const timer = window.setTimeout(
      () => setDone((value) => (value >= STEP_SECONDS.length ? 0 : value + 1)),
      complete ? HOLD_MS : TICK_MS,
    );
    return () => window.clearTimeout(timer);
  }, [done, complete]);

  return (
    <div className="relative">
      <div
        aria-hidden
        className="animate-drift pointer-events-none absolute -top-16 -right-10 size-72 rounded-full bg-gold/[0.09] blur-3xl"
      />

      <div className="panel relative overflow-hidden">
        {/* job header */}
        <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-gold/25 bg-gold/10 text-gold-soft">
            <VdnMark className="h-3.5" title="" />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[0.78rem] font-medium">Create render</span>
            <span className="truncate font-mono text-[0.65rem] text-muted-foreground">
              job_7f4c1ab2 · 768p · 24 fps
            </span>
          </div>
          <span
            className={cn(
              "ml-auto inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[0.7rem] font-medium",
              complete
                ? "border-success/25 bg-success/10 text-success"
                : done === 0
                  ? "border-hairline bg-tint/[0.04] text-muted-foreground"
                  : "border-gold/30 bg-gold/10 text-gold-soft",
            )}
          >
            {complete ? (
              <Check className="size-3" />
            ) : (
              <span className={cn("status-dot", done > 0 && "text-gold")} />
            )}
            {complete ? "Ready" : done === 0 ? "Queued" : "Rendering"}
          </span>
        </div>

        <div className="flex flex-col gap-4 p-4">
          <p className="text-[0.78rem] leading-relaxed text-foreground/85">
            {PROMPT}
          </p>

          <dl className="grid grid-cols-2 gap-2">
            {SPEC.map(({ icon: Icon, label, value }) => (
              <div key={label} className="well flex items-center gap-2 px-2.5 py-2">
                <Icon className="size-3.5 shrink-0 text-gold/70" />
                <div className="flex min-w-0 flex-col">
                  <dt className="text-[0.6rem] tracking-[0.16em] text-muted-foreground uppercase">
                    {label}
                  </dt>
                  <dd className="truncate text-[0.72rem]">{value}</dd>
                </div>
              </div>
            ))}
          </dl>

          {/* denoise */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-[0.7rem] text-muted-foreground">
              <span>
                {complete
                  ? "Denoise complete"
                  : `NFE ${Math.min(done, REFERENCE.steps)}/${REFERENCE.steps}`}
              </span>
              <span className="num">
                {elapsed.toFixed(1)}s
                <span className="text-muted-foreground/60">
                  {" "}
                  / {REFERENCE.denoiseSeconds.toFixed(1)}s
                </span>
              </span>
            </div>
            <span className="track">
              <span
                className={cn(
                  "block h-full rounded-full transition-[width] duration-300 ease-out",
                  complete
                    ? "bg-gradient-to-r from-gold/60 to-gold"
                    : "animate-sweep bg-gradient-to-r from-gold/50 via-gold to-gold/60",
                )}
                style={{ width: `${progress * 100}%` }}
              />
            </span>
          </div>

          {/* per-NFE samples */}
          <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
            {STEP_SECONDS.map((seconds, index) => {
              const settled = index < done;
              const active = index === done;
              const height = (seconds / SLOWEST) * 100;
              return (
                <li
                  key={index}
                  className={cn(
                    "well flex flex-col gap-1.5 px-1.5 py-1.5 transition-colors",
                    settled && "border-gold/25 bg-gold/[0.06]",
                  )}
                >
                  <span className="text-[0.55rem] tracking-[0.12em] text-muted-foreground uppercase num">
                    {index + 1}
                  </span>
                  <span className="relative block h-6 w-full overflow-hidden rounded-sm bg-tint/[0.04]">
                    <span
                      className={cn(
                        "absolute inset-x-0 bottom-0 rounded-sm bg-gradient-to-t from-gold/40 to-gold transition-all duration-300",
                        active && "animate-pulse",
                      )}
                      style={{ height: settled || active ? `${height}%` : "0%" }}
                    />
                  </span>
                  <span className="text-[0.6rem] text-muted-foreground num">
                    {settled ? `${seconds.toFixed(2)}s` : "—"}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* artifact strip */}
          <div className="flex items-center gap-3 rounded-xl border border-hairline bg-tint/[0.02] p-2.5">
            <span
              className={cn(
                "grid h-11 w-16 shrink-0 place-items-center rounded-lg bg-gradient-to-br",
                thumbTint("vdn-h3-console"),
              )}
            >
              <Film className="size-4 text-white/70" />
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[0.72rem]">
                artifact.mp4 · {REFERENCE.clipSeconds.toFixed(1)}s · audio muxed
              </span>
              <span className="truncate text-[0.62rem] text-muted-foreground">
                {complete
                  ? `Denoised in ${REFERENCE.denoiseSeconds.toFixed(1)}s — ${REFERENCE.hardware} reference`
                  : "Streamed auth-gated by this app"}
              </span>
            </div>
            <Cpu className="ml-auto hidden size-4 shrink-0 text-muted-foreground sm:block" />
          </div>
        </div>
      </div>

      <p className="mt-3 text-[0.65rem] text-muted-foreground lg:pl-1">
        Illustrative render view — {REFERENCE.hardware}, {REFERENCE.steps} steps,
        published reference timings.
      </p>
    </div>
  );
}
