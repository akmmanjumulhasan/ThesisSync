import { NextResponse } from "next/server";
import { IeeePaperService } from "@/services/ieee-paper.service";
import { requireStudent } from "@/app/api/paper/options";

/**
 * Module 3 (Member 2): the student's own proposal text, on request.
 *
 * The paper page starts empty on purpose. This is what its "load from my
 * proposal" button calls, so the content only ever arrives because the student
 * asked for it.
 */
export async function GET() {
  const auth = await requireStudent();
  if (auth.error) return auth.error;

  const draft = await IeeePaperService.draft(auth.studentId);
  if (!draft) {
    return NextResponse.json({ error: "You have not started a thesis proposal yet." }, { status: 404 });
  }

  return NextResponse.json(draft, { headers: { "Cache-Control": "no-store" } });
}
