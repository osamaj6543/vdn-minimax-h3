import { AppShell } from "@/components/app-shell";

/** Auth guard + navigation shell for every signed-in page. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

