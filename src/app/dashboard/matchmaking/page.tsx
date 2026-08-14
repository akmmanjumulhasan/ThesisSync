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

  const [profile, pendingInviteCount, acceptedInvites] = await Promise.all([
    prisma.studentProfile.findUnique({ where: { userId: session.sub } }),
    prisma.teamInvite.count({ where: { toUserId: session.sub, status: "PENDING" } }),
    // Counted rather than tallied: a pair can hold an accepted invite in both
    // directions, and that is still one teammate. /api/match/team dedupes the
    // same way, so the badge matches the roster it opens.
    prisma.teamInvite.findMany({
      where: {
        status: "ACCEPTED",
        OR: [{ fromUserId: session.sub }, { toUserId: session.sub }],
      },
      select: { fromUserId: true, toUserId: true },
    }),
  ]);

  const teamCount = new Set(
    acceptedInvites.map((i) => (i.fromUserId === session.sub ? i.toUserId : i.fromUserId))
  ).size;

  return (
    <MatchmakingClient
      userName={session.name}
      initialKeywords={(profile?.researchKeywords ?? []).join(", ")}
      initialSkills={(profile?.declaredSkills ?? []).join(", ")}
      initialPendingInviteCount={pendingInviteCount}
      initialTeamCount={teamCount}
    />
  );
}
