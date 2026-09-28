"use client";

/** Sign-up form — same server-side exchange as sign-in. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { ServerConfigNotice } from "@/components/server-config-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/components/session-provider";
import { AuthError } from "@/lib/auth-client";

const MIN_PASSWORD = 8;

export function RegisterForm({ problems = [] }: { problems?: string[] }) {
  const { register } = useSession();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(problems);

  const disabled = busy || blocked.length > 0;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) {
      toast.error(`Password must be at least ${MIN_PASSWORD} characters`);
      return;
    }
    setBusy(true);
    try {
      await register(email, password, name);
      toast.success("Account created — welcome!");
      router.replace("/dashboard");
    } catch (error) {
      if (error instanceof AuthError && error.problems.length > 0) {
        setBlocked(error.problems);
      }
      toast.error(error instanceof Error ? error.message : "Registration failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <ServerConfigNotice problems={blocked} />

      <div className="grid gap-2">
        <Label htmlFor="name" className="text-[0.7rem] tracking-[0.12em] uppercase">
          Name
        </Label>
        <Input
          id="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoComplete="name"
          className="h-9"
        />
      </div>
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
          minLength={MIN_PASSWORD}
          autoComplete="new-password"
          className="h-9"
        />
        <p className="text-[0.7rem] text-muted-foreground">
          At least {MIN_PASSWORD} characters.
        </p>
      </div>

      <Button type="submit" variant="brand" size="cta" className="mt-1" disabled={disabled}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {busy ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
