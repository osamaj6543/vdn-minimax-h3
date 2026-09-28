import Link from "next/link";

import { AuthLayout } from "@/components/auth-layout";
import { RegisterForm } from "@/components/register-form";
import { authReadiness } from "@/lib/server/config";

/** Server component: surfaces missing auth env before the user types anything. */
export default function RegisterPage() {
  const readiness = authReadiness();

  return (
    <AuthLayout
      title="Create your account"
      subtitle="One workspace for every VDN-H3 generation mode."
      footer={
        <>
          Already registered?{" "}
          <Link
            href="/login"
            className="text-foreground underline underline-offset-4 hover:text-gold-soft"
          >
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm problems={readiness.ready ? [] : readiness.problems} />
    </AuthLayout>
  );
}
