import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { transitionChapter } from "@/services/chapter.service";
import { TRANSITIONS, type ChapterAction } from "@/lib/chapters";

const ACTIONS = new Set<string>(TRANSITIONS.map((t) => t.action));

/**
 * Module 3 (Member 3): Chapter Approval Workflow — the single door every stage
 * change goes through.
 *
 * Both roles post here and the pipeline table decides what each may do, rather
 * than the student and supervisor having separate endpoints that could drift
 * apart in what they permit. The audit row is written by the same transaction
 * that moves the chapter, so an approval can never exist without a record of
 * who made it.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const body = await req.json();
  const { chapterId, action } = body;

  if (typeof chapterId !== "string" || !chapterId) {
    return NextResponse.json({ error: "chapterId is required." }, { status: 400 });
  }
  if (typeof action !== "string" || !ACTIONS.has(action)) {
    return NextResponse.json({ error: "A valid action is required." }, { status: 400 });
  }

  const result = await transitionChapter(chapterId, action as ChapterAction, typeof body.comment === "string" ? body.comment : "", {
    id: session.sub,
    name: session.name,
    role: session.role,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ success: true });
}
