/** Self-hosted variable fonts (files live in src/app/fonts — see its README).
 *
 * Loading them through `next/font/local` keeps the production build offline
 * (no Google Fonts fetch at build time) and removes runtime third-party
 * requests: the woff2 files are hashed, served from our own origin and
 * preloaded. Exported variables line up with the `--font-*` tokens in
 * globals.css so `font-sans`, `font-mono` and `font-display` resolve to them.
 */
import localFont from "next/font/local";

/** UI face — everything from body copy to table cells. */
export const inter = localFont({
  src: "../app/fonts/inter-latin-var.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: true,
  variable: "--font-inter",
  fallback: ["system-ui", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
});

/** Display face — the logo wordmark's own typeface, for brand + hero type. */
export const jost = localFont({
  src: "../app/fonts/jost-latin-var.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-jost",
  fallback: ["Futura", "Century Gothic", "ui-sans-serif", "sans-serif"],
});

/** Mono face — job ids, seeds, per-NFE timings, wire payloads. */
export const jetbrainsMono = localFont({
  src: "../app/fonts/jetbrains-mono-latin-var.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-jetbrains-mono",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
});

/** Drop on <html> so every `--font-*` variable is in scope. */
export const fontVariables = `${inter.variable} ${jost.variable} ${jetbrainsMono.variable}`;
