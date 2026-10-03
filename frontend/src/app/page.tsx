/** The public landing page for `/`.
 *
 *  It replaces the old "redirect to /login" root: an unauthenticated visitor now
 *  gets the product story, and every claim on it is traceable (see
 *  `src/lib/landing.ts` — the measured reference figures, the gateway surface
 *  and the licence split each cite the file they came from).
 *
 *  Server component on purpose: it exports `metadata` for crawlers and ships no
 *  JavaScript of its own, while the pieces that need a live browser (the nav,
 *  the session-aware CTAs, the hero console, the mode explorer and the FAQ) are
 *  small client components underneath.
 *
 *  `/` intentionally stays public even when signed in — the header CTA switches
 *  to "Open studio" instead of bouncing the visitor into the app.
 */
import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Braces,
  ChevronRight,
  Database,
  FileText,
  GitBranch,
  Layers,
  ListOrdered,
  Rss,
  Server,
  ShieldCheck,
  Sparkles,
  Timer,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { VdnMark } from "@/components/brand";
import { FaqAccordion } from "@/components/landing/faq-accordion";
import { LandingCta } from "@/components/landing/landing-cta";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingNav } from "@/components/landing/landing-nav";
import { ModeExplorer } from "@/components/landing/mode-explorer";
import { RenderConsole } from "@/components/landing/render-console";
import { LANDING_SHELL } from "@/components/landing/shell";
import { buttonVariants } from "@/components/ui/button";
import {
  CAPABILITIES,
  FAQ,
  LINKS,
  METRICS,
  PIPELINE,
  REFERENCE,
  REFERENCE_HINT,
} from "@/lib/landing";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Video generation faster than real time",
  description:
    "VDN Studio renders on VDN-H3 — MiniMax H3's backbone plus a frame-wise " +
    "linear-attention branch. Five conditioning modes, 768p / 24 fps with audio, " +
    "and per-NFE timings on every render.",
};

/** Hero trust row: the three claims that hold for the whole product. */
const TRUST: { icon: LucideIcon; text: string }[] = [
  { icon: Layers, text: "Five conditioning modes from one checkpoint" },
  { icon: GitBranch, text: "Weights, inference stack and training code released" },
  { icon: ShieldCheck, text: "Credentials never reach the browser" },
];

/** Icons for the capability cards, keyed by the id in `lib/landing.ts`. */
const CAPABILITY_ICONS: Record<(typeof CAPABILITIES)[number]["id"], LucideIcon> = {
  auth: ShieldCheck,
  queue: ListOrdered,
  library: Database,
  telemetry: Activity,
  api: Braces,
  deploy: Server,
};

/** The real request body, straight from `server/README.md`'s API sketch. */
const API_SNIPPET = `POST /v1/video/t2v
{
  "prompt": "A slow dolly through a neon alley...",
  "num_frames": ${REFERENCE.frames},
  "num_steps": ${REFERENCE.steps},
  "seed": 4207,
  "priority": "high"
}`;

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <LandingNav />

      <main className="flex-1">
        <Hero />
        <MetricsBand />
        <ModesSection />
        <PerformanceSection />
        <ArchitectureSection />
        <PlatformSection />
        <OpenSourceSection />
        <FaqSection />
        <ClosingCta />
      </main>

      <LandingFooter />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                   */
/* -------------------------------------------------------------------------- */

/** Shared section header: eyebrow, display title, lead paragraph. */
function SectionIntro({
  eyebrow,
  title,
  lead,
  action,
}: {
  eyebrow: string;
  title: React.ReactNode;
  lead: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex max-w-2xl flex-col gap-3">
        <p className="text-[0.6rem] tracking-[0.24em] text-gold/80 uppercase">
          {eyebrow}
        </p>
        <h2 className="font-display text-[1.85rem] leading-[1.12] font-medium tracking-tight sm:text-[2.15rem]">
          {title}
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{lead}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function Hero() {
  return (
    <section
      id="top"
      className="relative overflow-hidden border-b border-hairline"
    >
      <div
        aria-hidden
        className="grid-lines pointer-events-none absolute inset-0 opacity-50"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background"
      />
      <div
        aria-hidden
        className="animate-drift pointer-events-none absolute -top-44 left-1/2 size-[42rem] -translate-x-1/2 rounded-full bg-gold/[0.08] blur-3xl"
      />

      <div
        className={cn(
          LANDING_SHELL,
          "relative grid gap-12 pt-14 pb-20 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,30rem)] lg:items-center lg:gap-16 lg:pt-24 lg:pb-28",
        )}
      >
        <div className="flex flex-col gap-7">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-gold/25 bg-gold/[0.07] px-3 py-1 text-[0.68rem] text-gold-soft">
            <span className="status-dot text-gold" />
            SGLang Diffusion supported · 8-step distilled preset
          </span>

          <h1 className="font-display text-[2.5rem] leading-[1.05] font-medium tracking-tight sm:text-[3.3rem] lg:text-[3.8rem]">
            Generate video
            <br />
            <span className="gold-text">faster than it plays.</span>
          </h1>

          <p className="max-w-2xl text-[0.95rem] leading-relaxed text-muted-foreground">
            VDN Studio renders on{" "}
            <span className="text-foreground">VDN-H3</span> — MiniMax H3&apos;s
            backbone with a frame-wise linear-attention branch and two small LoRA
            adapters merged in at inference. A{" "}
            {REFERENCE.clipSeconds.toFixed(1)}-second clip at 768p / 24 fps with
            stereo audio denoises in {REFERENCE.denoiseSeconds.toFixed(1)} seconds
            and lands in about {REFERENCE.endToEndSeconds.toFixed(1)} seconds end
            to end on {REFERENCE.hardware} GPUs.
          </p>

          <LandingCta />

          <ul className="grid gap-2 sm:grid-cols-3">
            {TRUST.map(({ icon: Icon, text }) => (
              <li
                key={text}
                className="flex items-start gap-2 rounded-xl border border-hairline bg-tint/[0.02] px-3 py-2.5"
              >
                <Icon className="mt-0.5 size-3.5 shrink-0 text-gold/80" />
                <span className="text-[0.7rem] leading-relaxed text-muted-foreground">
                  {text}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <RenderConsole />
      </div>
    </section>
  );
}

function MetricsBand() {
  return (
    <section className="border-b border-hairline bg-surface/30">
      <dl
        className={cn(
          LANDING_SHELL,
          "grid grid-cols-2 gap-x-6 gap-y-7 py-9 sm:grid-cols-3 lg:grid-cols-6",
        )}
      >
        {METRICS.map((metric) => (
          <div key={metric.label} className="flex flex-col gap-1">
            <dt className="text-[0.58rem] tracking-[0.2em] text-muted-foreground uppercase">
              {metric.label}
            </dt>
            <dd className="font-display text-2xl font-medium num">
              {metric.value}
            </dd>
            <dd className="text-[0.65rem] text-muted-foreground/80">
              {metric.hint}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ModesSection() {
  return (
    <section id="modes" className="border-b border-hairline">
      <div className={cn(LANDING_SHELL, "py-20 lg:py-24")}>
        <SectionIntro
          eyebrow="Conditioning modes"
          title={
            <>
              Five ways in, <span className="gold-text">one checkpoint</span>.
            </>
          }
          lead="Text, first frame, last frame, both, or up to eight reference pictures. Switching mode changes the conditioning rows a request carries — never the weights you have loaded."
          action={
            <Link
              href="/dashboard"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "text-muted-foreground",
              )}
            >
              Open the studio
              <ArrowRight className="size-3.5" />
            </Link>
          }
        />
        <div className="mt-10">
          <ModeExplorer />
        </div>
      </div>
    </section>
  );
}

/** The reference numbers, and where the time actually goes. */
const PERFORMANCE_ROWS: { label: string; value: string; note?: string }[] = [
  { label: "Denoising (8 NFEs)", value: "6.9s", note: "the published figure" },
  { label: "End-to-end", value: "9.0s", note: "queue → muxed mp4" },
  {
    label: "Clip",
    value: `${REFERENCE.clipSeconds.toFixed(1)}s`,
    note: `${REFERENCE.frames} frames at ${REFERENCE.fps} fps`,
  },
  { label: "Output", value: "768p · stereo", note: "video + audio VAEs" },
  { label: "Step presets", value: "8 · 50", note: "Fast / Quality" },
  { label: "Bench", value: REFERENCE.hardware, note: "SGLang Diffusion lane" },
];

const PERFORMANCE_NOTES: { icon: LucideIcon; title: string; detail: string }[] = [
  {
    icon: Zap,
    title: "Distilled sampling",
    detail:
      "The 8-step preset is the turbo adapter trained by DMD2 (no GAN), initialized from the published MiniMax-H3 turbo LoRA.",
  },
  {
    icon: Sparkles,
    title: "Budget spent on the right attention",
    detail:
      "The frame-wise linear-attention branch carries what dominated the cost, while the softmax branch keeps visual quality and temporal consistency.",
  },
  {
    icon: Timer,
    title: "Measured, then remembered",
    detail:
      "Every render stores its per-NFE seconds. The studio estimates from your own recent renders first and only then falls back to the published 8×B200 reference — labelled as such.",
  },
];

function PerformanceSection() {
  return (
    <section id="performance" className="border-b border-hairline">
      <div className={cn(LANDING_SHELL, "py-20 lg:py-24")}>
        <SectionIntro
          eyebrow="Performance"
          title={
            <>
              Fourteen seconds of video,{" "}
              <span className="gold-text">in nine</span>.
            </>
          }
          lead={`${REFERENCE_HINT} The studio shows the same figure, and says when it is a reference rather than your own measurement.`}
        />

        <div className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="panel p-5">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-hairline bg-tint/[0.03] text-gold/80">
                <Timer className="size-4" />
              </span>
              <div className="flex min-w-0 flex-col">
                <h3 className="text-sm font-medium tracking-tight">
                  Published reference
                </h3>
                <p className="text-[0.68rem] text-muted-foreground">
                  One clip, one ladder — not a best case
                </p>
              </div>
            </div>

            <dl className="mt-4 divide-y divide-hairline">
              {PERFORMANCE_ROWS.map((row) => (
                <div
                  key={row.label}
                  className="flex items-baseline justify-between gap-4 py-2.5"
                >
                  <dt className="text-[0.75rem] text-muted-foreground">
                    {row.label}
                  </dt>
                  <dd className="text-right">
                    <span className="text-[0.82rem] font-medium num">
                      {row.value}
                    </span>
                    {row.note && (
                      <span className="ml-2 text-[0.65rem] text-muted-foreground">
                        {row.note}
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>

            <p className="mt-3 text-[0.65rem] leading-relaxed text-muted-foreground">
              Smaller ladders and the 50-step preset work too; they are simply
              slower. Nothing here is a promise about a different GPU.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              {PERFORMANCE_NOTES.map(({ icon: Icon, title, detail }) => (
                <li key={title} className="panel flex items-start gap-3 p-4">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-hairline bg-tint/[0.03] text-gold/80">
                    <Icon className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="text-[0.82rem] font-medium">{title}</p>
                    <p className="text-[0.72rem] leading-relaxed text-muted-foreground">
                      {detail}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* how a request becomes a file */}
        <div className="mt-14">
          <p className="text-[0.6rem] tracking-[0.24em] text-gold/80 uppercase">
            Request lifecycle
          </p>
          <ol className="mt-5 grid gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))]">
            {PIPELINE.map((stage, index) => (
              <li key={stage.step} className="relative">
                <div className="well h-full p-4">
                  <p className="font-mono text-[0.65rem] text-gold/80 num">
                    {stage.step}
                  </p>
                  <p className="mt-2 text-[0.82rem] font-medium">{stage.title}</p>
                  <p className="mt-1.5 text-[0.7rem] leading-relaxed text-muted-foreground">
                    {stage.detail}
                  </p>
                </div>
                {index < PIPELINE.length - 1 && (
                  <ChevronRight
                    aria-hidden
                    className="absolute top-1/2 -right-2 hidden size-4 -translate-y-1/2 text-muted-foreground/50 lg:block"
                  />
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/** The inference path, as one line of blocks. */
const ARCHITECTURE_FLOW: { title: string; hint: string }[] = [
  {
    title: "Prompt + pictures",
    hint: "Text, keyframes or references become embeddings and conditioning latents.",
  },
  {
    title: "MiniMax H3 backbone",
    hint: "The released transformer, frozen — no weight is modified.",
  },
  {
    title: "Hybrid attention",
    hint: "A softmax branch and a frame-wise linear branch, fused by gates.",
  },
  {
    title: "Video + audio VAEs",
    hint: "Decoded and muxed into one 768p mp4 with stereo audio.",
  },
];

const ARCHITECTURE_FACTS: { icon: LucideIcon; title: string; detail: string }[] = [
  {
    icon: Layers,
    title: "Frozen backbone",
    detail:
      "The branch and the adapters are folded in as an inference-time transform, so any quality delta is attributable to them and not to a fine-tuned backbone.",
  },
  {
    icon: GitBranch,
    title: "Two small adapters",
    detail:
      "LoRA on the QKV and O projections alongside the linear branch (stages A1, A2 and B), then the 8-step turbo adapter from the DMD stage.",
  },
  {
    icon: Server,
    title: "Kernels chosen per pool",
    detail:
      "FlashAttention 4 where it is installed, FlexAttention's Triton kernel otherwise. fp8 is supported, stated — and never a default, because it changes the sample.",
  },
];

function ArchitectureSection() {
  return (
    <section id="architecture" className="border-b border-hairline">
      <div className={cn(LANDING_SHELL, "py-20 lg:py-24")}>
        <SectionIntro
          eyebrow="Architecture"
          title={
            <>
              Hybrid attention,{" "}
              <span className="gold-text">plug-and-play</span>.
            </>
          }
          lead="Two branches share one backbone: the softmax path keeps the visual quality and temporal consistency the released model is known for, while the frame-wise linear path carries the cost. Gates decide how much of each the output sees."
        />

        <div className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="panel relative overflow-hidden p-5">
            <div
              aria-hidden
              className="grid-lines absolute inset-0 opacity-30"
            />
            <ol className="relative flex flex-col gap-3 lg:flex-row lg:items-stretch">
              {ARCHITECTURE_FLOW.map((node, index) => (
                <li
                  key={node.title}
                  className="flex flex-col items-stretch gap-3 lg:flex-1 lg:flex-row"
                >
                  <div className="well flex-1 p-3.5">
                    <p className="text-[0.8rem] font-medium">{node.title}</p>
                    <p className="mt-1.5 text-[0.68rem] leading-relaxed text-muted-foreground">
                      {node.hint}
                    </p>
                  </div>
                  {index < ARCHITECTURE_FLOW.length - 1 && (
                    <span className="flex shrink-0 items-center justify-center">
                      <ChevronRight
                        aria-hidden
                        className="hidden size-4 text-muted-foreground/50 lg:block"
                      />
                      <ChevronRight
                        aria-hidden
                        className="size-4 rotate-90 text-muted-foreground/50 lg:hidden"
                      />
                    </span>
                  )}
                </li>
              ))}
            </ol>

            <p className="relative mt-4 rounded-xl border border-hairline bg-tint/[0.02] px-3.5 py-3 text-[0.7rem] leading-relaxed text-muted-foreground">
              Because the branch and the adapters merge at inference, one loaded
              checkpoint serves all five modes — switching conditioning never
              reloads the transformer.
            </p>
          </div>

          <ul className="flex flex-col gap-3">
            {ARCHITECTURE_FACTS.map(({ icon: Icon, title, detail }) => (
              <li key={title} className="panel flex items-start gap-3 p-4">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-hairline bg-tint/[0.03] text-gold/80">
                  <Icon className="size-4" />
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-[0.82rem] font-medium">{title}</p>
                  <p className="text-[0.72rem] leading-relaxed text-muted-foreground">
                    {detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function PlatformSection() {
  return (
    <section id="platform" className="border-b border-hairline">
      <div className={cn(LANDING_SHELL, "py-20 lg:py-24")}>
        <SectionIntro
          eyebrow="Platform"
          title={
            <>
              Built like infrastructure,{" "}
              <span className="gold-text">not a demo</span>.
            </>
          }
          lead="The model is one half of the product; the gateway behind it is the other. Tenancy, queueing, artifacts, telemetry and an API that behaves the same way in a notebook and in production."
        />

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((capability) => {
            const Icon = CAPABILITY_ICONS[capability.id];
            return (
              <article
                key={capability.id}
                className="panel flex flex-col gap-3 p-5"
              >
                <span className="grid size-9 place-items-center rounded-xl border border-hairline bg-tint/[0.03] text-gold/80">
                  <Icon className="size-4" />
                </span>
                <div className="flex flex-col gap-1">
                  <h3 className="text-[0.9rem] font-medium tracking-tight">
                    {capability.title}
                  </h3>
                  <p className="text-[0.6rem] tracking-[0.16em] text-muted-foreground uppercase">
                    {capability.hint}
                  </p>
                </div>
                <p className="text-[0.75rem] leading-relaxed text-muted-foreground">
                  {capability.detail}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section id="faq" className="border-b border-hairline">
      <div className={cn(LANDING_SHELL, "py-20 lg:py-24")}>
        <SectionIntro
          eyebrow="Questions"
          title={
            <>
              The short answers,{" "}
              <span className="gold-text">sourced</span>.
            </>
          }
          lead="Everything below is stated in this repository or in the released paper — including the parts that are licensed differently from the code."
        />
        <div className="mt-10 max-w-4xl">
          <FaqAccordion items={FAQ} />
        </div>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="grid-lines pointer-events-none absolute inset-0 opacity-40"
      />
      <div className={cn(LANDING_SHELL, "relative py-20 lg:py-24")}>
        <div className="panel relative overflow-hidden p-8 sm:p-10">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 -right-16 size-80 rounded-full bg-gold/[0.10] blur-3xl"
          />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex max-w-2xl flex-col gap-3">
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-gold/25 bg-gold/[0.07] px-3 py-1 text-[0.65rem] text-gold-soft">
                <VdnMark className="h-3" title="" />
                {REFERENCE.hardware} reference · 8 steps
              </span>
              <h2 className="font-display text-[1.9rem] leading-[1.12] font-medium tracking-tight sm:text-[2.2rem]">
                Write a shot.{" "}
                <span className="gold-text">Get a clip with sound.</span>
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Create a workspace and render straight away: prompt, pick a mode,
                attach frames if it needs them, and watch the NFEs land with the
                artifact, its seed and its timings.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <LandingCta className="lg:flex-col lg:items-stretch" />
              <p className="text-[0.65rem] text-muted-foreground lg:text-right">
                Apache-2.0 code · weights under the MiniMax H3 Community Licence
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The released artifacts, and what shipping them actually means. */
const RESOURCES: {
  icon: LucideIcon;
  kind: string;
  title: string;
  detail: string;
  href: string;
}[] = [
  {
    icon: FileText,
    kind: "Paper",
    title: "Video DeltaNet",
    detail:
      "The hybrid-attention design, the training stages and the measurements behind the timings.",
    href: LINKS.paper,
  },
  {
    icon: Rss,
    kind: "Blog",
    title: "Release notes",
    detail: "Sample clips, the news timeline and the SGLang Diffusion integration.",
    href: LINKS.blog,
  },
  {
    icon: GitBranch,
    kind: "Code",
    title: "Training + inference",
    detail:
      "Apache-2.0: the optimized inference stack plus the stage A1/A2/B/DMD trainers.",
    href: LINKS.code,
  },
  {
    icon: Layers,
    kind: "Weights",
    title: "VDN-H3 checkpoint",
    detail: "Hugging Face and ModelScope, under the MiniMax H3 Community Licence.",
    href: LINKS.weights,
  },
];

const OPEN_ITEMS = [
  "The optimized inference path these timings were measured on — kernels, fp8 and the 8-step / 50-step presets included.",
  "Every training stage: A1 and A2 for the linear branch, B for the LoRA adapters against the frozen teacher, DMD for the turbo adapter.",
  "The 8-GPU Ulysses sequence-parallel launcher, and the diffusers export of the published component.",
  "Weights on Hugging Face and ModelScope — licensed separately from the code, so read the terms before you download.",
];

function OpenSourceSection() {
  return (
    <section id="open-source" className="border-b border-hairline">
      <div className={cn(LANDING_SHELL, "py-20 lg:py-24")}>
        <SectionIntro
          eyebrow="Open source"
          title={
            <>
              Open weights, <span className="gold-text">open stack</span>.
            </>
          }
          lead="This is not a weights-only drop: the optimized inference stack and the training code ship together, so the published numbers can be reproduced rather than taken on faith."
        />

        <div className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="grid gap-3 sm:grid-cols-2">
            {RESOURCES.map(({ icon: Icon, kind, title, detail, href }) => (
              <a
                key={kind}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="panel group flex flex-col gap-3 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:ring-gold/25"
              >
                <div className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-hairline bg-tint/[0.03] text-gold/80">
                    <Icon className="size-4" />
                  </span>
                  <span className="text-[0.6rem] tracking-[0.16em] text-muted-foreground uppercase">
                    {kind}
                  </span>
                  <ArrowRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-[0.88rem] font-medium tracking-tight">{title}</p>
                  <p className="text-[0.72rem] leading-relaxed text-muted-foreground">
                    {detail}
                  </p>
                </div>
              </a>
            ))}
          </div>

          <div className="flex flex-col gap-4">
            <div className="panel p-5">
              <p className="text-[0.6rem] tracking-[0.18em] text-gold/80 uppercase">
                What is actually open
              </p>
              <ul className="mt-3 flex flex-col gap-2">
                {OPEN_ITEMS.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-[0.75rem] leading-relaxed text-muted-foreground"
                  >
                    <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-gold/70" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="panel p-5">
              <p className="flex items-center gap-2 text-[0.6rem] tracking-[0.18em] text-gold/80 uppercase">
                <Braces className="size-3.5" />
                Create a render
              </p>
              <pre className="mt-3 overflow-x-auto rounded-xl border border-hairline bg-code p-3 font-mono text-[0.68rem] leading-relaxed text-muted-foreground">
                <code>{API_SNIPPET}</code>
              </pre>
              <p className="mt-3 text-[0.68rem] leading-relaxed text-muted-foreground">
                Gateway calls authenticate with <code>X-API-Key</code>; this studio
                calls the same endpoints through its own server-side proxy. Also
                released:{" "}
                <a
                  href={LINKS.modelscope}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline underline-offset-4 hover:text-gold-soft"
                >
                  ModelScope mirror
                </a>
                ,{" "}
                <a
                  href={LINKS.turboLora}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline underline-offset-4 hover:text-gold-soft"
                >
                  turbo LoRA
                </a>{" "}
                and the{" "}
                <a
                  href={LINKS.sglang}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline underline-offset-4 hover:text-gold-soft"
                >
                  SGLang Diffusion
                </a>{" "}
                lane.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
