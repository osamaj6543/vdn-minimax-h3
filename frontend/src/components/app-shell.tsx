"use client";

/** Product shell: sidebar navigation, top bar, connection status and the auth
 *  guard for every signed-in page.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronRight,
  Copyright,
  LogOut,
  Menu,
  Plus,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";

import { VdnLogo, VdnMark } from "@/components/brand";
import { useSession } from "@/components/session-provider";
import { Splash } from "@/components/splash";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useGatewayHealth, type HealthState } from "@/hooks/use-gateway-health";
import { PRIMARY_NAV, SECONDARY_NAV, navItemFor, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const health = useGatewayHealth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const active = navItemFor(pathname);
  const segments = pathname.split("/").filter(Boolean);
  const nested = segments.length > 1 ? segments.slice(1).join("/") : null;

  useEffect(() => {
    document.title = `${active.section} · VDN Studio`;
  }, [active.section]);

  useEffect(() => {
    if (loading || user) return;
    // The proxy gates these routes by cookie, so a cookie the server no longer
    // accepts must be cleared here — otherwise /login would bounce us back into
    // the app and loop. Signing out server-side makes the redirect settle.
    void logout().catch(() => undefined);
    router.replace("/login");
  }, [loading, user, logout, router]);

  if (loading || !user) {
    return <Splash label={loading ? "Restoring session" : "Redirecting to sign in"} />;
  }

  const tier = user.labels[0] ?? "default";
  const displayName = user.name?.trim() || user.email.split("@")[0];
  const initial = displayName.charAt(0).toUpperCase() || "V";

  async function signOut() {
    await logout();
    router.replace("/login");
  }

  return (
    <div className="relative flex min-h-screen">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[440px] bg-[radial-gradient(60%_100%_at_50%_0%,oklch(0.83_0.06_85/7%),transparent_70%)]"
      />

      <aside className="sticky top-0 hidden h-screen w-[272px] shrink-0 border-r border-sidebar-border bg-sidebar lg:flex lg:flex-col">
        <SidebarBody active={active} tier={tier} />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="animate-drawer absolute inset-y-0 left-0 flex w-[280px] flex-col border-r border-sidebar-border bg-sidebar">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close navigation"
              className="absolute top-3 right-3"
              onClick={() => setDrawerOpen(false)}
            >
              <X />
            </Button>
            <SidebarBody
              active={active}
              tier={tier}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          active={active}
          nested={nested}
          health={health.state}
          healthCause={health.report?.cause}
          initial={initial}
          displayName={displayName}
          email={user.email}
          tier={tier}
          onOpenDrawer={() => setDrawerOpen(true)}
          onSignOut={signOut}
        />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
        <ShellFooter />
      </div>
    </div>
  );
}


function TopBar({
  active,
  nested,
  health,
  healthCause,
  initial,
  displayName,
  email,
  tier,
  onOpenDrawer,
  onSignOut,
}: {
  active: NavItem;
  nested: string | null;
  health: HealthState;
  healthCause?: string;
  initial: string;
  displayName: string;
  email: string;
  tier: string;
  onOpenDrawer: () => void;
  onSignOut: () => void | Promise<void>;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-background/75 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          aria-label="Open navigation"
          onClick={onOpenDrawer}
        >
          <Menu />
        </Button>
        <div className="min-w-0">
          <p className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
            {active.section}
          </p>
          <p className="flex items-center gap-1.5 truncate text-sm">
            <span className="font-medium">{active.label}</span>
            {nested && (
              <>
                <span className="text-muted-foreground/60">/</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {nested}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <ConnectionPill state={health} cause={healthCause} />
          <Link
            href="/dashboard"
            className={cn(
              buttonVariants({ variant: "brand", size: "sm" }),
              "hidden sm:inline-flex",
            )}
          >
            <Plus className="size-3.5" />
            New render
          </Link>
          <UserMenu
            initial={initial}
            name={displayName}
            email={email}
            tier={tier}
            onSignOut={onSignOut}
          />
        </div>
      </div>
    </header>
  );
}

function ShellFooter() {
  return (
    <footer className="border-t border-hairline px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-2 text-[0.7rem] text-muted-foreground">
        <span className="flex items-center gap-2">
          <VdnMark className="h-3 text-muted-foreground/70" title="" />
          VDN-H3 · hybrid attention · 768p · 24 fps · audio
        </span>
        <span className="flex items-center gap-1.5">
          <Copyright className="size-3" />
          Video DeltaNet
        </span>
      </div>
    </footer>
  );
}


function SidebarBody({
  active,
  tier,
  onNavigate,
}: {
  active: NavItem;
  tier: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto p-4">
      <Link
        href="/dashboard"
        aria-label="VDN Studio — create"
        className="rounded-xl px-1 py-1.5 transition-opacity hover:opacity-90"
        onClick={onNavigate}
      >
        <VdnLogo tagline />
      </Link>

      <nav className="flex flex-col gap-1">
        <p className="px-2 pb-1.5 text-[0.6rem] font-medium tracking-[0.2em] text-muted-foreground uppercase">
          Studio
        </p>
        {PRIMARY_NAV.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={item.href === active.href}
            onNavigate={onNavigate}
          />
        ))}
        <p className="px-2 pt-5 pb-1.5 text-[0.6rem] font-medium tracking-[0.2em] text-muted-foreground uppercase">
          Workspace
        </p>
        {SECONDARY_NAV.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={item.href === active.href}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className="mt-auto rounded-xl border border-hairline bg-white/[0.02] p-3">
        <p className="flex items-center gap-1.5 text-[0.6rem] tracking-[0.2em] text-muted-foreground uppercase">
          <ShieldCheck className="size-3.5 text-gold" />
          Plan
        </p>
        <p className="mt-2 text-sm font-medium capitalize">{tier}</p>
        <p className="mt-1 text-[0.7rem] leading-relaxed text-muted-foreground">
          Rate limits, priority lanes and daily quotas are enforced by the
          gateway for this tier.
        </p>
        <Link
          href="/settings"
          onClick={onNavigate}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "mt-2 w-full justify-between text-muted-foreground hover:text-foreground",
          )}
        >
          Account details
          <ChevronRight className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors",
        active
          ? "bg-sidebar-accent text-foreground ring-1 ring-hairline"
          : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg border transition-colors",
          active
            ? "border-gold/30 bg-gold/10 text-gold-soft"
            : "border-hairline bg-white/[0.02]",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={cn("truncate text-sm", active && "font-medium")}>
          {item.label}
        </span>
        <span className="truncate text-[0.7rem] text-muted-foreground">
          {item.hint}
        </span>
      </span>
      {active && <span className="absolute right-3 size-1.5 rounded-full bg-gold" />}
    </Link>
  );
}

function ConnectionPill({
  state,
  cause,
}: {
  state: HealthState;
  cause?: string;
}) {
  const meta = {
    checking: { label: "Checking gateway", tone: "text-muted-foreground" },
    online: { label: "Gateway online", tone: "text-success" },
    offline: { label: "Gateway offline", tone: "text-destructive" },
  }[state];

  return (
    <span
      title={
        state === "offline"
          ? `Gateway unreachable${cause ? ` (${cause})` : ""} — start it with: python -m server.app`
          : "Gateway health, relayed by /api/health"
      }
      className="hidden items-center gap-2 rounded-full border border-hairline bg-white/[0.03] px-2.5 py-1 text-[0.7rem] sm:inline-flex"
    >
      <span className={cn("status-dot", meta.tone)} />
      <span className={meta.tone}>{meta.label}</span>
    </span>
  );
}

function UserMenu({
  initial,
  name,
  email,
  tier,
  onSignOut,
}: {
  initial: string;
  name: string;
  email: string;
  tier: string;
  onSignOut: () => void | Promise<void>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Account menu"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-hairline bg-white/[0.04] text-xs font-medium transition-colors hover:bg-white/[0.08] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          />
        }
      >
        {initial}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {/* Base UI's GroupLabel requires a Group parent, so the account block
            and its item are grouped together. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-1 py-2">
            <span className="truncate text-sm text-foreground">{name}</span>
            <span className="truncate font-mono text-[0.7rem] font-normal text-muted-foreground">
              {email}
            </span>
            <span className="mt-1 w-fit rounded-full border border-gold/25 bg-gold/10 px-2 py-0.5 text-[0.6rem] font-normal tracking-[0.14em] text-gold-soft uppercase">
              {tier}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuItem render={<Link href="/settings" />}>
            <Settings className="size-4" />
            Workspace settings
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onSignOut}>
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

