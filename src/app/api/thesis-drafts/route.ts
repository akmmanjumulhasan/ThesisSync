import { NextResponse } from "next/server";
import { Prisma, RequestStatus, Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { LanguageToolService } from "@/services/languagetool.service";

/**
 * Module 3 (Member 1): Version Control & Inline Annotation (API: LanguageTool).
 *
 * A chapter belongs to exactly one student. Anyone else who can read it does
 * so because they're that student's *accepted* supervisor — checked the same
 * way the Proposal Builder checks review access (see
 * src/app/api/proposal/review/route.ts).
 */

function wordCount(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

/** True if `supervisorUserId` is the accepted supervisor of `studentId`. */
async function isAcceptedSupervisorOf(supervisorUserId: string, studentId: string): Promise<boolean> {
  const supervisorProfile = await prisma.supervisorProfile.findUnique({ where: { userId: supervisorUserId } });
  if (!supervisorProfile) return false;
  const link = await prisma.matchRequest.findUnique({
    where: { studentId_supervisorId: { studentId, supervisorId: supervisorProfile.id } },
  });
  return Boolean(link && link.status === RequestStatus.ACCEPTED);
}

/** Chapter list (own), or one chapter's full detail via ?chapterId=. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const chapterId = new URL(req.url).searchParams.get("chapterId");

  if (!chapterId) {
    if (session.role !== Role.STUDENT) {
      return NextResponse.json({ error: "Only students have their own chapters." }, { status: 403 });
    }
    const chapters = await prisma.chapterDraft.findMany({
      where: { studentId: session.sub },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 }, _count: { select: { versions: true } } },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({
      chapters: chapters.map((c) => ({
        id: c.id,
        title: c.title,
        versionCount: c._count.versions,
        latestVersion: c.versions[0]
          ? { versionNumber: c.versions[0].versionNumber, wordCount: c.versions[0].wordCount, createdAt: c.versions[0].createdAt }
          : null,
        updatedAt: c.updatedAt,
      })),
    });
  }

  const chapter = await prisma.chapterDraft.findUnique({ where: { id: chapterId } });
  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found." }, { status: 404 });
  }

  const isOwner = chapter.studentId === session.sub;
  const isSupervisor = session.role === Role.SUPERVISOR && (await isAcceptedSupervisorOf(session.sub, chapter.studentId));
  if (!isOwner && !isSupervisor) {
    return NextResponse.json({ error: "You don't have access to this chapter." }, { status: 403 });
  }

  const versions = await prisma.draftVersion.findMany({
    where: { chapterId },
    orderBy: { versionNumber: "desc" },
    include: { comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true, role: true } } } } },
  });

  return NextResponse.json({
    chapter: { id: chapter.id, title: chapter.title, studentId: chapter.studentId },
    versions: versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      content: v.content,
      wordCount: v.wordCount,
      writingCheck: v.writingCheck,
      createdAt: v.createdAt,
      comments: v.comments.map((c) => ({
        id: c.id,
        authorName: c.author.name,
        authorRole: c.author.role,
        startOffset: c.startOffset,
        endOffset: c.endOffset,
        quotedText: c.quotedText,
        body: c.body,
        resolved: c.resolved,
        createdAt: c.createdAt,
      })),
    })),
  });
}

/** Create a new chapter, or save a new version of an existing one. Both student-only. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  if (session.role !== Role.STUDENT) {
    return NextResponse.json({ error: "Only students can write thesis drafts." }, { status: 403 });
  }

  const body = await req.json();

  if (body.action === "create-chapter") {
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    if (!title) {
      return NextResponse.json({ error: "A chapter title is required." }, { status: 400 });
    }
    const existing = await prisma.chapterDraft.findUnique({
      where: { studentId_title: { studentId: session.sub, title } },
    });
    if (existing) {
      return NextResponse.json({ error: "You already have a chapter with that title." }, { status: 409 });
    }
    const chapter = await prisma.chapterDraft.create({ data: { studentId: session.sub, title } });
    return NextResponse.json({ chapter });
  }

  if (body.action === "save-version") {
    const chapterId = typeof body.chapterId === "string" ? body.chapterId : "";
    const content = typeof body.content === "string" ? body.content : "";
    if (!chapterId || !content.trim()) {
      return NextResponse.json({ error: "chapterId and non-empty content are required." }, { status: 400 });
    }

    const chapter = await prisma.chapterDraft.findUnique({ where: { id: chapterId } });
    if (!chapter || chapter.studentId !== session.sub) {
      return NextResponse.json({ error: "Chapter not found." }, { status: 404 });
    }

    const latest = await prisma.draftVersion.findFirst({
      where: { chapterId },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const nextVersion = (latest?.versionNumber ?? 0) + 1;

    // Writing-quality check is best-effort — a flaky LanguageTool call must
    // never block saving the version itself.
    const issues = await LanguageToolService.check(content);

    const version = await prisma.$transaction(async (tx) => {
      const created = await tx.draftVersion.create({
        data: {
          chapterId,
          versionNumber: nextVersion,
          content,
          wordCount: wordCount(content),
          writingCheck: issues ? ({ issues } as unknown as Prisma.InputJsonValue) : undefined,
        },
      });
      await tx.chapterDraft.update({ where: { id: chapterId }, data: { updatedAt: new Date() } });
      return created;
    });

    return NextResponse.json({ version });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

/** Toggle a comment's resolved state — its author or the chapter-owning student may do this. */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { commentId, resolved } = await req.json();
  if (typeof commentId !== "string" || typeof resolved !== "boolean") {
    return NextResponse.json({ error: "commentId and a boolean resolved are required." }, { status: 400 });
  }

  const comment = await prisma.draftComment.findUnique({
    where: { id: commentId },
    include: { version: { include: { chapter: true } } },
  });
  if (!comment) {
    return NextResponse.json({ error: "Comment not found." }, { status: 404 });
  }

  const canResolve = comment.authorId === session.sub || comment.version.chapter.studentId === session.sub;
  if (!canResolve) {
    return NextResponse.json({ error: "You can't resolve this comment." }, { status: 403 });
  }

  const updated = await prisma.draftComment.update({ where: { id: commentId }, data: { resolved } });
  return NextResponse.json({ comment: updated });
}
