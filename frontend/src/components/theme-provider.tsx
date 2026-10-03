"use client";

/** Colour-scheme context: dark by default, light on request.
 *
 *  `<html class="dark">` is the single source of truth. It is server-rendered,
 *  then reconciled with the stored preference by the pre-paint script
 *  (`THEME_INIT_SCRIPT`) before the first frame. This provider therefore never
 *  *decides* a colour: it observes the document through `useSyncExternalStore`
 *  and writes to it when the user asks for a change. Nothing about the visible
 *  palette depends on React — the icons and every token switch in CSS.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

import {
  DEFAULT_THEME,
  THEME_COLORS,
  THEME_STORAGE_KEY,
  normalizeTheme,
  type Theme,
} from "@/lib/theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Fired in this document after a theme change, so observers re-read the DOM. */
const THEME_EVENT = "vdn:theme";

/** Writes a theme onto the document. Lockstep twin of `THEME_INIT_SCRIPT`
 *  (src/lib/theme.ts) — change one and you must change the other. */
function applyTheme(theme: Theme) {
  const dark = theme !== "light";
  const root = document.documentElement;
  // `.dark` is what every `dark:` utility and the `.dark { … }` token block key
  // off, so this one class is the entire switch.
  root.classList.toggle("dark", dark);
  root.dataset.theme = dark ? "dark" : "light";
  root.style.colorScheme = dark ? "dark" : "light";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? THEME_COLORS.dark : THEME_COLORS.light);
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Snapshot contract: cheap, primitive, and derived from the live document. */
function getSnapshot(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Server render — and React's first client render during hydration — always
 *  sees the product default, matching the server-rendered `class="dark"`. React
 *  re-reads the real snapshot immediately after hydration; nothing visibly
 *  moves, because the only themed React output is an aria-label. */
function getServerSnapshot(): Theme {
  return DEFAULT_THEME;
}

function subscribe(onStoreChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    // `storage` fires only in the *other* documents, and they have already
    // written localStorage — so adopt their choice here and let observers
    // re-read the class we just set.
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    applyTheme(normalizeTheme(event.newValue));
  };
  window.addEventListener(THEME_EVENT, onStoreChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(THEME_EVENT, onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode / storage disabled — the choice is then session-only.
    }
    applyTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    // Read the DOM rather than a React value, so the flip always matches what
    // is actually on screen.
    setTheme(
      document.documentElement.classList.contains("dark") ? "light" : "dark",
    );
  }, [setTheme]);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return context;
}
