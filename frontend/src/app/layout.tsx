import type { Metadata, Viewport } from "next";

import { SessionProvider } from "@/components/session-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { fontVariables } from "@/lib/fonts";
import { THEME_COLORS, THEME_INIT_SCRIPT } from "@/lib/theme";

import "./globals.css";

export const metadata: Metadata = {
  applicationName: "VDN Studio",
  title: {
    default: "VDN Studio — AI video generation",
    template: "%s · VDN Studio",
  },
  description:
    "Render video with VDN-H3: text, first-frame, last-frame, first+last and " +
    "reference-to-video, with live queue status and per-NFE timings.",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // Dark is the default theme, so browser chrome starts as ink; the pre-paint
  // theme script re-points this tag for a user who picked light.
  themeColor: THEME_COLORS.dark,
  // Both schemes are supported. Which one is *used* is decided in CSS
  // (`color-scheme` on `html` / `html.dark`, src/app/globals.css) and mirrored
  // onto <html> at runtime, so form controls and native scrollbars follow.
  colorScheme: "dark light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // `data-scroll-behavior` tells Next.js that globals.css opts into smooth
    // scrolling, so SPA route transitions still jump to the top instantly
    // instead of animating (Next 16 no longer assumes this).
    //
    // `dark` is server-rendered so the default theme is correct on the very
    // first paint — and with JavaScript disabled. `suppressHydrationWarning`
    // covers the intentional divergence: THEME_INIT_SCRIPT removes the class
    // (and sets data-theme / color-scheme / theme-color) before React hydrates
    // when the visitor has chosen light.
    <html
      lang="en"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`dark h-full antialiased ${fontVariables}`}
    >
      <head>
        {/* Runs during head parsing, i.e. before a single pixel of <body> is
            painted, so a light-mode visitor never sees a dark flash.

            Deliberately a raw inline <script> rather than `next/script`
            `beforeInteractive`: the latter only queues onto Next's
            `self.__next_s` bootstrap, which is drained *after* hydration —
            far too late to avoid the flash. The content is a build-time
            constant (no user input reaches it), which is what makes
            `dangerouslySetInnerHTML` safe here. */}
        <script
          id="vdn-theme"
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>
      <body className="flex min-h-full flex-col bg-background">
        <ThemeProvider>
          <SessionProvider>{children}</SessionProvider>
          <Toaster position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}

