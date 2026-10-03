"use client";

/** Landing-page header: brand, section anchors, and a session-aware CTA.
 *
 *  Anchor targets are plain in-page hashes (`#modes`), so they work without a
 *  server round-trip and never enter the typed-route table. The bar only gains
 *  its border and blur once the page has scrolled, which keeps the hero clean.
 */
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

import { LandingCta } from "@/components/landing/landing-cta";
import { LANDING_SHELL } from "@/components/landing/shell";
import { VdnLogo } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Shared with `src/app/page.tsx` — the ids must exist on that page. */
export const LANDING_ANCHORS: { href: string; label: string }[] = [
  { href: "#modes", label: "Modes" },
  { href: "#performance", label: "Performance" },
  { href: "#architecture", label: "Architecture" },
  { href: "#platform", label: "Platform" },
  { href: "#open-source", label: "Open source" },
  { href: "#faq", label: "FAQ" },
];

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-colors duration-300",
        scrolled || open
          ? "border-b border-hairline bg-background/80 backdrop-blur-xl"
          : "border-b border-transparent",
      )}
    >
      <div className={cn(LANDING_SHELL, "flex h-16 items-center gap-3")}>
        <a
          href="#top"
          aria-label="VDN Studio — top of page"
          className="rounded-xl transition-opacity hover:opacity-90"
        >
          <VdnLogo size="sm" />
        </a>

        <nav className="ml-6 hidden items-center gap-1 lg:flex">
          {LANDING_ANCHORS.map((anchor) => (
            <a
              key={anchor.href}
              href={anchor.href}
              className="rounded-lg px-3 py-1.5 text-[0.8rem] text-muted-foreground transition-colors hover:bg-tint/[0.04] hover:text-foreground"
            >
              {anchor.label}
            </a>
          ))}
        </nav>

        {/* The single `ml-auto` in this row: it absorbs all the free space
            before the toggle, which pins the whole right-hand cluster (toggle,
            CTA, mobile menu button) to the page edge. Do **not** add a second
            `ml-auto` to the CTA wrapper — two auto margins would split the free
            space and strand the toggle in the middle of the bar. */}
        <ThemeToggle className="ml-auto" />

        <div className="hidden sm:block">
          <LandingCta size="lg" compact />
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X /> : <Menu />}
        </Button>
      </div>

      {open && (
        <div
          className={cn(
            LANDING_SHELL,
            "animate-rise border-t border-hairline bg-background/95 pb-5 backdrop-blur-xl lg:hidden",
          )}
        >
          <nav className="grid gap-1 py-3">
            {LANDING_ANCHORS.map((anchor) => (
              <a
                key={anchor.href}
                href={anchor.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-tint/[0.04] hover:text-foreground"
              >
                {anchor.label}
              </a>
            ))}
          </nav>
          <LandingCta size="cta" className="sm:hidden" />
        </div>
      )}
    </header>
  );
}
