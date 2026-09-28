import Link from "next/link";

import { AuthLayout } from "@/components/auth-layout";
import { LoginForm } from "@/components/login-form";
import { toProtectedRoute } from "@/lib/nav";
import { authReadiness } from "@/lib/server/config";

/** Server component: narrows the post-login destination and reports whether
 *  this deployment can perform server-side auth at all. */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const requested = typeof params.next === "string" ? params.next : "";
  // Only a known protected route is accepted, so `?next=` can neither become an
  // open redirect nor a path we do not actually gate.
  const next = toProtectedRoute(requested) ?? "/dashboard";

  const readiness = authReadiness();

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Continue to your VDN Studio workspace."
      footer={
        <>
          No account?{" "}
          <Link
            href="/register"
            className="text-foreground underline underline-offset-4 hover:text-gold-soft"
          >
            Create one
          </Link>
        </>
      }
    >
      <LoginForm next={next} problems={readiness.ready ? [] : readiness.problems} />
    </AuthLayout>
  );
}
