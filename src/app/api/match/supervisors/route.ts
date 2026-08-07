import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseCommaList, scoreSupervisor } from "@/lib/matching";

/**
 * Supervisor mode: a student's research keywords are matched against faculty
 * expertise profiles, current student load, and availability.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const keywords = parseCommaList(searchParams.get("keywords") ?? "");

  if (keywords.length === 0) {
    return NextResponse.json({ error: "Provide at least one research keyword." }, { status: 400 });
  }

  const [supervisors, existingRequests] = await Promise.all([
    prisma.supervisorProfile.findMany({
      where: { isAvailable: true },
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.matchRequest.findMany({
      where: { studentId: session.sub },
      select: { supervisorId: true, status: true },
    }),
  ]);

  const requestBySupervisor = new Map(existingRequests.map((r) => [r.supervisorId, r.status]));

  const ranked = supervisors
    .map((sup) => {
      const { fitScore, matchedInterests, availableSlots, isAtCapacity } = scoreSupervisor(keywords, sup);
      return {
        supervisorId: sup.id,
        name: sup.user.name,
        email: sup.user.email,
        researchInterests: sup.researchInterests,
        matchedInterests,
        fitScore,
        activeLoad: sup.activeLoad,
        maxLoad: sup.maxLoad,
        availableSlots,
        isAtCapacity,
        avgResponseDays: sup.avgResponseDays,
        requestStatus: requestBySupervisor.get(sup.id) ?? null,
      };
    })
    // Capacity/response-speed alone must never surface a supervisor whose research
    // interests don't actually overlap with the student's keywords.
    .filter((r) => r.matchedInterests.length > 0)
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, 12);

  return NextResponse.json({ matches: ranked });
}
