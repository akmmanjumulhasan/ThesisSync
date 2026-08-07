import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseCommaList } from "@/lib/matching";

/** A supervisor updating their own expertise, capacity, and availability. */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "SUPERVISOR") {
    return NextResponse.json({ error: "Only supervisors can update this." }, { status: 403 });
  }

  const body = await req.json();
  const interests = Array.isArray(body.researchInterests)
    ? body.researchInterests.map((s: unknown) => String(s).trim()).filter(Boolean)
    : parseCommaList(String(body.researchInterests ?? ""));

  if (interests.length === 0) {
    return NextResponse.json({ error: "Add at least one area of expertise." }, { status: 400 });
  }

  const maxLoad = Number(body.maxLoad);
  if (!Number.isFinite(maxLoad) || maxLoad < 0) {
    return NextResponse.json({ error: "Capacity must be a non-negative number." }, { status: 400 });
  }

  const profile = await prisma.supervisorProfile.update({
    where: { userId: session.sub },
    data: {
      researchInterests: interests,
      maxLoad,
      isAvailable: Boolean(body.isAvailable),
    },
  });

  return NextResponse.json({ success: true, profile });
}
