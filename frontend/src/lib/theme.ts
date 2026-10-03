/** Colour-scheme plumbing shared by the server and the client.
 *
 *  VDN Studio ships two themes: **dark is the default** (the brand look, and
 *  what a first-time visitor always gets) and **light** is opt-in. The choice
 *  is explicit and sticky — nothing here follows `prefers-color-scheme`, so a
 *  light OS never silently turns the product light.
 *
 *  This module is deliberately framework-free (no `"use client"`) so both the
 *  root *server* layout — which server-renders `<html class="dark">` and emits
 *  the pre-paint script — and the client provider can share one source of truth.
 */

export type Theme = "dark" | "light";

/** Where the choice is remembered. */
export const THEME_STORAGE_KEY = "vdn-theme";

/** The product theme. Anything that is not an explicit "light" is dark. */
export const DEFAULT_THEME: Theme = "dark";

/** Browser-chrome colours, mirrored into `<meta name="theme-color">`. */
export const THEME_COLORS: Record<Theme, string> = {
  dark: "#08090b",
  light: "#f6f6f7",
};

/** Collapses any stored/foreign value onto a theme we actually ship. */
export function normalizeTheme(value: string | null | undefined): Theme {
  return value === "light" ? "light" : DEFAULT_THEME;
}

/** Pre-paint theme bootstrap, injected once from the root layout.
 *
 *  `<html>` arrives from the server already carrying `class="dark"`, so the
 *  default is correct with JavaScript disabled and on the very first paint.
 *  This runs synchronously before any body content is painted and only ever
 *  *removes* the class — for the user who picked light.
 *
 *  Kept as a hand-written IIFE rather than a React effect because an effect
 *  runs after paint, which is exactly the frame we are trying to avoid. The
 *  DOM mutations must stay in lockstep with `applyTheme()` in
 *  `src/components/theme-provider.tsx`.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var dark=stored!=="light";var root=document.documentElement;root.classList.toggle("dark",dark);root.dataset.theme=dark?"dark":"light";root.style.colorScheme=dark?"dark":"light";var meta=document.querySelector('meta[name="theme-color"]');if(meta){meta.setAttribute("content",dark?${JSON.stringify(
  THEME_COLORS.dark,
)}:${JSON.stringify(THEME_COLORS.light)});}}catch(error){}})();`;
