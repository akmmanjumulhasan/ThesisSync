import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { MatchmakingClient } from "@/components/matchmaking/MatchmakingClient";

export default async function MatchmakingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.role !== "STUDENT") {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
        The Unified Matchmaking Engine is available to student accounts.
      </div>
    );
  }

  const [profile, pendingInviteCount] = await Promise.all([
    prisma.studentProfile.findUnique({ where: { userId: session.sub } }),
    prisma.teamInvite.count({ where: { toUserId: session.sub, status: "PENDING" } }),
  ]);

  return (
    <MatchmakingClient
      userName={session.name}
      initialKeywords={(profile?.researchKeywords ?? []).join(", ")}
      initialSkills={(profile?.declaredSkills ?? []).join(", ")}
      initialPendingInviteCount={pendingInviteCount}
    />
  );
}
