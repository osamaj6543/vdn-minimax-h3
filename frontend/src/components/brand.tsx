/** VDN brand marks, traced from `assets/Logo/source/vdn-logo.html` — the same
 *  path data as the shipped PNG exports, so the mark stays pixel-faithful.
 *  Letterforms inherit `currentColor`; the play triangle keeps the champagne
 *  bevel colour of the logo family.
 */
import { cn } from "@/lib/utils";

/** Mark bounding box plus a 10px safety margin, per the logo export guide. */
const MARK_VIEWBOX = "232 414 792 334";

export function VdnMark({
  className,
  title = "Video DeltaNet",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      role="img"
      aria-label={title}
      className={cn("h-5 w-auto", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* V */}
      <path
        fill="currentColor"
        d="M242,424 L307,424 L410,612 L469,504 L533,504 L409,738 Z"
      />
      {/* D top bar sweeping into the N diagonal, plus N right stem */}
      <path
        fill="currentColor"
        d="M508,424 H649.3 A178,178 0 0 1 775.2,476.2 L958,659 V424 H1013.5 V730 H952 L747.5,521.5 A166,166 0 0 0 630,473 H481 Z"
      />
      {/* D bowl: bottom bar curving up on the right, angled cuts */}
      <path
        fill="currentColor"
        d="M688,513 L739,563 A135,135 0 0 1 607,730 H450 L478,678 H601 A87,87 0 0 0 688,591 Z"
      />
      {/* gold play triangle */}
      <path fill="var(--gold)" d="M564,523 L633,577.5 L564,632 Z" />
    </svg>
  );
}

/** Full lockup: mark tile + the wordmark, set in the logo's own typeface. */
export function VdnLogo({
  className,
  tagline = false,
  size = "md",
}: {
  className?: string;
  tagline?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const tile =
    size === "lg" ? "size-11 rounded-2xl" : size === "sm" ? "size-8 rounded-lg" : "size-9 rounded-xl";
  const mark = size === "lg" ? "h-5" : size === "sm" ? "h-3.5" : "h-4";
  const word =
    size === "lg" ? "text-lg" : size === "sm" ? "text-[0.8rem]" : "text-[0.92rem]";

  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "grid shrink-0 place-items-center border border-gold/25 bg-gold/10 text-gold-soft",
          tile,
        )}
      >
        <VdnMark className={mark} title="" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            "font-display font-medium tracking-[0.14em] text-foreground uppercase",
            word,
          )}
        >
          VDN <span className="gold-text">Studio</span>
        </span>
        {tagline && (
          <span className="mt-1 text-[0.6rem] tracking-[0.24em] text-muted-foreground uppercase">
            Video DeltaNet · H3
          </span>
        )}
      </span>
    </span>
  );
}
