/** Landing footer: brand lockup, resource columns and the licence split.
 *
 *  Server-rendered — it holds no state — so the last thing on the page costs
 *  nothing to ship. Internal links use typed `<Link>`; published resources are
 *  external anchors.
 */
import Link from "next/link";
import { ArrowUpRight, Copyright } from "lucide-react";

import { VdnLogo, VdnMark } from "@/components/brand";
import { LANDING_SHELL } from "@/components/landing/shell";
import { FOOTER_GROUPS, LINKS } from "@/lib/landing";
import { cn } from "@/lib/utils";

export function LandingFooter() {
  return (
    <footer className="border-t border-hairline bg-surface/30">
      <div
        className={cn(
          LANDING_SHELL,
          "grid gap-10 py-14 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]",
        )}
      >
        <div className="flex flex-col gap-4">
          <VdnLogo tagline />
          <p className="max-w-sm text-[0.78rem] leading-relaxed text-muted-foreground">
            A hybrid-attention video model built on MiniMax H3, released with its
            inference stack and training code, and served by the VDN gateway
            behind this studio.
          </p>
          <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
            Code is <span className="text-foreground">Apache-2.0</span>. The weights
            ship separately under the{" "}
            <a
              href={LINKS.minimax}
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline underline-offset-4 hover:text-gold-soft"
            >
              MiniMax H3 Community Licence
            </a>
            .
          </p>
        </div>

        {FOOTER_GROUPS.map((group) => (
          <nav
            key={group.title}
            aria-label={group.title}
            className="flex flex-col gap-3"
          >
            <p className="text-[0.6rem] tracking-[0.2em] text-muted-foreground uppercase">
              {group.title}
            </p>
            <ul className="flex flex-col gap-2">
              {group.links.map((link) =>
                "external" in link ? (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="group inline-flex items-center gap-1 text-[0.78rem] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                      <ArrowUpRight className="size-3 opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </a>
                  </li>
                ) : (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-[0.78rem] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-hairline">
        <div
          className={cn(
            LANDING_SHELL,
            "flex flex-wrap items-center justify-between gap-2 py-4 text-[0.68rem] text-muted-foreground",
          )}
        >
          <span className="flex items-center gap-2">
            <VdnMark className="h-3 text-muted-foreground/70" title="" />
            VDN-H3 · hybrid attention · 768p · 24 fps · audio
          </span>
          <span className="flex items-center gap-1.5">
            <Copyright className="size-3" />
            Video DeltaNet — independent architecture study, 2026
          </span>
        </div>
      </div>
    </footer>
  );
}
