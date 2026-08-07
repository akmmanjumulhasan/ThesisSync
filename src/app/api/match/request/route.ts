import { NextResponse } from "next/server";
import { RequestStatus, Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/** Supervisor mode: the student sends a supervision request directly from the ranked list. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== Role.STUDENT) {
    return NextResponse.json({ error: "Only students can send supervision requests." }, { status: 403 });
  }

  const { supervisorId } = await req.json();
  if (!supervisorId) {
    return NextResponse.json({ error: "supervisorId is required." }, { status: 400 });
  }

  const supervisor = await prisma.supervisorProfile.findUnique({ where: { id: supervisorId } });
  if (!supervisor) {
    return NextResponse.json({ error: "Supervisor not found." }, { status: 404 });
  }
  if (supervisor.activeLoad >= supervisor.maxLoad) {
    return NextResponse.json({ error: "This supervisor is at capacity." }, { status: 409 });
  }

  const matchRequest = await prisma.matchRequest.upsert({
    where: { studentId_supervisorId: { studentId: session.sub, supervisorId } },
    update: { status: RequestStatus.PENDING },
    create: { studentId: session.sub, supervisorId, status: RequestStatus.PENDING },
  });

  return NextResponse.json({ success: true, request: matchRequest });
}

/** Supervisor accepts or declines a pending request; accepting increments their active load. */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session || session.role !== Role.SUPERVISOR) {
    return NextResponse.json({ error: "Only supervisors can respond to requests." }, { status: 403 });
  }

  const { requestId, action } = await req.json();
  if (!requestId || (action !== "ACCEPT" && action !== "DECLINE")) {
    return NextResponse.json({ error: "requestId and a valid action are required." }, { status: 400 });
  }

  const existing = await prisma.matchRequest.findUnique({
    where: { id: requestId },
    include: { supervisor: true },
  });
  if (!existing || existing.supervisor.userId !== session.sub) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  const newStatus = action === "ACCEPT" ? RequestStatus.ACCEPTED : RequestStatus.DECLINED;

  const updated = await prisma.$transaction(async (tx) => {
    const updatedRequest = await tx.matchRequest.update({
      where: { id: requestId },
      data: { status: newStatus },
    });
    if (newStatus === RequestStatus.ACCEPTED) {
      await tx.supervisorProfile.update({
        where: { id: existing.supervisorId },
        data: { activeLoad: { increment: 1 } },
      });
    }
    return updatedRequest;
  });

  return NextResponse.json({ success: true, request: updated });
}
