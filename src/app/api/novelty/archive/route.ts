import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { searchDissertations } from "@/services/external-papers.service";

/**
 * Module 2 (Member 3): populating the archive the checker scores against.
 *
 * Until the University Thesis Repository (Module 3, Member 1) holds deposited
 * theses, this imports real dissertations from OpenAlex for a topic. Every row
 * keeps its DOI and landing page, so a similarity match always points at a
 * document that exists and can be opened — an invented corpus would produce
 * confident percentages against theses nobody could ever read.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { topic } = await req.json();
  if (typeof topic !== "string" || topic.trim().length < 3) {
    return NextResponse.json({ error: "Give a topic to import theses for." }, { status: 400 });
  }

  const dissertations = await searchDissertations(topic.trim(), 25);
  if (dissertations.length === 0) {
    return NextResponse.json(
      { error: `No dissertations came back for "${topic.trim()}". Try a broader topic.` },
      { status: 404 }
    );
  }

  let imported = 0;
  let skipped = 0;

  for (const d of dissertations) {
    // An abstract is what the similarity engine actually scores, so a record
    // without one would sit in the corpus contributing nothing but noise.
    if (!d.abstract || d.abstract.length < 120) {
      skipped += 1;
      continue;
    }

    const existing = await prisma.archivedThesis.findFirst({
      where: d.doi ? { doi: d.doi } : { title: d.title },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    await prisma.archivedThesis.create({
      data: {
        title: d.title,
        abstract: d.abstract,
        department: d.venue ?? "External",
        year: d.year ?? new Date().getFullYear(),
        source: "OPENALEX",
        sourceUrl: d.url,
        doi: d.doi,
      },
    });
    imported += 1;
  }

  return NextResponse.json({
    success: true,
    imported,
    skipped,
    total: await prisma.archivedThesis.count(),
  });
}
