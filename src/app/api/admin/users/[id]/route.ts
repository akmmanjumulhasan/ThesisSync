import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Role, AdminAction } from "@prisma/client";

/**
 * Common workflow: Admin role & access management.
 * Changes a user's role and/or active status. The only two mutating actions
 * "access management" actually means, beyond an audited trail of who did it.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const nextRole: Role | undefined = body.role && Object.values(Role).includes(body.role) ? body.role : undefined;
  const nextActive: boolean | undefined = typeof body.isActive === "boolean" ? body.isActive : undefined;

  if (nextRole === undefined && nextActive === undefined) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  // An admin locking themselves out has no recovery path in this app (no
  // "second admin" prompt, no email reset flow yet) — refuse outright rather
  // than let it happen by mis-click.
  const targetsSelf = target.id === session.sub;
  if (targetsSelf && ((nextRole && nextRole !== Role.ADMIN) || nextActive === false)) {
    return NextResponse.json({ error: "You can't remove your own admin access." }, { status: 400 });
  }

  // Guard against leaving the platform with zero admins some other way —
  // demoting or deactivating the last remaining one.
  const losingAdminStatus = target.role === Role.ADMIN && ((nextRole && nextRole !== Role.ADMIN) || nextActive === false);
  if (losingAdminStatus) {
    const otherActiveAdmins = await prisma.user.count({
      where: { role: Role.ADMIN, isActive: true, id: { not: target.id } },
    });
    if (otherActiveAdmins === 0) {
      return NextResponse.json({ error: "Can't remove the last active administrator." }, { status: 400 });
    }
  }

  const changes: { field: string; from: string; to: string }[] = [];
  if (nextRole && nextRole !== target.role) changes.push({ field: "role", from: target.role, to: nextRole });
  if (nextActive !== undefined && nextActive !== target.isActive) {
    changes.push({ field: "isActive", from: String(target.isActive), to: String(nextActive) });
  }

  if (changes.length === 0) {
    return NextResponse.json({ user: target, changed: false });
  }

  const [updated] = await prisma.$transaction([
    prisma.user.update({
      where: { id },
      data: {
        ...(nextRole ? { role: nextRole } : {}),
        ...(nextActive !== undefined ? { isActive: nextActive } : {}),
      },
    }),
    ...changes.map((c) =>
      prisma.adminAuditLog.create({
        data: {
          actorId: session.sub,
          targetId: id,
          action:
            c.field === "role" ? AdminAction.ROLE_CHANGED : c.to === "true" ? AdminAction.ACTIVATED : AdminAction.DEACTIVATED,
          detail: c.field === "role" ? `${c.from} -> ${c.to}` : c.to === "true" ? "Reactivated the account" : "Deactivated the account",
        },
      })
    ),
  ]);

  return NextResponse.json({
    user: { id: updated.id, name: updated.name, role: updated.role, isActive: updated.isActive },
    changed: true,
  });
}
