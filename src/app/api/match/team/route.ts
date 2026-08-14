import { NextResponse } from "next/server";
import { RequestStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * Teammate mode: the team you've actually ended up with.
 *
 * There is no Team record — a team is implicit, formed by TeamInvite rows that
 * reached ACCEPTED. Direction doesn't matter to membership: whether you invited
 * them or they invited you, an accepted invite means you're on a team together,
 * so both sides are read here and merged into one roster.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const teammateFields = {
    select: {
      id: true,
      name: true,
      email: true,
      department: true,
      developerProfile: true,
      studentProfile: { select: { declaredSkills: true, teamPost: true } },
    },
  } as const;

  const [accepted, removals] = await Promise.all([
    prisma.teamInvite.findMany({
      where: {
        status: RequestStatus.ACCEPTED,
        OR: [{ fromUserId: session.sub }, { toUserId: session.sub }],
      },
      include: { from: teammateFields, to: teammateFields },
      orderBy: { createdAt: "asc" },
    }),
    // Removals this student has filed, so a card can show "awaiting your
    // supervisor" instead of offering the button again.
    prisma.teamRemovalRequest.findMany({
      where: { requesterId: session.sub },
      orderBy: { createdAt: "desc" },
      select: { targetId: true, status: true, decisionNote: true, supervisor: { select: { user: { select: { name: true } } } } },
    }),
  ]);

  const removalByTarget = new Map<string, (typeof removals)[number]>();
  for (const r of removals) {
    if (!removalByTarget.has(r.targetId)) removalByTarget.set(r.targetId, r);
  }

  // A pair can hold two accepted rows (the unique constraint is per-direction, so
  // A->B and B->A can both exist). Keyed by teammate id, first write wins, which
  // — given the ascending sort — keeps the invite that actually formed the team.
  const roster = new Map<string, unknown>();

  for (const invite of accepted) {
    const iSent = invite.fromUserId === session.sub;
    const mate = iSent ? invite.to : invite.from;
    if (mate.id === session.sub || roster.has(mate.id)) continue;

    roster.set(mate.id, {
      userId: mate.id,
      name: mate.name,
      email: mate.email,
      department: mate.department,
      githubUsername: mate.developerProfile?.githubUsername ?? null,
      isVerified: mate.developerProfile?.isVerified ?? false,
      topLanguages: mate.developerProfile?.topLanguages ?? [],
      totalCommits: mate.developerProfile?.totalCommits ?? 0,
      declaredSkills: mate.studentProfile?.declaredSkills ?? [],
      teamPost: mate.studentProfile?.teamPost ?? null,
      joinedAt: invite.createdAt,
      // Whose invite formed the team, so the UI can say "you invited them" vs
      // "they invited you" instead of flattening both into a bare name.
      origin: iSent ? "SENT" : "RECEIVED",
      removal: (() => {
        const r = removalByTarget.get(mate.id);
        if (!r) return null;
        return {
          status: r.status,
          supervisorName: r.supervisor.user.name,
          decisionNote: r.decisionNote,
        };
      })(),
    });
  }

  const teammates = [...roster.values()];

  return NextResponse.json({ teammates, count: teammates.length });
}
