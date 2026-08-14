import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { runCheck, saveCheck } from "@/services/novelty.service";

/**
 * Module 2 (Member 3): Topic Novelty & Similarity Checker — the idea stage.
 *
 * A proposed title and abstract, cross-checked against the university archive
 * and recent external papers, returning the understudied-versus-covered
 * breakdown the spec calls for.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { title, abstract } = await req.json();

  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "A proposed title is required." }, { status: 400 });
  }
  // Scoring a one-line abstract produces a confident number from almost no
  // evidence, which is worse than refusing — a student would act on it.
  if (typeof abstract !== "string" || abstract.trim().split(/\s+/).length < 15) {
    return NextResponse.json(
      { error: "Give at least 15 words of abstract — a shorter one cannot be scored meaningfully." },
      { status: 400 }
    );
  }

  const result = await runCheck(`${title} ${abstract}`, { includeExternal: true });
  await saveCheck(session.sub, "TITLE_ABSTRACT", result, {
    title: title.trim().slice(0, 300),
    abstract: abstract.trim().slice(0, 5000),
  });

  return NextResponse.json(result);
}

/** Previous runs, newest first, so a student can see how the idea has moved. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const checks = await prisma.noveltyCheck.findMany({
    where: { userId: session.sub },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      kind: true,
      title: true,
      sourceName: true,
      noveltyScore: true,
      topSimilarity: true,
      risk: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ checks });
}
