import "server-only";

/**
 * Module 2 (Member 3): the published literature the novelty checker compares
 * against.
 *
 * Two sources, deliberately. Semantic Scholar has the better coverage of
 * computer science but rate-limits anonymous callers hard; OpenAlex is open,
 * needs no key, and indexes dissertations specifically. Trying Semantic Scholar
 * first and falling back to OpenAlex means a rate limit degrades the source
 * rather than the feature.
 *
 * Everything returned here is a real, citable record with a link. A match the
 * student cannot go and read is worse than no match at all — they have no way
 * to judge whether it truly overlaps their idea.
 */

const SEMANTIC_SCHOLAR = "https://api.semanticscholar.org/graph/v1/paper/search";
const OPENALEX = "https://api.openalex.org/works";

export interface ExternalPaper {
  title: string;
  venue: string | null;
  year: number | null;
  url: string | null;
  doi: string | null;
  abstract: string | null;
  source: "Semantic Scholar" | "OpenAlex" | "Crossref";
}

function semanticScholarHeaders(): HeadersInit {
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY;
  return key ? { "x-api-key": key } : {};
}

function openAlexMailto(): string {
  const mailto = process.env.OPENALEX_MAILTO;
  return mailto ? `&mailto=${encodeURIComponent(mailto)}` : "";
}

/**
 * OpenAlex stores abstracts as an inverted index (word -> positions) rather
 * than as text, so it has to be rebuilt before it can be scored.
 */
function rebuildAbstract(inverted: Record<string, number[]> | null | undefined): string | null {
  if (!inverted) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const position of positions) words[position] = word;
  }
  const text = words.filter(Boolean).join(" ").trim();
  return text || null;
}

async function fromSemanticScholar(query: string, limit: number): Promise<ExternalPaper[]> {
  const url = `${SEMANTIC_SCHOLAR}?query=${encodeURIComponent(query)}&limit=${limit}&fields=title,abstract,year,venue,url,externalIds`;
  const res = await fetch(url, { headers: semanticScholarHeaders() });

  // 429 is the normal response for an unkeyed caller under load. Treated as
  // "this source is unavailable right now", not as an error worth failing on.
  if (!res.ok) return [];

  const body = await res.json();
  const data = (body.data ?? []) as Array<{
    title: string;
    abstract: string | null;
    year: number | null;
    venue: string | null;
    url: string | null;
    externalIds?: { DOI?: string };
  }>;

  return data
    .filter((p) => p.title && isRealPublication(p.title))
    .map((p) => ({
      title: p.title,
      venue: p.venue || null,
      year: p.year ?? null,
      url: p.url ?? (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : null),
      doi: p.externalIds?.DOI ?? null,
      abstract: p.abstract ?? null,
      source: "Semantic Scholar" as const,
    }));
}

async function fromOpenAlex(query: string, limit: number, dissertationsOnly = false): Promise<ExternalPaper[]> {
  const filters = [`default.search:${query}`];
  if (dissertationsOnly) filters.unshift("type:dissertation");

  const url = `${OPENALEX}?filter=${encodeURIComponent(filters.join(","))}&per-page=${limit}&select=title,publication_year,doi,primary_location,abstract_inverted_index${openAlexMailto()}`;
  const res = await fetch(url, { headers: { "User-Agent": "ThesisSync/1.0 (novelty checker)" } });
  if (!res.ok) return [];

  const body = await res.json();
  const results = (body.results ?? []) as Array<{
    title: string | null;
    publication_year: number | null;
    doi: string | null;
    primary_location?: { source?: { display_name?: string } | null; landing_page_url?: string | null } | null;
    abstract_inverted_index?: Record<string, number[]> | null;
  }>;

  return results
    .filter((w) => w.title && isRealPublication(w.title))
    .map((w) => ({
      title: w.title as string,
      venue: w.primary_location?.source?.display_name ?? null,
      year: w.publication_year ?? null,
      url: w.primary_location?.landing_page_url ?? (w.doi ? w.doi : null),
      doi: w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//, "") : null,
      abstract: rebuildAbstract(w.abstract_inverted_index),
      source: "OpenAlex" as const,
    }));
}

const CROSSREF = "https://api.crossref.org/works";

/**
 * Crossref registers DOIs for figures, tables, and other sub-components of a
 * paper, and they come back from a search looking like ordinary records. A
 * caption such as "Figure 2: Feature representation module." then matches any
 * document containing the word "module", which is how a thesis proposal ended
 * up matched against solar-cell gaskets.
 */
const PUBLICATION_TYPES = new Set([
  "journal-article",
  "proceedings-article",
  "book",
  "book-chapter",
  "monograph",
  "dissertation",
  "report",
  "posted-content",
  "reference-entry",
]);

/** Captions and fragments that are not standalone work, whatever their type says. */
const FRAGMENT_TITLE =
  /^\s*(figure|fig\.?|table|tab\.?|scheme|chart|plate|appendix|supplementary|supplemental|graphical abstract|equation|algorithm)/i;

function isRealPublication(title: string): boolean {
  if (FRAGMENT_TITLE.test(title)) return false;
  // A two-word title carries too little to score honestly against a chapter.
  return title.trim().split(/\s+/).length >= 3;
}

/** Crossref abstracts arrive as JATS XML. */
function stripJats(abstract: string | null | undefined): string | null {
  if (!abstract) return null;
  const text = abstract
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

async function fromCrossref(query: string, limit: number): Promise<ExternalPaper[]> {
  const mailto = process.env.CROSSREF_MAILTO;
  const polite = mailto ? `&mailto=${encodeURIComponent(mailto)}` : "";
  const url = `${CROSSREF}?query.bibliographic=${encodeURIComponent(query)}&rows=${limit}&select=title,abstract,issued,DOI,container-title,type${polite}`;

  const res = await fetch(url, { headers: { "User-Agent": "ThesisSync/1.0 (novelty checker)" } });
  if (!res.ok) return [];

  const body = await res.json();
  const items = (body.message?.items ?? []) as Array<{
    title?: string[];
    abstract?: string;
    DOI?: string;
    type?: string;
    issued?: { "date-parts"?: number[][] };
    "container-title"?: string[];
  }>;

  return items
    .filter((i) => i.title?.[0] && PUBLICATION_TYPES.has(i.type ?? "") && isRealPublication(i.title[0]))
    .map((i) => ({
      title: i.title![0],
      venue: i["container-title"]?.[0] ?? null,
      year: i.issued?.["date-parts"]?.[0]?.[0] ?? null,
      url: i.DOI ? `https://doi.org/${i.DOI}` : null,
      doi: i.DOI ?? null,
      abstract: stripJats(i.abstract),
      source: "Crossref" as const,
    }));
}

export interface PaperSearchResult {
  papers: ExternalPaper[];
  /** Every source that actually returned something, for the note under the score. */
  sources: string[];
}

/** Same paper from two indexes is one paper. DOI first, title as fallback. */
function dedupe(papers: ExternalPaper[]): ExternalPaper[] {
  const seen = new Set<string>();
  return papers.filter((p) => {
    const key = (p.doi ?? p.title).toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Searches the published literature across every source at once.
 *
 * All three are queried in parallel and unioned rather than tried in order.
 * Falling back source-by-source meant a Semantic Scholar rate limit silently
 * shrank the evidence base, and no single index is complete: Semantic Scholar
 * is strongest on computer science, OpenAlex covers dissertations and the long
 * tail, Crossref covers anything with a DOI. A novelty verdict is only worth
 * trusting if it was measured against the field, not against whichever API
 * happened to answer.
 *
 * Google Scholar is deliberately absent — it publishes no API and its terms
 * forbid scraping.
 */
export async function searchPublishedPapers(
  queries: string | string[],
  perSource = 25
): Promise<PaperSearchResult> {
  const list = (Array.isArray(queries) ? queries : [queries]).map((q) => q.trim()).filter(Boolean);
  if (list.length === 0) return { papers: [], sources: [] };

  const attempts = list.flatMap((query) => [
    fromSemanticScholar(query, perSource).then((papers) => ({ source: "Semantic Scholar", papers })),
    fromOpenAlex(query, perSource).then((papers) => ({ source: "OpenAlex", papers })),
    fromCrossref(query, perSource).then((papers) => ({ source: "Crossref", papers })),
  ]);

  // allSettled: one index being down or rate-limited must not take the others
  // with it.
  const settled = await Promise.allSettled(attempts);

  const collected: ExternalPaper[] = [];
  const sources = new Set<string>();

  for (const outcome of settled) {
    if (outcome.status !== "fulfilled" || outcome.value.papers.length === 0) continue;
    sources.add(outcome.value.source);
    collected.push(...outcome.value.papers);
  }

  return { papers: dedupe(collected), sources: [...sources] };
}

/**
 * Real doctoral and masters dissertations, used to populate the archive until
 * the university's own repository holds deposited theses.
 */
export async function searchDissertations(query: string, limit = 25): Promise<ExternalPaper[]> {
  try {
    return await fromOpenAlex(query, limit, true);
  } catch {
    return [];
  }
}
