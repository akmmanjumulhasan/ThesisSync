import { NextResponse } from "next/server";
import { RequestStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseCommaList, scoreTeammate } from "@/lib/matching";

/**
 * Teammate mode: a student's declared skills are matched against other students'
 * GitHub-verified developer profiles and team postings. Only students who have
 * completed GitHub verification (isVerified) enter the pool, and only candidates
 * whose top languages or declared skills actually overlap with the search are returned.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const skills = parseCommaList(searchParams.get("skills") ?? "");

  if (skills.length === 0) {
    return NextResponse.json({ error: "Provide at least one skill." }, { status: 400 });
  }

  const [candidates, invites] = await Promise.all([
    prisma.studentProfile.findMany({
      where: {
        openToTeam: true,
        userId: { not: session.sub },
        user: { developerProfile: { isVerified: true } },
      },
      include: {
        user: { select: { id: true, name: true, email: true, developerProfile: true } },
      },
    }),
    // Both directions. A team link is symmetric — "My Team" counts anyone whose
    // invite was accepted either way round — so looking only at invites this
    // student *sent* left every teammate who invited them still showing an
    // "Invite to Team" button, on someone already on their team.
    prisma.teamInvite.findMany({
      where: { OR: [{ fromUserId: session.sub }, { toUserId: session.sub }] },
      select: { fromUserId: true, toUserId: true, status: true },
    }),
  ]);

  // Keyed by the *other* person, whichever end of the invite they are on.
  //
  // A pair can hold two rows if both invited each other, so an ACCEPTED one
  // always wins over a PENDING one: being on the team is the stronger fact, and
  // showing "invite sent" to someone already teamed up is the bug this fixes.
  const inviteByUser = new Map<string, string>();
  for (const invite of invites) {
    const otherId = invite.fromUserId === session.sub ? invite.toUserId : invite.fromUserId;
    const existing = inviteByUser.get(otherId);
    if (existing === RequestStatus.ACCEPTED) continue;
    inviteByUser.set(otherId, invite.status);
  }

  const ranked = candidates
    .filter((c) => c.user.developerProfile)
    .map((c) => {
      const dev = c.user.developerProfile!;
      const { matchedSkills, overlapCount, rank } = scoreTeammate(skills, {
        topLanguages: dev.topLanguages,
        declaredSkills: c.declaredSkills,
        totalCommits: dev.totalCommits,
      });
      return {
        userId: c.userId,
        name: c.user.name,
        email: c.user.email,
        githubUsername: dev.githubUsername,
        topLanguages: dev.topLanguages,
        totalCommits: dev.totalCommits,
        declaredSkills: c.declaredSkills,
        teamPost: c.teamPost,
        inviteStatus: inviteByUser.get(c.userId) ?? null,
        matchedSkills,
        overlapCount,
        rank,
      };
    })
    // A candidate only belongs in results if something they declared or GitHub-verified
    // actually overlaps with the search, matching Supervisor mode's behavior.
    .filter((c) => c.overlapCount > 0)
    .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name))
    .slice(0, 12)
    .map(({ rank: _rank, overlapCount: _overlapCount, ...rest }) => rest);

  return NextResponse.json({ matches: ranked });
}
