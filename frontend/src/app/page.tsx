"use client";

/** Root redirect: signed-in users land in the studio, everyone else on /login.
 *  The branded splash covers the session round-trip.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useSession } from "@/components/session-provider";
import { Splash } from "@/components/splash";

export default function Home() {
  const { user, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/dashboard" : "/login");
  }, [user, loading, router]);

  return (
    <Splash
      label={loading ? "Restoring session" : user ? "Opening studio" : "Opening sign in"}
    />
  );
}
