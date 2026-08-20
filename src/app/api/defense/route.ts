import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { DefenseService } from "@/services/defense.service";
import type { Depth } from "@/lib/defense";

/**
 * Module 3 (Member 2): AI Mock Defense Simulator.
 *
 * GET returns the student's current session; POST convenes a new one, which
 * means reading the thesis and writing the questions before anything is shown.
 */

/** Reading a thesis and writing questions is two model passes; give it room. */
export const maxDuration = 120;

async function requireStudent() {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: "You must be signed in." }, { status: 401 }) };
  }
  if (session.role !== Role.STUDENT) {
    return {
      error: NextResponse.json(
        { error: "The mock defense is available to student accounts." },
        { status: 403 }
      ),
    };
  }
  return { studentId: session.sub };
}

export async function GET() {
  const auth = await requireStudent();
  if (auth.error) return auth.error;

  const state = await DefenseService.state(auth.studentId);
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const auth = await requireStudent();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const depth: Depth = body?.depth === "thorough" ? "thorough" : "focused";

  try {
    const session = await DefenseService.start(auth.studentId, depth);
    return NextResponse.json(session, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // The examiner failing to convene is worth telling the student about
    // plainly — a silent empty panel looks like the feature is broken.
    const message = error instanceof Error ? error.message : "The examiner could not be reached.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
