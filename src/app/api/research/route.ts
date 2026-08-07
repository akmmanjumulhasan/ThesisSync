import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ResearchLandscapeService } from "@/services/research.service";
import {
  tagFrequency,
  pickHeavilyCovered,
  pickUnderstudiedGaps,
  bucketMonthlyCoverage,
  determineFieldStatus,
  pickRecentPapers,
} from "@/lib/research";

/**
 * Research Landscape & Trend Analyzer: a student submits a topic, this maps
 * what's already published (Semantic Scholar) and whether the field is
 * growing or saturating (OpenAlex), and saves the run to their history.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { topic } = await req.json();
  if (!topic || typeof topic !== "string" || !topic.trim()) {
    return NextResponse.json({ error: "A topic or abstract is required." }, { status: 400 });
  }
  const cleanTopic = topic.trim().slice(0, 500);

  // Each source can fail independently (rate limits, transient outages). Semantic
  // Scholar and OpenAlex both return the same paper shape, so if Semantic Scholar's
  // shared rate limit is hit, OpenAlex's works search quietly takes over instead —
  // the student never has to know which one actually answered. A warning only
  // surfaces if every option for that piece of data is exhausted.
  const warnings: string[] = [];

  const [primaryPapers, yearlyResult] = await Promise.allSettled([
    ResearchLandscapeService.searchPapers(cleanTopic),
    ResearchLandscapeService.yearlyTrend(cleanTopic),
  ]);

  let papers = primaryPapers.status === "fulfilled" ? primaryPapers.value : [];
  if (primaryPapers.status === "rejected") {
    try {
      papers = await ResearchLandscapeService.searchWorksOpenAlex(cleanTopic);
    } catch {
      warnings.push("Live paper data is temporarily unavailable — try again in a moment.");
    }
  }

  const yearlyTotals = yearlyResult.status === "fulfilled" ? yearlyResult.value : [];
  if (yearlyResult.status === "rejected") {
    warnings.push("Growth trend is temporarily unavailable — field status defaults to \"active\".");
  }

  if (papers.length === 0 && yearlyTotals.length === 0) {
    return NextResponse.json(
      { error: "Semantic Scholar and OpenAlex were both unreachable. Try again in a moment." },
      { status: 502 }
    );
  }

  const freq = tagFrequency(papers);
  const heavilyCovered = pickHeavilyCovered(freq);
  const understudiedGaps = pickUnderstudiedGaps(freq);
  const monthlyCoverage = bucketMonthlyCoverage(papers);
  const fieldStatus = determineFieldStatus(yearlyTotals);
  const recentPapers = pickRecentPapers(papers);

  const savedQuery = await prisma.researchQuery.create({
    data: {
      userId: session.sub,
      topic: cleanTopic,
      heavilyCovered,
      understudiedGaps,
      fieldStatus,
    },
  });

  return NextResponse.json({
    queryId: savedQuery.id,
    topic: cleanTopic,
    heavilyCovered,
    understudiedGaps,
    monthlyCoverage,
    fieldStatus,
    yearlyTotals,
    recentPapers,
    paperCount: papers.length,
    warnings,
  });
}

/** Recent runs for the signed-in student, most recent first. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const history = await prisma.researchQuery.findMany({
    where: { userId: session.sub },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return NextResponse.json({ history });
}
