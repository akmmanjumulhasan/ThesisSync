import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { supervises } from "@/services/chapter.service";

/**
 * Module 3 (Member 3): the supervisor sets a chapter's due date.
 *
 * Deadlines belong to the supervisor, not the student. A student who could move
 * their own deadline has not got a deadline, and the reminder built on top of
 * it would mean nothing.
 *
 * Setting or changing dueAt clears deadlineNotifiedAt, which is what re-arms
 * the reminder — otherwise a chapter pushed back by a week would stay silent
 * because it had already been warned about under its old date.
 */
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  if (session.role !== Role.SUPERVISOR) {
    return NextResponse.json({ error: "Only a supervisor can set a chapter deadline." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.chapterId !== "string" || !body.chapterId) {
    return NextResponse.json({ error: "chapterId is required." }, { status: 400 });
  }

  const chapter = await prisma.thesisChapter.findUnique({
    where: { id: body.chapterId },
    select: { id: true, studentId: true },
  });
  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found." }, { status: 404 });
  }
  if (!(await supervises(session.sub, chapter.studentId))) {
    return NextResponse.json({ error: "You are not this student's accepted supervisor." }, { status: 403 });
  }

  // null clears the deadline. Anything unparseable is rejected rather than
  // silently becoming "no deadline", which would look identical in the UI.
  let dueAt: Date | null = null;
  if (body.dueAt !== null && body.dueAt !== undefined && body.dueAt !== "") {
    if (typeof body.dueAt !== "string") {
      return NextResponse.json({ error: "dueAt must be a date string, or null to clear it." }, { status: 400 });
    }
    const parsed = new Date(body.dueAt);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "That is not a valid date." }, { status: 400 });
    }
    dueAt = parsed;
  }

  const updated = await prisma.thesisChapter.update({
    where: { id: chapter.id },
    data: { dueAt, deadlineNotifiedAt: null },
    select: { id: true, dueAt: true },
  });

  return NextResponse.json({ success: true, dueAt: updated.dueAt?.toISOString() ?? null });
}
