/**
 * Module 1 (Member 1) — Research Landscape & Trend Analyzer.
 *
 * Pulls live signal from two sources so a student can see a field's shape
 * before committing to a topic:
 *  - Semantic Scholar: recent papers on the topic, used for the "what's already
 *    covered vs. understudied" tag breakdown and the recent-papers table.
 *  - OpenAlex: yearly publication counts for the topic, used to tell whether
 *    the field is growing, holding steady, or saturating — and doubles as the
 *    paper-list fallback when Semantic Scholar's shared rate limit is hit,
 *    since its `concepts` field is a direct analog of `s2FieldsOfStudy`.
 *
 * Both APIs are public and work without a key at this call volume. Self-contained:
 * no imports from outside this project.
 */

const SEMANTIC_SCHOLAR_API = "https://api.semanticscholar.org/graph/v1/paper/search";
const OPENALEX_API = "https://api.openalex.org/works";

function semanticScholarHeaders(): HeadersInit {
  // Optional: set SEMANTIC_SCHOLAR_API_KEY to raise the (otherwise shared/low) rate limit.
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY;
  return key ? { "x-api-key": key } : {};
}

/** OpenAlex's "polite pool" — a contact email in the query string gets faster, more reliable service, no signup needed. */
function openAlexMailtoParam(): string {
  const mailto = process.env.OPENALEX_MAILTO;
  return mailto ? `&mailto=${encodeURIComponent(mailto)}` : "";
}

/** A single paper, normalized to the same shape regardless of which source it came from. */
export interface LandscapePaper {
  title: string;
  venue: string | null;
  year: number | null;
  url: string | null;
  publicationDate: string | null; // "YYYY-MM-DD" when known
  fieldsOfStudy: string[];
}

export interface YearlyCount {
  year: number;
  count: number;
}

export class ResearchLandscapeService {
  /** Up to `limit` recent papers matching the topic, from Semantic Scholar. */
  static async searchPapers(topic: string, limit = 50): Promise<LandscapePaper[]> {
    const url = `${SEMANTIC_SCHOLAR_API}?query=${encodeURIComponent(topic)}&limit=${limit}&fields=title,venue,year,url,publicationDate,s2FieldsOfStudy`;
    const res = await fetch(url, { headers: semanticScholarHeaders() });
    if (!res.ok) {
      throw new Error(`Semantic Scholar search failed (status ${res.status})`);
    }
    const body = await res.json();
    const papers = (body.data ?? []) as Array<{
      title: string;
      venue: string | null;
      year: number | null;
      url: string | null;
      publicationDate: string | null;
      s2FieldsOfStudy?: { category: string }[] | null;
    }>;

    return papers.map((p) => ({
      title: p.title,
      venue: p.venue ?? null,
      year: p.year ?? null,
      url: p.url ?? null,
      publicationDate: p.publicationDate ?? null,
      fieldsOfStudy: (p.s2FieldsOfStudy ?? []).map((f) => f.category).filter(Boolean),
    }));
  }

  /**
   * Same shape as `searchPapers`, sourced from OpenAlex instead. Used as the
   * fallback when Semantic Scholar's search is unavailable — OpenAlex's
   * `concepts` (ranked by relevance score) stand in for `s2FieldsOfStudy`.
   */
  static async searchWorksOpenAlex(topic: string, limit = 50): Promise<LandscapePaper[]> {
    const url = `${OPENALEX_API}?search=${encodeURIComponent(topic)}&per-page=${limit}&sort=publication_date:desc${openAlexMailtoParam()}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      throw new Error(`OpenAlex works search failed (status ${res.status})`);
    }
    const body = await res.json();
    const works = (body.results ?? []) as Array<{
      title: string | null;
      display_name: string | null;
      publication_year: number | null;
      publication_date: string | null;
      id: string | null;
      primary_location?: { landing_page_url?: string | null; source?: { display_name?: string | null } | null } | null;
      concepts?: { display_name: string; score: number }[] | null;
    }>;

    return works.map((w) => ({
      title: w.title ?? w.display_name ?? "Untitled",
      venue: w.primary_location?.source?.display_name ?? null,
      year: w.publication_year ?? null,
      url: w.primary_location?.landing_page_url ?? w.id ?? null,
      publicationDate: w.publication_date ?? null,
      fieldsOfStudy: [...(w.concepts ?? [])]
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((c) => c.display_name),
    }));
  }

  /**
   * Publication counts per year for the topic, via OpenAlex's `group_by`
   * (one request instead of one-call-per-year). Used to judge field momentum.
   */
  static async yearlyTrend(topic: string): Promise<YearlyCount[]> {
    const url = `${OPENALEX_API}?search=${encodeURIComponent(topic)}&group_by=publication_year${openAlexMailtoParam()}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      throw new Error(`OpenAlex trend lookup failed (status ${res.status})`);
    }
    const body = await res.json();
    const groups = (body.group_by ?? []) as Array<{ key: string; count: number }>;

    return groups
      .map((g) => ({ year: Number(g.key), count: g.count }))
      .filter((g) => Number.isFinite(g.year) && g.year > 1900)
      .sort((a, b) => a.year - b.year);
  }
}
