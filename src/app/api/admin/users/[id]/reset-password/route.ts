import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { hashPassword } from "@/lib/auth";
import { generateTempPassword } from "@/lib/admin";
import { AdminAction } from "@prisma/client";

/**
 * Common workflow: Admin role & access management.
 *
 * Issues a one-time temporary password for a locked-out user. There's no
 * email/SMS delivery yet (Smart Notification System, Module 3/Member 3, is
 * still unbuilt), so the temporary password is returned in this response
 * once, for the admin to relay to the user directly — it is never stored or
 * shown again after this call.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const { id } = await params;
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const temporaryPassword = generateTempPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { passwordHash } }),
    prisma.adminAuditLog.create({
      data: {
        actorId: session.sub,
        targetId: id,
        action: AdminAction.PASSWORD_RESET,
        detail: "Issued a temporary password",
      },
    }),
  ]);

  return NextResponse.json({ temporaryPassword });
}
