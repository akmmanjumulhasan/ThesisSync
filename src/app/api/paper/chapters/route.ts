import { NextResponse } from "next/server";
import { IeeePaperService } from "@/services/ieee-paper.service";
import { requireStudent } from "@/app/api/paper/options";

/**
 * Module 3 (Member 2): the paper's body, from the student's locked chapters.
 *
 * This is the source a conference paper should actually have — finished work,
 * signed off and committed to the thesis, including the results a proposal
 * cannot contain. Backs the page's "load from my chapters" button.
 */
export async function GET() {
  const auth = await requireStudent();
  if (auth.error) return auth.error;

  const body = await IeeePaperService.chapterBodies(auth.studentId);
  if (body.chapters.length === 0) {
    return NextResponse.json(
      {
        error:
          "None of your chapters are locked yet. Ask your supervisor to lock the chapters you want the paper built from.",
      },
      { status: 404 }
    );
  }

  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
