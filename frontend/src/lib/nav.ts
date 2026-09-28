/** Single source of truth for the shell's navigation.
 *
 * `href` stays a literal union (not `string`) so it satisfies Next's typed
 * routes when handed to <Link>.
 */
import { Clapperboard, LayoutGrid, Settings, type LucideIcon } from "lucide-react";

export type NavHref = "/dashboard" | "/jobs" | "/settings";

export interface NavItem {
  href: NavHref;
  /** Sidebar label. */
  label: string;
  /** One-line description, shown under the label in the sidebar. */
  hint: string;
  /** Topbar eyebrow for this section. */
  section: string;
  icon: LucideIcon;
}

export const PRIMARY_NAV: NavItem[] = [
  {
    href: "/dashboard",
    label: "Create",
    hint: "Prompt → video",
    section: "Creation studio",
    icon: Clapperboard,
  },
  {
    href: "/jobs",
    label: "Library",
    hint: "Every render",
    section: "Render library",
    icon: LayoutGrid,
  },
];

export const SECONDARY_NAV: NavItem[] = [
  {
    href: "/settings",
    label: "Settings",
    hint: "Account & gateway",
    section: "Workspace settings",
    icon: Settings,
  },
];

export const ALL_NAV: NavItem[] = [...PRIMARY_NAV, ...SECONDARY_NAV];

/** The only routes behind the session gate. Shared by `src/proxy.ts` (which
 *  enforces it) and the sign-in flow (which may only redirect back to one of
 *  these), so the guard and its destinations cannot drift apart. */
export const PROTECTED_ROUTES = ["/dashboard", "/jobs", "/settings"] as const;

export type ProtectedRoute = (typeof PROTECTED_ROUTES)[number];

/** Narrows an untrusted `?next=` value to a known protected route. */
export function toProtectedRoute(value: string | null | undefined): ProtectedRoute | null {
  return PROTECTED_ROUTES.find(
    (route) => value === route || (value?.startsWith(`${route}/`) ?? false),
  ) ?? null;
}

/** Longest-prefix match, so /jobs/<id> keeps Library active. */
export function navItemFor(pathname: string): NavItem {
  return (
    ALL_NAV.find(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    ) ?? PRIMARY_NAV[0]
  );
}
