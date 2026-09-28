/** Shows exactly which server env vars are missing when auth cannot run.
 *
 * Server-side sign-in is not a client feature that can degrade quietly: without
 * the Appwrite API key the server cannot receive a session secret at all, so the
 * form is disabled and the reason is spelled out instead of failing per attempt.
 */
import { TriangleAlert } from "lucide-react";

export function ServerConfigNotice({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/[0.08] p-3">
      <p className="flex items-center gap-2 text-[0.75rem] font-medium text-warning">
        <TriangleAlert className="size-3.5" />
        Server-side auth is not configured
      </p>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-[0.7rem] leading-relaxed text-muted-foreground">
        {problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
      <p className="mt-2 font-mono text-[0.65rem] leading-relaxed text-muted-foreground">
        frontend/.env · see .env.local.example
      </p>
    </div>
  );
}
