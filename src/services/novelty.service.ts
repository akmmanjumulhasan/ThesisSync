import "server-only";
import { createHash } from "node:crypto";
import type { NoveltyCheckKind, SimilarityRisk } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  MEANINGFUL_SIMILARITY,
  TfIdfIndex,
  breakdown,
  cosine,
  keywordQuery,
  sharedTerms,
  surfaceForms,
  noveltyScore,
  topTerms,
  rankAgainstCorpus,
  riskFor,
  wordCount,
  type Document,
} from "@/lib/similarity";
import { searchPublishedPapers, type ExternalPaper } from "@/services/external-papers.service";

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

export interface ExternalMatch {
  title: string;
  venue: string | null;
  year: number | null;
  url: string | null;
  score: number;
  /** Why this matched, so a reader can dismiss a coincidence at a glance. */
  sharedTerms: string[];
}

export interface CheckResult {
  noveltyScore: number | null;
  topSimilarity: number;
  risk: SimilarityRisk;
  understudied: string[];
  alreadyCovered: string[];
  matches: ArchiveMatch[];
  externalMatches: ExternalMatch[];
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

/** How long a cached literature search stays authoritative. */
const CACHE_TTL_HOURS = 24;

/**
 * The same queries must score against the same papers, or the verdict moves on
 * its own.
 *
 * Scholarly APIs are not deterministic: Semantic Scholar rate-limits
 * intermittently, and the others return slightly different sets per call. That
 * alone made one proposal score 80% and then 76%. Caching by query set fixes
 * the evidence for a day, which also removes most of the load causing the rate
 * limiting.
 */
async function cachedSearch(queries: string[]) {
  const queryHash = createHash("sha256").update(queries.join("\0")).digest("hex");
  const freshAfter = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000);

  const cached = await prisma.literatureCache.findUnique({ where: { queryHash } });
  if (cached && cached.fetchedAt > freshAfter) {
    return { papers: cached.payload as unknown as ExternalPaper[], sources: cached.sources };
  }

  const fresh = await searchPublishedPapers(queries);

  // A failed search is not cached: a rate limit now should not lock in an empty
  // answer for the next twenty-four hours.
  if (fresh.papers.length > 0) {
    await prisma.literatureCache.upsert({
      where: { queryHash },
      update: {
        payload: JSON.parse(JSON.stringify(fresh.papers)),
        sources: fresh.sources,
        queries,
        fetchedAt: new Date(),
      },
      create: {
        queryHash,
        queries,
        payload: JSON.parse(JSON.stringify(fresh.papers)),
        sources: fresh.sources,
      },
    });
  }

  return fresh;
}

/**
 * How much of this idea the published literature already covers, and which
 * papers say so.
 *
 * The query sent to the literature APIs is a handful of distinctive keywords,
 * not the whole abstract. Handed a full abstract, Semantic Scholar answers 429
 * and OpenAlex returns nothing — the earlier version of this function did
 * exactly that, so the external half silently contributed zero to every score.
 *
 * Each returned paper is then scored the same way an archived thesis is —
 * TF-IDF cosine against the proposal — so "covered externally" and "covered
 * internally" mean the same thing, and every match carries a link the student
 * can open and judge for themselves.
 */
async function externalOverlap(
  title: string,
  abstract: string,
  /** Archive index, used only to pick distinctive query terms for an untitled draft. */
  termIndex?: TfIdfIndex
): Promise<{
  count: number;
  matches: ExternalMatch[];
  documents: Document[];
  note: string | null;
}> {
  /**
   * Three query formulations, run against every index at once.
   *
   * The precise keyword query finds papers matching this exact idea; the broad
   * one finds the field around it; the raw title catches work phrased the way
   * the student phrased it. Any one alone is a biased sample — using only the
   * broad query once had the checker calling "arrhythmia" an understudied angle
   * while holding twenty federated-learning papers, none about arrhythmia.
   */
  const hasTitle = title.trim().length > 0;

  // A chapter arrives without a title, so its query comes from the terms it
  // uses most rather than the ones it happens to open with.
  const precise = hasTitle ? keywordQuery(title, abstract) : topTerms(abstract, 6, termIndex);
  const broad = hasTitle ? keywordQuery(title, "", 3) : topTerms(abstract, 3, termIndex);
  const queries = [...new Set([precise, broad, hasTitle ? title.trim() : ""].filter(Boolean))].sort();

  const { papers, sources } = await cachedSearch(queries);
  const query = queries.join('" + "');

  if (papers.length === 0) {
    return {
      count: 0,
      matches: [],
      documents: [],
      note: `No published papers came back for "${query}", so this reflects the university archive only.`,
    };
  }

  const documents: Document[] = papers.map((p, i) => ({
    id: `paper-${i}`,
    text: `${p.title} ${p.title} ${p.abstract ?? ""}`,
  }));

  const index = new TfIdfIndex(documents);
  const queryVector = index.vectorFor(`${title} ${abstract}`);

  const surfaces = surfaceForms(`${title} ${abstract}`);

  const scored = papers
    .map((paper, i) => {
      const paperVector = index.vectorOf(`paper-${i}`)!;
      return {
        title: paper.title,
        venue: paper.venue,
        year: paper.year,
        url: paper.url,
        score: Math.round(cosine(queryVector, paperVector) * 100),
        sharedTerms: sharedTerms(queryVector, paperVector).map((t) => surfaces.get(t) ?? t),
      };
    })
    // Two filters, not one. The score floor removes weak overlap; the shared-term
    // rule removes overlap that rests on a single word — a caption containing
    // "module" scored 14% against a document that used the word throughout, and
    // no reader would call that a match.
    .filter((p) => p.score >= MEANINGFUL_SIMILARITY && p.sharedTerms.length >= 2)
    .sort((a, b) => b.score - a.score);

  return {
    count: papers.length,
    matches: scored.slice(0, 5),
    // Handed back so the breakdown can judge coverage against the literature
    // rather than against the archive alone.
    documents,
    note: `Searched ${sources.join(", ")} and compared against ${papers.length} published papers.`,
  };
}

/** Scores a proposed title and abstract, or an uploaded chapter draft. */
export async function runCheck(
  text: string,
  options: {
    includeExternal: boolean;
    /** Drafts search the literature but report duplication, not novelty. */
    reportNovelty?: boolean;
    title?: string;
    abstract?: string;
  }
): Promise<CheckResult> {
  const reportNovelty = options.reportNovelty ?? options.includeExternal;
  const { theses, documents } = await loadCorpus();

  // Built before the literature search so it can weigh which of a draft's terms
  // are distinctive enough to search on.
  const index = documents.length > 0 ? new TfIdfIndex(documents) : undefined;

  // The external half is independent of the archive, so an empty archive still
  // produces a real answer rather than an apology.
  const external = options.includeExternal
    // Title stays empty for an untitled draft. Falling back to the full text
    // here sent an entire chapter as a search query, which is exactly what the
    // APIs reject.
    ? await externalOverlap(options.title ?? "", options.abstract ?? text, index)
    : { count: 0, matches: [] as ExternalMatch[], documents: [] as Document[], note: null };

  if (documents.length === 0) {
    return {
      noveltyScore: reportNovelty ? noveltyScore([], external.matches) : null,
      topSimilarity: 0,
      risk: "LOW",
      understudied: [],
      alreadyCovered: [],
      matches: [],
      externalMatches: external.matches,
      archiveSize: 0,
      externalSize: external.count,
      wordCount: wordCount(text),
      externalNote:
        "No theses are archived yet, so this reflects published literature only." +
        (external.note ? ` ${external.note}` : ""),
    };
  }

  const ranked = rankAgainstCorpus(index!, text, documents);
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

  const { understudied, alreadyCovered } = breakdown(text, documents, external.documents);

  // topSimilarity stays the true best score, even when it is too low to list —
  // the risk badge should say "10%, low risk" rather than claim a clean 0%.
  const topSimilarity = matches[0]?.score ?? 0;
  const reportable = matches.filter((m) => m.score >= MEANINGFUL_SIMILARITY);

  return {
    noveltyScore: reportNovelty ? noveltyScore(ranked, external.matches) : null,
    topSimilarity,
    risk: riskFor(topSimilarity),
    understudied,
    alreadyCovered,
    matches: reportable,
    externalMatches: external.matches,
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
      // Prisma's Json input type does not accept a typed array directly.
      externalMatches: JSON.parse(JSON.stringify(result.externalMatches)),
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
