/**
 * Module 1 (Member 3) — Structured Thesis Proposal Builder.
 *
 * Validates that a cited DOI actually exists and resolves its metadata via
 * CrossRef's public Works API: https://api.crossref.org/works/{doi}. Public,
 * no key required — an optional contact email (CROSSREF_MAILTO) puts requests
 * in CrossRef's faster "polite pool", the same courtesy pattern already used
 * for OpenAlex in the Research Landscape module. Self-contained: no imports
 * from outside this project.
 */

const CROSSREF_WORKS_API = "https://api.crossref.org/works";

/** A DOI must look like 10.<4-9 digit registrant>/<suffix> to be worth a network call at all. */
const DOI_SHAPE = /^10\.\d{4,9}\/\S+$/;

function crossrefMailtoParam(): string {
  const mailto = process.env.CROSSREF_MAILTO;
  return mailto ? `?mailto=${encodeURIComponent(mailto)}` : "";
}

export interface ResolvedDoi {
  doi: string;
  found: boolean;
  title: string | null;
  venue: string | null;
  year: number | null;
}

interface CrossrefWorkMessage {
  title?: string[];
  "container-title"?: string[];
  published?: { "date-parts"?: number[][] };
  "published-print"?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
}

export class CrossRefService {
  /**
   * Resolves a single DOI. Malformed DOIs are rejected without a network
   * call. A clean 404 from CrossRef means the DOI genuinely doesn't exist,
   * so it's reported as not-found immediately; anything else that fails
   * (a dropped connection, a 429/5xx) is treated as transient and retried
   * once before giving up, so a real DOI doesn't get wrongly flagged "Not
   * found" just because the first request had a rough start.
   */
  static async resolve(rawDoi: string, attempt = 0): Promise<ResolvedDoi> {
    const doi = rawDoi.trim().replace(/^https?:\/\/doi\.org\//i, "");

    if (!DOI_SHAPE.test(doi)) {
      return { doi, found: false, title: null, venue: null, year: null };
    }

    try {
      // The DOI's own slash is a path separator CrossRef expects verbatim —
      // do not encodeURIComponent the whole string, only build the URL directly.
      const res = await fetch(`${CROSSREF_WORKS_API}/${doi}${crossrefMailtoParam()}`, {
        headers: { Accept: "application/json" },
      });

      if (res.status === 404) {
        return { doi, found: false, title: null, venue: null, year: null };
      }
      if (!res.ok) {
        if (attempt === 0) return CrossRefService.resolve(rawDoi, attempt + 1);
        return { doi, found: false, title: null, venue: null, year: null };
      }

      const body = (await res.json()) as { message?: CrossrefWorkMessage };
      const message = body.message ?? {};

      const title = message.title?.[0] ?? null;
      const venue = message["container-title"]?.[0] ?? null;
      const year =
        message.published?.["date-parts"]?.[0]?.[0] ??
        message["published-print"]?.["date-parts"]?.[0]?.[0] ??
        message["published-online"]?.["date-parts"]?.[0]?.[0] ??
        null;

      return { doi, found: true, title, venue, year };
    } catch {
      if (attempt === 0) return CrossRefService.resolve(rawDoi, attempt + 1);
      return { doi, found: false, title: null, venue: null, year: null };
    }
  }

  /** Resolves a batch of DOIs in parallel — CrossRef has no bulk lookup endpoint. */
  static async resolveMany(dois: string[]): Promise<ResolvedDoi[]> {
    return Promise.all(dois.map((doi) => CrossRefService.resolve(doi)));
  }
}
