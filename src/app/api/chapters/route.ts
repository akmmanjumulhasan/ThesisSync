import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { chapterGate, createChapter, deleteChapter, listChapters, saveChapter } from "@/services/chapter.service";

/**
 * Module 3 (Member 3): Chapter Approval Workflow — the student's own chapters.
 *
 * Everything here is authored-side: creating a chapter, editing a draft, and
 * removing one that never entered the pipeline. Nothing in this file changes a
 * chapter's status; that is POST /api/chapters/transition, without exception.
 */

/** Every chapter of the signed-in student's thesis, with its audit trail. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  if (session.role !== Role.STUDENT) {
    return NextResponse.json({ error: "Only students have thesis chapters." }, { status: 403 });
  }

  const [chapters, gate] = await Promise.all([listChapters(session.sub), chapterGate(session.sub)]);
  return NextResponse.json({ chapters, gate });
}

/** Add a chapter to the end of the thesis. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  if (session.role !== Role.STUDENT) {
    return NextResponse.json({ error: "Only students can add thesis chapters." }, { status: 403 });
  }

  const gate = await chapterGate(session.sub);
  if (!gate.open) {
    return NextResponse.json({ error: gate.reason }, { status: 403 });
  }

  const body = await req.json();
  const result = await createChapter(session.sub, typeof body.title === "string" ? body.title : "", session.name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ chapters: await listChapters(session.sub) }, { status: 201 });
}

/** Save edits to a draft chapter. */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  if (session.role !== Role.STUDENT) {
    return NextResponse.json({ error: "Only students can edit thesis chapters." }, { status: 403 });
  }

  const body = await req.json();
  if (typeof body.chapterId !== "string" || !body.chapterId) {
    return NextResponse.json({ error: "chapterId is required." }, { status: 400 });
  }

  const result = await saveChapter(session.sub, body.chapterId, body.title, body.content);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ chapters: await listChapters(session.sub) });
}

/** Remove a chapter that has never been submitted. */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  if (session.role !== Role.STUDENT) {
    return NextResponse.json({ error: "Only students can remove thesis chapters." }, { status: 403 });
  }

  const body = await req.json();
  if (typeof body.chapterId !== "string" || !body.chapterId) {
    return NextResponse.json({ error: "chapterId is required." }, { status: 400 });
  }

  const result = await deleteChapter(session.sub, body.chapterId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ chapters: await listChapters(session.sub) });
}
