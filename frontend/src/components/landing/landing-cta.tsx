"use client";

/** The landing page's calls to action, resolved against the live session.
 *
 * A signed-in visitor gets a way back into the studio instead of a second
 * sign-in prompt; everyone else gets sign in + create account. The session
 * itself is server-sourced (`/api/auth/session`), so this component only reads
 * what the server already decided.
 */
import Link from "next/link";
import { ArrowRight, LayoutGrid, UserPlus } from "lucide-react";

import { useSession } from "@/components/session-provider";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function LandingCta({
  size = "cta",
  /** Hides the secondary button, e.g. in the sticky nav. */
  compact = false,
  className,
}: {
  size?: "cta" | "lg";
  compact?: boolean;
  className?: string;
}) {
  const { user } = useSession();

  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      {user ? (
        <Link
          href="/dashboard"
          className={buttonVariants({ variant: "brand", size })}
        >
          <LayoutGrid className="size-4" />
          Open studio
        </Link>
      ) : (
        <Link
          href="/register"
          className={buttonVariants({ variant: "brand", size })}
        >
          <ArrowRight className="size-4" />
          Get started
        </Link>
      )}

      {!compact &&
        (user ? (
          <Link
            href="/jobs"
            className={buttonVariants({ variant: "outline", size })}
          >
            View library
          </Link>
        ) : (
          <Link
            href="/login"
            className={buttonVariants({ variant: "outline", size })}
          >
            <UserPlus className="size-4" />
            Sign in
          </Link>
        ))}
    </div>
  );
}
