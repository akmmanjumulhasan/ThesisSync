import "server-only";
import type { NoveltyCheckKind, SimilarityRisk } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  TfIdfIndex,
  breakdown,
  cosine,
  noveltyScore,
  rankAgainstCorpus,
  riskFor,
  wordCount,
  type Document,
} from "@/lib/similarity";
import { ResearchLandscapeService } from "@/services/research.service";

/**
 * Module 2 (Member 3): Topic Novelty & Similarity Checker — orchestration.
 *
 * Holds the two things the pure scoring library deliberately does not: reading
 * the archive out of the database, and reaching Semantic Scholar for the
 * "recent external papers" half of the check.
 */

export interface ArchiveMatch {
  thesisId: string;
  title: string;
  department: string;
  year: number;
  score: number;
  sharedTerms: string[];
}

export interface CheckResult {
  noveltyScore: number | null;
  topSimilarity: number;
  risk: SimilarityRisk;
  understudied: string[];
  alreadyCovered: string[];
  matches: ArchiveMatch[];
  archiveSize: number;
  externalSize: number;
  wordCount: number;
  /** Non-fatal note when the external half could not be reached. */
  externalNote: string | null;
}

/** The whole archive, as scoreable documents. */
async function loadCorpus() {
  const theses = await prisma.archivedThesis.findMany({
    select: { id: true, title: true, abstract: true, content: true, department: true, year: true },
  });

  const documents: Document[] = theses.map((t) => ({
    id: t.id,
    // Title carries the most concentrated signal, so it is weighted by
    // repetition rather than by a separate coefficient — the TF-IDF weighting
    // then handles it without a second scoring path.
    text: `${t.title} ${t.title} ${t.abstract} ${t.content ?? ""}`,
  }));

  return { theses, documents };
}

/**
 * How much of this idea the outside literature already covers.
 *
 * Scored the same way as the archive — TF-IDF cosine over recent paper titles —
 * so "already covered externally" means the same thing as "already covered
 * internally" rather than being a second, incomparable metric.
 */
async function externalOverlap(query: string): Promise<{ overlap: number; count: number; note: string | null }> {
  try {
    const papers = await ResearchLandscapeService.searchPapers(query, 25);
    if (papers.length === 0) return { overlap: 0, count: 0, note: null };

    const documents: Document[] = papers.map((p, i) => ({
      id: `paper-${i}`,
      text: `${p.title} ${p.fieldsOfStudy.join(" ")}`,
    }));

    const index = new TfIdfIndex(documents);
    const queryVector = index.vectorFor(query);
    const scores = documents
      .map((d) => cosine(queryVector, index.vectorOf(d.id)!))
      .sort((a, b) => b - a);

    // Mean of the three closest papers: one loosely-matching title should not
    // read as the field having covered this already.
    const top3 = scores.slice(0, 3);
    const overlap = top3.length ? (top3.reduce((s, v) => s + v, 0) / top3.length) * 100 : 0;

    return { overlap: Math.round(overlap), count: papers.length, note: null };
  } catch {
    // Semantic Scholar rate-limits anonymous callers. The archive half is the
    // part the university actually owns, so a failure here degrades the result
    // rather than failing the check.
    return {
      overlap: 0,
      count: 0,
      note: "Recent external papers could not be reached, so this score reflects the university archive only.",
    };
  }
}

/** Scores a proposed title and abstract, or an uploaded chapter draft. */
export async function runCheck(text: string, options: { includeExternal: boolean }): Promise<CheckResult> {
  const { theses, documents } = await loadCorpus();

  if (documents.length === 0) {
    return {
      noveltyScore: null,
      topSimilarity: 0,
      risk: "LOW",
      understudied: [],
      alreadyCovered: [],
      matches: [],
      archiveSize: 0,
      externalSize: 0,
      wordCount: wordCount(text),
      externalNote: "The thesis archive is empty, so there is nothing to compare against yet.",
    };
  }

  const index = new TfIdfIndex(documents);
  const ranked = rankAgainstCorpus(index, text, documents);
  const byId = new Map(theses.map((t) => [t.id, t]));

  const matches: ArchiveMatch[] = ranked.map((m) => {
    const thesis = byId.get(m.id)!;
    return {
      thesisId: thesis.id,
      title: thesis.title,
      department: thesis.department,
      year: thesis.year,
      score: m.score,
      sharedTerms: m.sharedTerms,
    };
  });

  const external = options.includeExternal
    ? await externalOverlap(text)
    : { overlap: 0, count: 0, note: null };

  const { understudied, alreadyCovered } = breakdown(text, documents);
  const topSimilarity = matches[0]?.score ?? 0;

  return {
    noveltyScore: options.includeExternal ? noveltyScore(ranked, external.overlap) : null,
    topSimilarity,
    risk: riskFor(topSimilarity),
    understudied,
    alreadyCovered,
    matches,
    archiveSize: documents.length,
    externalSize: external.count,
    wordCount: wordCount(text),
    externalNote: external.note,
  };
}

/** Persists a run and its matches so the student and supervisor keep the trail. */
export async function saveCheck(
  userId: string,
  kind: NoveltyCheckKind,
  result: CheckResult,
  fields: { title?: string; abstract?: string; sourceName?: string }
) {
  return prisma.noveltyCheck.create({
    data: {
      userId,
      kind,
      title: fields.title ?? null,
      abstract: fields.abstract ?? null,
      sourceName: fields.sourceName ?? null,
      wordCount: result.wordCount,
      noveltyScore: result.noveltyScore,
      topSimilarity: result.topSimilarity,
      risk: result.risk,
      understudied: result.understudied,
      alreadyCovered: result.alreadyCovered,
      archiveSize: result.archiveSize,
      externalSize: result.externalSize,
      matches: {
        create: result.matches.map((m) => ({
          thesisId: m.thesisId,
          score: m.score,
          sharedTerms: m.sharedTerms,
        })),
      },
    },
  });
}
