import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { DefenseService } from "@/services/defense.service";
import { DefenseClient } from "@/components/defense/DefenseClient";

export default async function DefensePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.role !== "STUDENT") {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
        The AI Mock Defense Simulator is available to student accounts.
      </div>
    );
  }

  const state = await DefenseService.state(session.sub);

  return <DefenseClient userName={session.name} initialState={state} />;
}
