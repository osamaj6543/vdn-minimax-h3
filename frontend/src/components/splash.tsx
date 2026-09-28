/** Full-viewport branded loading state, used by the auth guard and the
 *  root redirect so the first paint is never a bare spinner.
 */
import { VdnMark } from "@/components/brand";
import { cn } from "@/lib/utils";

export function Splash({
  label = "Loading workspace",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative grid min-h-screen place-items-center overflow-hidden px-6",
        className,
      )}
    >
      <div
        aria-hidden
        className="animate-drift pointer-events-none absolute -top-24 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-gold/10 blur-3xl"
      />
      <div className="relative flex flex-col items-center gap-5">
        <span className="grid size-14 place-items-center rounded-2xl border border-gold/25 bg-gold/10 text-gold-soft gold-ring">
          <VdnMark className="h-6" title="" />
        </span>
        <div className="flex flex-col items-center gap-2">
          <p className="font-display text-sm tracking-[0.28em] text-foreground uppercase">
            VDN Studio
          </p>
          <p className="text-xs text-muted-foreground">{label}…</p>
        </div>
        <span className="shimmer track w-40 bg-foreground/5">
          <span className="animate-sweep block h-full w-1/2 rounded-full bg-gradient-to-r from-transparent via-gold to-transparent" />
        </span>
      </div>
    </div>
  );
}
