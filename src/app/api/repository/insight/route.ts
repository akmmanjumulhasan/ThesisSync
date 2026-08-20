import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ProposalStatus } from "@prisma/client";
import { ResearchLandscapeService } from "@/services/research.service";
import { tagFrequency, pickHeavilyCovered, pickUnderstudiedGaps, determineFieldStatus } from "@/lib/research";
import { breakdown, type Document } from "@/lib/similarity";

/**
 * University Thesis Repository (Module 3, Member 1) — "Topic Insight" panel.
 *
 * The repository's own search box only tells a student what already exists
 * with matching keywords. This answers the question that search can't: is
 * this topic already well covered — inside ThesisSync's own approved theses,
 * or in the published literature — and where does an actual gap sit.
 *
 * Deliberately built as a standalone addition rather than a shared feature:
 * it reuses the pure scoring engine from src/lib/similarity.ts (Module 2,
 * Member 3's Topic Novelty & Similarity Checker) and this feature's own
 * Research Landscape service (Module 1, Member 1) purely as read-only
 * imports. Neither of those features' routes, tables, or UI are touched, and
 * nothing here is persisted — it's a live preview, not a saved run.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { query } = await req.json();
  if (!query || typeof query !== "string" || !query.trim()) {
    return NextResponse.json({ error: "A topic or abstract is required." }, { status: 400 });
  }
  const cleanQuery = query.trim().slice(0, 500);

  const approved = await prisma.thesisProposal.findMany({
    where: { status: ProposalStatus.APPROVED },
    select: { id: true, title: true, abstract: true },
  });
  const archiveDocs: Document[] = approved.map((p) => ({ id: p.id, text: `${p.title} ${p.abstract}` }));

  // Same independent-failure handling as /api/research: Semantic Scholar and
  // OpenAlex can each fail on their own, so OpenAlex quietly takes over the
  // paper search if Semantic Scholar's shared rate limit is hit, and a
  // warning only surfaces once every option for a given piece of data is
  // exhausted.
  const warnings: string[] = [];
  const [primaryPapers, yearlyResult] = await Promise.allSettled([
    ResearchLandscapeService.searchPapers(cleanQuery),
    ResearchLandscapeService.yearlyTrend(cleanQuery),
  ]);

  let papers = primaryPapers.status === "fulfilled" ? primaryPapers.value : [];
  if (primaryPapers.status === "rejected") {
    try {
      papers = await ResearchLandscapeService.searchWorksOpenAlex(cleanQuery);
    } catch {
      warnings.push("Live paper data is temporarily unavailable — try again in a moment.");
    }
  }

  const yearlyTotals = yearlyResult.status === "fulfilled" ? yearlyResult.value : [];
  if (yearlyResult.status === "rejected") {
    warnings.push('Growth trend is temporarily unavailable — field status defaults to "active".');
  }

  const freq = tagFrequency(papers);
  const externalDocs: Document[] = papers.map((p, i) => ({ id: String(i), text: p.title }));

  return NextResponse.json({
    query: cleanQuery,
    archiveSize: archiveDocs.length,
    paperCount: papers.length,
    fieldStatus: determineFieldStatus(yearlyTotals),
    heavilyCoveredExternally: pickHeavilyCovered(freq),
    understudiedExternally: pickUnderstudiedGaps(freq),
    gap: breakdown(cleanQuery, archiveDocs, externalDocs),
    warnings,
  });
}
