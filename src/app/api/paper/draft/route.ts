import { NextResponse } from "next/server";
import { IeeePaperService } from "@/services/ieee-paper.service";
import { requireStudent } from "@/app/api/paper/options";

/**
 * Module 3 (Member 2): the paper's title and abstract, from the proposal.
 *
 * Only those two. The proposal's remaining prose describes intended work and
 * has no place in a paper reporting finished work — the body comes from locked
 * chapters instead, via /api/paper/chapters.
 *
 * The paper page starts empty on purpose. This is what its "load title &
 * abstract" button calls, so the text only ever arrives because the student
 * asked for it.
 */
export async function GET() {
  const auth = await requireStudent();
  if (auth.error) return auth.error;

  const identity = await IeeePaperService.identity(auth.studentId);
  if (!identity) {
    return NextResponse.json({ error: "You have not started a thesis proposal yet." }, { status: 404 });
  }

  return NextResponse.json(identity, { headers: { "Cache-Control": "no-store" } });
}
