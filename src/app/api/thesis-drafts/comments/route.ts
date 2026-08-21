import { NextResponse } from "next/server";
import { RequestStatus, Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/** True if `supervisorUserId` is the accepted supervisor of `studentId`. */
async function isAcceptedSupervisorOf(supervisorUserId: string, studentId: string): Promise<boolean> {
  const supervisorProfile = await prisma.supervisorProfile.findUnique({ where: { userId: supervisorUserId } });
  if (!supervisorProfile) return false;
  const link = await prisma.matchRequest.findUnique({
    where: { studentId_supervisorId: { studentId, supervisorId: supervisorProfile.id } },
  });
  return Boolean(link && link.status === RequestStatus.ACCEPTED);
}

/** Leave an inline comment anchored to a character range within a draft version. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { versionId, startOffset, endOffset, quotedText, body: commentBody } = await req.json();

  if (
    typeof versionId !== "string" ||
    !Number.isInteger(startOffset) ||
    !Number.isInteger(endOffset) ||
    startOffset < 0 ||
    endOffset <= startOffset ||
    typeof commentBody !== "string" ||
    !commentBody.trim()
  ) {
    return NextResponse.json({ error: "A valid versionId, offset range, and comment body are required." }, { status: 400 });
  }

  const version = await prisma.draftVersion.findUnique({ where: { id: versionId }, include: { chapter: true } });
  if (!version) {
    return NextResponse.json({ error: "Version not found." }, { status: 404 });
  }

  const isOwner = version.chapter.studentId === session.sub;
  const isSupervisor =
    session.role === Role.SUPERVISOR && (await isAcceptedSupervisorOf(session.sub, version.chapter.studentId));
  if (!isOwner && !isSupervisor) {
    return NextResponse.json({ error: "You don't have access to this chapter." }, { status: 403 });
  }

  const comment = await prisma.draftComment.create({
    data: {
      versionId,
      authorId: session.sub,
      startOffset,
      endOffset,
      quotedText: typeof quotedText === "string" ? quotedText.slice(0, 500) : "",
      body: commentBody.trim().slice(0, 2000),
    },
    include: { author: { select: { name: true, role: true } } },
  });

  return NextResponse.json({
    comment: {
      id: comment.id,
      authorName: comment.author.name,
      authorRole: comment.author.role,
      startOffset: comment.startOffset,
      endOffset: comment.endOffset,
      quotedText: comment.quotedText,
      body: comment.body,
      resolved: comment.resolved,
      createdAt: comment.createdAt,
    },
  });
}
