import { NextResponse } from "next/server";
import { RequestStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * Module 1 (Member 2): supervisor-approved teammate removal.
 *
 * Adding a teammate is mutual — both sides consent via the invite. Removing one
 * is not, so it can't be unilateral: a student files a request, and their
 * supervisor decides. Nothing about the team changes until that approval lands.
 */

/** Both accepted invites between a pair, in whichever direction they exist. */
function invitesBetween(a: string, b: string) {
  return {
    status: RequestStatus.ACCEPTED,
    OR: [
      { fromUserId: a, toUserId: b },
      { fromUserId: b, toUserId: a },
    ],
  };
}

/** Student files a removal request against a current teammate. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { targetUserId, reason } = await req.json();
  if (!targetUserId) {
    return NextResponse.json({ error: "targetUserId is required." }, { status: 400 });
  }
  if (targetUserId === session.sub) {
    return NextResponse.json({ error: "You can't remove yourself." }, { status: 400 });
  }
  if (typeof reason !== "string" || reason.trim().length < 10) {
    return NextResponse.json(
      { error: "Give your supervisor a reason of at least 10 characters." },
      { status: 400 }
    );
  }

  // They must actually be teammates. Without this, anyone could file a request
  // against any user in the system.
  const teamed = await prisma.teamInvite.findFirst({ where: invitesBetween(session.sub, targetUserId) });
  if (!teamed) {
    return NextResponse.json({ error: "That student isn't on your team." }, { status: 400 });
  }

  const duplicate = await prisma.teamRemovalRequest.findFirst({
    where: { requesterId: session.sub, targetId: targetUserId, status: RequestStatus.PENDING },
  });
  if (duplicate) {
    return NextResponse.json(
      { error: "You already have a removal request pending for this teammate." },
      { status: 409 }
    );
  }

  // The decision belongs to the requester's own accepted supervisor. No accepted
  // supervisor means there is nobody with the standing to approve it.
  const supervision = await prisma.matchRequest.findFirst({
    where: { studentId: session.sub, status: RequestStatus.ACCEPTED },
    orderBy: { createdAt: "desc" },
    include: { supervisor: { include: { user: { select: { name: true } } } } },
  });
  if (!supervision) {
    return NextResponse.json(
      { error: "You need an accepted supervisor before a teammate can be removed." },
      { status: 409 }
    );
  }

  const request = await prisma.teamRemovalRequest.create({
    data: {
      requesterId: session.sub,
      targetId: targetUserId,
      supervisorId: supervision.supervisorId,
      reason: reason.trim().slice(0, 1000),
    },
  });

  return NextResponse.json({
    success: true,
    request,
    supervisorName: supervision.supervisor.user.name,
  });
}

/**
 * Supervisors see what awaits their decision; students see the requests they
 * filed, so a pending removal is visible from the team roster.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  if (session.role === "SUPERVISOR") {
    const profile = await prisma.supervisorProfile.findUnique({ where: { userId: session.sub } });
    if (!profile) return NextResponse.json({ requests: [] });

    const requests = await prisma.teamRemovalRequest.findMany({
      where: { supervisorId: profile.id },
      include: {
        requester: { select: { name: true, email: true } },
        target: { select: { name: true, email: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({
      requests: requests.map((r) => ({
        id: r.id,
        requesterName: r.requester.name,
        requesterEmail: r.requester.email,
        targetName: r.target.name,
        targetEmail: r.target.email,
        reason: r.reason,
        status: r.status,
        decisionNote: r.decisionNote,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt,
      })),
    });
  }

  const mine = await prisma.teamRemovalRequest.findMany({
    where: { requesterId: session.sub },
    include: { target: { select: { name: true } }, supervisor: { include: { user: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    requests: mine.map((r) => ({
      id: r.id,
      targetId: r.targetId,
      targetName: r.target.name,
      supervisorName: r.supervisor.user.name,
      reason: r.reason,
      status: r.status,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
    })),
  });
}

/** The supervisor's decision. Approval is what actually severs the team link. */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  if (session.role !== "SUPERVISOR") {
    return NextResponse.json({ error: "Only a supervisor can decide a removal." }, { status: 403 });
  }

  const { requestId, action, note } = await req.json();
  if (!requestId || (action !== "APPROVE" && action !== "DECLINE")) {
    return NextResponse.json({ error: "requestId and a valid action are required." }, { status: 400 });
  }

  const profile = await prisma.supervisorProfile.findUnique({ where: { userId: session.sub } });
  const existing = profile
    ? await prisma.teamRemovalRequest.findUnique({ where: { id: requestId } })
    : null;

  // Scoped to this supervisor's own queue: another supervisor's pending decision
  // is not theirs to make.
  if (!existing || !profile || existing.supervisorId !== profile.id) {
    return NextResponse.json({ error: "Removal request not found." }, { status: 404 });
  }
  if (existing.status !== RequestStatus.PENDING) {
    return NextResponse.json({ error: "That request has already been decided." }, { status: 409 });
  }

  const approved = action === "APPROVE";

  const updated = await prisma.$transaction(async (tx) => {
    if (approved) {
      // Delete rather than mark DECLINED: the @@unique([fromUserId, toUserId])
      // constraint means a leftover row would block ever re-inviting this pair.
      // The TeamRemovalRequest row remains as the audit trail.
      await tx.teamInvite.deleteMany({ where: invitesBetween(existing.requesterId, existing.targetId) });
    }

    return tx.teamRemovalRequest.update({
      where: { id: requestId },
      data: {
        status: approved ? RequestStatus.ACCEPTED : RequestStatus.DECLINED,
        decisionNote: typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : null,
        decidedAt: new Date(),
      },
    });
  });

  return NextResponse.json({ success: true, request: updated, removed: approved });
}
