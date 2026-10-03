"use client";

/** The five conditioning modes, as an explorer.
 *
 *  Same metadata the studio's mode cards use (`create-video-form.tsx`): the
 *  labels come from `TASK_LABELS`, the guidance lines mirror the H3 caption
 *  conventions, and each mode names the endpoint it posts to. One checkpoint
 *  serves all five — which is the point this section has to land.
 */
import { useState } from "react";
import {
  Image as ImageIcon,
  ImagePlus,
  Images,
  Layers,
  Terminal,
  TextCursorInput,
  type LucideIcon,
} from "lucide-react";

import { TASK_LABELS, type Task } from "@/lib/types";
import { cn } from "@/lib/utils";

const MODES: {
  id: Task;
  short: string;
  hint: string;
  icon: LucideIcon;
  images: number | null;
  guidance: string;
  example: string;
  detail: string;
}[] = [
  {
    id: "t2v",
    short: "Text",
    hint: "Prompt only",
    icon: TextCursorInput,
    images: null,
    guidance:
      "Describe the shot. Rewriting the prompt with MiniMax H3's guide improves quality.",
    example:
      "A slow dolly through a rain-slicked neon alley; puddle reflections ripple.",
    detail:
      "No conditioning images. The cheapest request, and the right one for storyboards, shot lists and prompt sweeps.",
  },
  {
    id: "i2v",
    short: "First frame",
    hint: "Animate a still",
    icon: ImageIcon,
    images: 1,
    guidance:
      "Open with the H3 i2va instruction naming the first-frame picture, then describe the motion.",
    example:
      "The video begins on the provided first picture; the subject turns toward camera.",
    detail:
      "One image anchors frame 1, so a still can be animated without losing its original framing.",
  },
  {
    id: "l2v",
    short: "Last frame",
    hint: "Land on a frame",
    icon: ImagePlus,
    images: 1,
    guidance:
      "Describe how the video ends on the last-frame picture (H3 l2va instruction).",
    example:
      "The camera settles as the shot resolves into the provided last picture.",
    detail:
      "One image anchors the final frame — the mode for driving a clip to a specific end state.",
  },
  {
    id: "fl2v",
    short: "First + last",
    hint: "Bridge two frames",
    icon: Images,
    images: 2,
    guidance:
      "Open with the fl2va instruction line ('How the reference pictures align …'), then the shot.",
    example:
      "How the reference pictures align with the video's first and last frames…",
    detail:
      "Two images define both ends and the model invents the path between them. Reference mode rides the same weights.",
  },
  {
    id: "ref2v",
    short: "References",
    hint: "Up to 8 pictures",
    icon: Layers,
    images: 8,
    guidance:
      "Number your subjects as <Picture 1>, <Picture 2>, … in reference order, then describe the shot.",
    example:
      "<Picture 1> is the courier, <Picture 2> the drone; keep both consistent as we push in.",
    detail:
      "The Ref2VA-like task on the released checkpoint: up to eight pictures carry subject and style identity across the clip.",
  },
];

export function ModeExplorer() {
  const [active, setActive] = useState<Task>("t2v");
  const mode = MODES.find((entry) => entry.id === active) ?? MODES[0];
  const ActiveIcon = mode.icon;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div
        role="group"
        aria-label="Conditioning modes"
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1"
      >
        {MODES.map((entry) => {
          const Icon = entry.icon;
          const selected = entry.id === mode.id;
          return (
            <button
              key={entry.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setActive(entry.id)}
              className={cn(
                "group flex items-start gap-3 rounded-xl border p-3 text-left transition-all",
                selected
                  ? "border-gold/35 bg-gold/[0.07]"
                  : "border-hairline bg-tint/[0.015] hover:border-tint/15 hover:bg-tint/[0.04]",
              )}
            >
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-lg border transition-colors",
                  selected
                    ? "border-gold/30 bg-gold/10 text-gold-soft"
                    : "border-hairline bg-tint/[0.03] text-muted-foreground group-hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className={cn("text-[0.82rem]", selected && "font-medium")}>
                  {entry.short}
                </span>
                <span className="text-[0.68rem] text-muted-foreground">
                  {entry.hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="panel relative overflow-hidden p-5 sm:p-6">
        <div aria-hidden className="grid-lines absolute inset-0 opacity-30" />
        <div className="relative flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl border border-gold/25 bg-gold/10 text-gold-soft">
              <ActiveIcon className="size-4" />
            </span>
            <div className="flex min-w-0 flex-col">
              <h3 className="font-display text-lg font-medium tracking-tight">
                {TASK_LABELS[mode.id]}
              </h3>
              <p className="text-[0.7rem] text-muted-foreground">
                {mode.images === null
                  ? "No conditioning images required"
                  : mode.images === 1
                    ? "Attach exactly one picture"
                    : `Attach up to ${mode.images} reference pictures`}
                {" · one checkpoint"}
              </p>
            </div>
            <code className="ml-auto rounded-lg border border-hairline bg-code px-2.5 py-1.5 font-mono text-[0.65rem] text-muted-foreground">
              POST /v1/video/{mode.id}
            </code>
          </div>

          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {mode.detail}
          </p>

          {/* Side by side once the full-width panel has room for it. */}
          <div className="grid gap-3 xl:grid-cols-2">
            <div className="well p-3">
              <p className="text-[0.6rem] tracking-[0.18em] text-muted-foreground uppercase">
                Prompt guidance
              </p>
              <p className="mt-1.5 text-[0.78rem] leading-relaxed">
                {mode.guidance}
              </p>
            </div>

            <div className="well p-3">
              <p className="flex items-center gap-1.5 text-[0.6rem] tracking-[0.18em] text-muted-foreground uppercase">
                <Terminal className="size-3" />
                Example line
              </p>
              <p className="mt-1.5 font-mono text-[0.72rem] leading-relaxed text-foreground/85">
                {mode.example}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
