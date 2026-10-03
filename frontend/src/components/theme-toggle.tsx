"use client";

/** Sun/moon switch for the colour scheme.
 *
 *  The two glyphs are chosen in CSS (`dark:block` / `dark:hidden`) instead of
 *  from React state, so the right one is painted on the very first frame —
 *  before the provider has read the stored preference — and hydration can never
 *  disagree with the server-rendered dark default.
 */
import { Moon, Sun } from "lucide-react";

import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn("text-muted-foreground hover:text-foreground", className)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={toggleTheme}
    >
      {/* Shown in dark: light is the action available. */}
      <Sun className="hidden dark:block" />
      {/* Shown in light: dark is the action available. */}
      <Moon className="block dark:hidden" />
    </Button>
  );
}
