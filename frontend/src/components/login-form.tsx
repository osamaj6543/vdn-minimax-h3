"use client";

/** Sign-in form. Credentials go to our own server (`/api/auth/login`), which
 *  performs the Appwrite exchange — this component never holds a session. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, LockKeyhole } from "lucide-react";
import { toast } from "sonner";

import { ServerConfigNotice } from "@/components/server-config-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/components/session-provider";
import { AuthError } from "@/lib/auth-client";
import type { ProtectedRoute } from "@/lib/nav";

export function LoginForm({
  next,
  problems = [],
}: {
  /** Server-validated destination, narrowed to a known protected route. */
  next: ProtectedRoute;
  problems?: string[];
}) {
  const { login } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(problems);

  const disabled = busy || blocked.length > 0;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await login(email, password);
      toast.success("Welcome back");
      router.replace(next);
    } catch (error) {
      if (error instanceof AuthError && error.problems.length > 0) {
        setBlocked(error.problems);
      }
      toast.error(error instanceof Error ? error.message : "Login failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <ServerConfigNotice problems={blocked} />

      <div className="grid gap-2">
        <Label htmlFor="email" className="text-[0.7rem] tracking-[0.12em] uppercase">
          Email
        </Label>
        <Input
          id="email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoComplete="email"
          className="h-9"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password" className="text-[0.7rem] tracking-[0.12em] uppercase">
          Password
        </Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          autoComplete="current-password"
          className="h-9"
        />
      </div>

      <Button
        type="submit"
        variant="brand"
        size="cta"
        className="mt-1"
        disabled={disabled}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
        {busy ? "Signing in…" : "Sign in"}
      </Button>

      <p className="flex items-start gap-2 text-[0.7rem] leading-relaxed text-muted-foreground">
        <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-gold/70" />
        Your password is exchanged by this app&apos;s server, never by the browser.
        The session lives in an httpOnly cookie and the gateway token stays
        server-side.
      </p>
    </form>
  );
}
