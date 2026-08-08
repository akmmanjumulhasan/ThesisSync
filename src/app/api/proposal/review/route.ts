import { NextResponse } from "next/server";
import { ProposalEvent, ProposalStatus, RequestStatus, Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/** Supervisor approves a submitted proposal, or returns it with comments for revision. */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session || session.role !== Role.SUPERVISOR) {
    return NextResponse.json({ error: "Only supervisors can review a proposal." }, { status: 403 });
  }

  const { proposalId, action, comment } = await req.json();
  if (!proposalId || (action !== "APPROVE" && action !== "RETURN")) {
    return NextResponse.json({ error: "proposalId and a valid action are required." }, { status: 400 });
  }
  const remarks = typeof comment === "string" ? comment.trim().slice(0, 2000) : "";
  if (action === "RETURN" && !remarks) {
    return NextResponse.json({ error: "Add a comment explaining what needs revision." }, { status: 400 });
  }

  const proposal = await prisma.thesisProposal.findUnique({ where: { id: proposalId } });
  if (!proposal || proposal.status !== ProposalStatus.SUBMITTED) {
    return NextResponse.json({ error: "This proposal isn't awaiting review." }, { status: 404 });
  }

  const supervisorProfile = await prisma.supervisorProfile.findUnique({ where: { userId: session.sub } });
  if (!supervisorProfile) {
    return NextResponse.json({ error: "Your supervisor profile could not be found." }, { status: 404 });
  }

  // Only the student's own accepted supervisor may decide on their proposal.
  const link = await prisma.matchRequest.findUnique({
    where: { studentId_supervisorId: { studentId: proposal.studentId, supervisorId: supervisorProfile.id } },
  });
  if (!link || link.status !== RequestStatus.ACCEPTED) {
    return NextResponse.json({ error: "You are not this student's accepted supervisor." }, { status: 403 });
  }

  const newStatus = action === "APPROVE" ? ProposalStatus.APPROVED : ProposalStatus.RETURNED;
  const event = action === "APPROVE" ? ProposalEvent.APPROVED : ProposalEvent.RETURNED;

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.thesisProposal.update({ where: { id: proposalId }, data: { status: newStatus } });
    await tx.proposalHistoryEntry.create({
      data: {
        proposalId,
        version: proposal.version,
        event,
        comment: remarks || null,
        actorId: session.sub,
      },
    });
    return saved;
  });

  return NextResponse.json({ success: true, proposal: updated });
}
