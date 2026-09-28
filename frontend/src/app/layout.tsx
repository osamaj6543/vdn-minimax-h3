import type { Metadata, Viewport } from "next";

import { SessionProvider } from "@/components/session-provider";
import { Toaster } from "@/components/ui/sonner";
import { fontVariables } from "@/lib/fonts";

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
  themeColor: "#08090b",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // `data-scroll-behavior` tells Next.js that globals.css opts into smooth
    // scrolling, so SPA route transitions still jump to the top instantly
    // instead of animating (Next 16 no longer assumes this).
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`dark h-full antialiased ${fontVariables}`}
    >
      <body className="flex min-h-full flex-col bg-background">
        <SessionProvider>{children}</SessionProvider>
        <Toaster position="top-right" />
      </body>
    </html>
  );
}

