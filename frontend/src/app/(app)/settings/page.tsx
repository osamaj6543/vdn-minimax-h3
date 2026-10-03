"use client";

/** Workspace settings: identity, plan tier, and the live connection surface. */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CircleHelp,
  Cpu,
  Copy,
  KeyRound,
  LogOut,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  SunMoon,
  User,
  type LucideIcon,
} from "lucide-react";

import { useSession } from "@/components/session-provider";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { checkHealth, type HealthReport } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { DEFAULT_THEME, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

type Health = "unknown" | "ok" | "down";

/** Order matters: dark first, because dark is the product default. */
const THEME_OPTIONS: { key: Theme; icon: LucideIcon; label: string }[] = [
  { key: "dark", icon: Moon, label: "Dark" },
  { key: "light", icon: Sun, label: "Light" },
];

export default function SettingsPage() {
  const { user, logout } = useSession();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [testing, setTesting] = useState(false);
  const [health, setHealth] = useState<Health>("unknown");
  const [report, setReport] = useState<HealthReport | null>(null);

  const tier = user?.labels[0] ?? "default";
  const displayName = user?.name?.trim() || (user?.email ?? "").split("@")[0];
  const initial = displayName.charAt(0).toUpperCase() || "V";

  const probe = useCallback(async () => {
    const next = await checkHealth();
    setReport(next);
    setHealth(next.ok ? "ok" : "down");
    return next;
  }, []);

  // Deployment details come from the server (they are not baked into the
  // client bundle any more), so ask once on mount.
  useEffect(() => {
    const kickoff = setTimeout(() => {
      void probe();
    }, 0);
    return () => clearTimeout(kickoff);
  }, [probe]);

  async function onTestConnection() {
    setTesting(true);
    await probe();
    setTesting(false);
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl font-medium tracking-tight sm:text-[1.75rem]">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Identity comes from Appwrite; plan tier, quotas and priority lanes are
          enforced by the VDN gateway.
        </p>
      </header>

      <section className="panel p-5">
        <SectionHeading icon={User} title="Account" hint="Managed by Appwrite" />
        <div className="mt-5 flex items-center gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-full border border-hairline bg-tint/[0.04] text-base font-medium">
            {initial}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{displayName}</span>
            <span className="truncate font-mono text-[0.7rem] text-muted-foreground">
              {user?.email}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
          >
            <LogOut className="size-3.5" />
            Sign out
          </Button>
        </div>
        <Separator className="my-4" />
        <dl className="grid gap-x-6 gap-y-3 text-[0.75rem] sm:grid-cols-2">
          <Row
            label="User ID"
            value={user?.id ?? "—"}
            mono
            onCopy={user?.id ? () => copyText(user.id, "User id copied") : undefined}
          />
          <Row
            label="Registered"
            value={
              user?.registeredAt
                ? new Date(user.registeredAt).toLocaleDateString()
                : "—"
            }
          />
          <Row
            label="Labels"
            value={user && user.labels.length > 0 ? user.labels.join(", ") : "none"}
          />
          <Row label="Plan" value={tier} capitalize />
        </dl>
      </section>

      <section className="panel p-5">
        <SectionHeading
          icon={SunMoon}
          title="Appearance"
          hint="Remembered in this browser only"
        />
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label="Colour scheme"
            className="flex items-center rounded-lg border border-hairline bg-tint/[0.02] p-0.5"
          >
            {THEME_OPTIONS.map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                type="button"
                aria-pressed={theme === key}
                onClick={() => setTheme(key)}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[0.75rem] transition-colors",
                  theme === key
                    ? "bg-tint/[0.07] text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
          <p className="text-[0.75rem] leading-relaxed text-muted-foreground">
            <span className="capitalize">{DEFAULT_THEME}</span> is the product
            theme: a first visit always lands there. Your pick is stored in this
            browser and never sent to the gateway.
          </p>
        </div>
      </section>

      <section className="panel p-5">
        <SectionHeading
          icon={ShieldCheck}
          title="Plan & limits"
          hint="Applied per API key on the gateway"
        />
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 rounded-full border border-gold/25 bg-gold/10 px-3 py-1 text-[0.75rem] text-gold-soft">
            <ShieldCheck className="size-3.5" />
            <span className="capitalize">{tier}</span>
          </span>
          <p className="text-[0.75rem] text-muted-foreground">
            Requests per minute, daily job quota, maximum priority and allowed
            pools come from this tier.
          </p>
        </div>
        <ul className="mt-4 grid gap-2 text-[0.75rem] text-muted-foreground sm:grid-cols-2">
          <li className="rounded-lg border border-hairline bg-tint/[0.02] px-3 py-2">
            <span className="text-foreground">Priority lanes</span> — high,
            standard and low are served in order per pool.
          </li>
          <li className="rounded-lg border border-hairline bg-tint/[0.02] px-3 py-2">
            <span className="text-foreground">Queue behaviour</span> — jobs are
            durable; a restarted worker reclaims stale renders.
          </li>
        </ul>
      </section>

      <section className="panel p-5">
        <SectionHeading
          icon={Cpu}
          title="Connection"
          hint="Everything routes through this app's server"
        />
        <dl className="mt-5 grid gap-x-6 gap-y-3 text-[0.75rem] sm:grid-cols-2">
          <Row label="Gateway API" value={report?.gateway ?? "checking…"} mono />
          <Row label="Appwrite project" value={report?.appwriteProject ?? "checking…"} mono />
          <Row label="Browser → gateway" value="via /api/gateway (server-side JWT)" mono />
          <Row label="Health probe" value="gateway /healthz, relayed by /api/health" mono />
        </dl>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={onTestConnection} disabled={testing}>
            <RefreshCw className={cn("size-3.5", testing && "animate-spin")} />
            {testing ? "Probing…" : "Test connection"}
          </Button>
          <span
            className={cn(
              "flex items-center gap-2 rounded-full border px-2.5 py-1 text-[0.72rem]",
              health === "ok" && "border-success/25 bg-success/10 text-success",
              health === "down" && "border-destructive/30 bg-destructive/10 text-destructive",
              health === "unknown" && "border-hairline bg-tint/[0.03] text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "status-dot",
                health === "ok" && "text-success",
                health === "down" && "text-destructive",
                health === "unknown" && "text-muted-foreground",
              )}
            />
            {health === "ok"
              ? "Gateway responded"
              : health === "down"
                ? "No response"
                : "Not tested yet"}
          </span>
        </div>
      </section>

      <section className="panel p-5">
        <SectionHeading
          icon={KeyRound}
          title="Credentials & security"
          hint="How this client authenticates"
        />
        <ul className="mt-5 grid gap-2 text-[0.75rem] leading-relaxed text-muted-foreground">
          <li className="rounded-lg border border-hairline bg-tint/[0.02] px-3 py-2">
            Your password is posted to this app&apos;s own server, which exchanges
            it with Appwrite. Client JavaScript never sees an Appwrite session.
          </li>
          <li className="rounded-lg border border-hairline bg-tint/[0.02] px-3 py-2">
            The session secret is sealed (AES-256-GCM) inside an httpOnly,
            SameSite=Lax cookie — unreadable by scripts and useless if the cookie
            value leaks without the server key.
          </li>
          <li className="rounded-lg border border-hairline bg-tint/[0.02] px-3 py-2">
            The gateway JWT is minted server-side per request from that session
            (cached 10 min, 15-min tokens) and attached by the proxy route. It is
            never sent to, or stored in, the browser.
          </li>
          <li className="rounded-lg border border-hairline bg-tint/[0.02] px-3 py-2">
            Sign-out revokes the Appwrite session server-side and drops the cached
            JWT, so a copied token cannot outlive the session.
          </li>
          <li className="rounded-lg border border-hairline bg-tint/[0.02] px-3 py-2">
            Artifacts are streamed through an auth-gated endpoint and played from
            a local blob URL — no public object host is required.
          </li>
        </ul>
      </section>

      <section className="panel flex flex-wrap items-center gap-4 p-5">
        <span className="grid size-9 place-items-center rounded-xl border border-hairline bg-tint/[0.03] text-muted-foreground">
          <CircleHelp className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col">
          <p className="text-sm font-medium">Need the API surface?</p>
          <p className="text-[0.72rem] text-muted-foreground">
            Every mode is a POST on the gateway; the wire schemas live in
            server/schemas.py. Calls go through this app&apos;s proxy, which
            attaches the JWT.
          </p>
        </div>
        <code className="ml-auto rounded-lg border border-hairline bg-code px-3 py-1.5 font-mono text-[0.7rem] text-muted-foreground">
          POST /api/gateway/v1/video/t2v
        </code>
      </section>
    </div>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-hairline bg-tint/[0.03] text-gold/80">
        <Icon className="size-4" />
      </span>
      <div className="flex flex-col">
        <h2 className="text-sm font-medium tracking-tight">{title}</h2>
        <p className="text-[0.7rem] text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
  capitalize = false,
  onCopy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  capitalize?: boolean;
  onCopy?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hairline pb-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "truncate text-right",
            mono && "font-mono text-[0.7rem]",
            capitalize && "capitalize",
          )}
        >
          {value}
        </span>
        {onCopy && (
          <button
            type="button"
            aria-label={`Copy ${label}`}
            onClick={onCopy}
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Copy className="size-3" />
          </button>
        )}
      </dd>
    </div>
  );
}

