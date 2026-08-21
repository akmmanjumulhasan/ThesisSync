import { NextResponse } from "next/server";
import { RequestStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { NotificationService } from "@/services/notification.service";

/** Teammate mode: invite a GitHub-verified student to team up. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { toUserId } = await req.json();
  if (!toUserId) {
    return NextResponse.json({ error: "toUserId is required." }, { status: 400 });
  }
  if (toUserId === session.sub) {
    return NextResponse.json({ error: "You can't invite yourself." }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id: toUserId } });
  if (!target) {
    return NextResponse.json({ error: "That student was not found." }, { status: 404 });
  }

  const invite = await prisma.teamInvite.upsert({
    where: { fromUserId_toUserId: { fromUserId: session.sub, toUserId } },
    update: { status: RequestStatus.PENDING },
    create: { fromUserId: session.sub, toUserId, status: RequestStatus.PENDING },
  });

  // Module 3 (Member 3): Smart Notification System. Deduped like supervision
  // requests, since re-inviting the same person is legal but not news.
  await NotificationService.safeNotify({
    userId: toUserId,
    event: "TEAM_INVITE_RECEIVED",
    title: `${session.name} invited you to team up`,
    body: `${session.name} wants to work with you on their thesis. Accept or decline it from matchmaking.`,
    link: "/dashboard/matchmaking",
    subjectType: "teamInvite",
    subjectId: invite.id,
    dedupeWithinMs: 60 * 60 * 1000,
  });

  return NextResponse.json({ success: true, invite });
}

/** The invites *you've received*: the other half of Teammate mode, so they don't just vanish into the void. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const invites = await prisma.teamInvite.findMany({
    where: { toUserId: session.sub },
    include: {
      from: {
        select: {
          name: true,
          email: true,
          developerProfile: true,
          studentProfile: { select: { declaredSkills: true, teamPost: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const received = invites.map((i) => ({
    id: i.id,
    fromUserId: i.fromUserId,
    fromName: i.from.name,
    fromEmail: i.from.email,
    githubUsername: i.from.developerProfile?.githubUsername ?? null,
    isVerified: i.from.developerProfile?.isVerified ?? false,
    topLanguages: i.from.developerProfile?.topLanguages ?? [],
    totalCommits: i.from.developerProfile?.totalCommits ?? 0,
    declaredSkills: i.from.studentProfile?.declaredSkills ?? [],
    teamPost: i.from.studentProfile?.teamPost ?? null,
    status: i.status,
    createdAt: i.createdAt,
  }));

  return NextResponse.json({ invites: received });
}

/** Accept or decline an invite someone sent you. */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { inviteId, action } = await req.json();
  if (!inviteId || (action !== "ACCEPT" && action !== "DECLINE")) {
    return NextResponse.json({ error: "inviteId and a valid action are required." }, { status: 400 });
  }

  const existing = await prisma.teamInvite.findUnique({ where: { id: inviteId } });
  if (!existing || existing.toUserId !== session.sub) {
    return NextResponse.json({ error: "Invite not found." }, { status: 404 });
  }

  const newStatus = action === "ACCEPT" ? RequestStatus.ACCEPTED : RequestStatus.DECLINED;
  const updated = await prisma.teamInvite.update({
    where: { id: inviteId },
    data: { status: newStatus },
  });

  return NextResponse.json({ success: true, invite: updated });
}
