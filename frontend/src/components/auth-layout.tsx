"use client";

/** Split auth screen: brand panel on the left (hidden on small screens),
 *  credential card on the right.
 */
import { VdnLogo, VdnMark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

const STATS = [
  { value: "6.9s", label: "Denoise, 8 steps" },
  { value: "9.0s", label: "End-to-end, 14.4s clip" },
  { value: "8×", label: "B200 GPUs" },
];

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden border-r border-hairline bg-surface/30 p-10 lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="grid-lines absolute inset-0 opacity-40" />
        <div
          aria-hidden
          className="animate-drift absolute -top-32 -left-24 size-[30rem] rounded-full bg-gold/10 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -right-16 bottom-0 size-[24rem] rounded-full bg-info/10 blur-3xl"
        />

        <div className="relative">
          <VdnLogo tagline size="lg" />
        </div>

        <div className="relative flex max-w-lg flex-col gap-5">
          <h2 className="font-display text-4xl leading-[1.1] font-medium tracking-tight">
            Generate video
            <br />
            <span className="gold-text">faster than it plays.</span>
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            VDN-H3 pairs a frame-wise linear attention branch with the MiniMax H3
            backbone. Text, first-frame, last-frame, first+last and
            reference-conditioned renders — 768p, 24 fps, audio included.
          </p>
          <div className="flex items-center gap-3 rounded-xl border border-hairline bg-tint/[0.02] px-3.5 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-gold/25 bg-gold/10 text-gold-soft">
              <VdnMark className="h-4" title="" />
            </span>
            <p className="text-[0.72rem] leading-relaxed text-muted-foreground">
              Hybrid attention: near-lossless quality at distilled 8-step speed,
              measured on the released checkpoint.
            </p>
          </div>
        </div>

        <dl className="relative grid grid-cols-3 gap-4">
          {STATS.map((stat) => (
            <div key={stat.label} className="flex flex-col gap-1">
              <dt className="text-[0.6rem] tracking-[0.18em] text-muted-foreground uppercase">
                {stat.label}
              </dt>
              <dd className="font-display text-xl font-medium num">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </aside>

      <main className="relative flex items-center justify-center px-5 py-10 sm:px-8">
        {/* Sign-in and sign-up are reachable before the user is ever inside the
            studio shell, so the colour scheme has to be switchable here too —
            otherwise someone who prefers light is stuck on the dark theme until
            they are signed in. */}
        <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
          <ThemeToggle />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,oklch(0.83_0.06_85/8%),transparent_70%)] lg:hidden"
        />
        <div className="relative flex w-full max-w-sm flex-col gap-6">
          <div className="flex flex-col items-center gap-4 lg:hidden">
            <VdnLogo size="md" />
          </div>

          <div className="flex flex-col gap-1.5 text-center lg:text-left">
            <h1 className="font-display text-2xl font-medium tracking-tight">
              {title}
            </h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>

          <div className="panel p-5">{children}</div>

          {footer && (
            <div className="text-center text-[0.75rem] text-muted-foreground">
              {footer}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
