import { NextResponse } from "next/server";
import { IeeePaperService } from "@/services/ieee-paper.service";
import { readOptions, requireStudent } from "@/app/api/paper/options";

/**
 * Module 3 (Member 2): IEEE Conference Paper Transpiler — the compiled PDF.
 *
 * The outline that previews this lives at /api/paper/outline.
 */
export async function POST(req: Request) {
  const auth = await requireStudent();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const result = await IeeePaperService.render(auth.studentId, readOptions(body));

  if (!result) {
    // The service refuses on the same gate the UI already shows, so the reason
    // is repeated here rather than returning a bare 403 to a direct caller.
    return NextResponse.json(
      { error: "Only an approved proposal with a title can be transpiled into an IEEE paper." },
      { status: 409 }
    );
  }

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
      "Content-Length": String(result.buffer.length),
      "X-Page-Count": String(result.pageCount),
      // The paper changes whenever its inputs do, so a cached copy is always a
      // risk of handing back a stale draft.
      "Cache-Control": "no-store",
    },
  });
}
