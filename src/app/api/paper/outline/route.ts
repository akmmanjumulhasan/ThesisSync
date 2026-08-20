import { NextResponse } from "next/server";
import { IEEE_SPEC } from "@/lib/ieee-layout";
import { IeeePaperService } from "@/services/ieee-paper.service";
import { readOptions, requireStudent } from "@/app/api/paper/options";

/**
 * Module 3 (Member 2): what the transpiler would produce, without producing it.
 *
 * A POST rather than a GET because the page sends whole section bodies here on
 * every keystroke-pause, and five 4,000-character fields do not fit in a query
 * string. Nothing is written, so the verb is about payload size, not effect.
 */
export async function POST(req: Request) {
  const auth = await requireStudent();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const status = await IeeePaperService.status(auth.studentId, readOptions(body));

  return NextResponse.json({ ...status, spec: IEEE_SPEC }, { headers: { "Cache-Control": "no-store" } });
}
