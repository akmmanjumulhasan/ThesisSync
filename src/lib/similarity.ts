/**
 * Module 2 (Member 3): Topic Novelty & Similarity Checker.
 *
 * The scoring engine, kept pure so it can be reasoned about and tested without
 * a database or a network call. One engine serves both entry points the spec
 * describes: a proposed title and abstract at the idea stage, and an uploaded
 * chapter draft before submission.
 *
 * TF-IDF with cosine similarity is deliberate rather than incidental. Raw word
 * overlap would rank every thesis in a department as similar, because they all
 * share "thesis", "chapter", "university", "propose". Weighting each term by
 * how rare it is across the corpus means the score is driven by the terms that
 * actually distinguish one piece of work from another.
 */

/**
 * Function words plus the academic boilerplate every thesis in the corpus
 * shares. Left in, these dominate the vectors and make unrelated theses look
 * alike; IDF suppresses them, but removing them first keeps the shared-term
 * explanations readable.
 */
const STOPWORDS = new Set([
  "a", "about", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "could", "did", "do",
  "does", "for", "from", "had", "has", "have", "he", "her", "his", "how", "i", "if", "in", "into",
  "is", "it", "its", "may", "might", "more", "most", "must", "no", "not", "of", "on", "one", "only",
  "or", "other", "our", "out", "over", "own", "said", "same", "she", "should", "so", "some", "such",
  "than", "that", "the", "their", "them", "then", "there", "these", "they", "this", "those",
  "through", "to", "too", "under", "up", "very", "was", "we", "were", "what", "when", "where",
  "which", "while", "who", "why", "will", "with", "would", "you", "your",
  // Function words that survived stemming and kept surfacing as "shared terms".
  // "shared: learning, without, train" tells a reader nothing about why two
  // documents overlap.
  "about", "across", "after", "again", "against", "along", "also", "among", "because", "become",
  "been", "before", "being", "below", "besides", "between", "beyond", "both", "during", "each",
  "either", "every", "few", "given", "having", "hence", "here", "many", "much", "neither", "onto",
  "per", "rather", "since", "still", "then", "therefore", "thus", "toward", "towards", "until",
  "upon", "via", "well", "whether", "within", "without",
  // Academic boilerplate: present in essentially every thesis, so it carries no
  // signal about what a particular thesis is about.
  "abstract", "aim", "aims", "analysis", "approach", "based", "chapter", "conclusion", "data",
  "dataset", "different", "e.g", "et", "al", "evaluate", "evaluation", "experiment", "experiments",
  "figure", "further", "however", "i.e", "introduction", "method", "methodology", "methods",
  "paper", "present", "presented", "propose", "proposed", "research", "result", "results", "show",
  "shows", "significant", "study", "table", "thesis", "university", "using", "work", "works",
]);

/** Light suffix stripping so "embeddings", "embedding", and "embedded" collide. */
function stem(token: string): string {
  if (token.length <= 4) return token;
  for (const suffix of ["ization", "ations", "ation", "ingly", "edly", "ings", "ing", "ies", "ied", "es", "ed", "s"]) {
    if (token.length - suffix.length >= 4 && token.endsWith(suffix)) {
      const base = token.slice(0, -suffix.length);
      return suffix === "ies" ? `${base}y` : base;
    }
  }
  return token;
}

/**
 * Splits text into scoreable terms, keeping each stem paired with the word it
 * came from. Intra-word hyphens and dots survive so "tf-idf", "node.js", and
 * "f1-score" stay single terms — losing those would erase exactly the technical
 * vocabulary the score depends on.
 *
 * The pairing exists because stems are for matching, not for reading. "across"
 * stems to "acros" and "evaluation" to "evaluat"; showing those to a student
 * makes correct output look broken, so anything user-facing resolves back to
 * the original word via surfaceForms.
 */
export function tokenizePairs(text: string): { original: string; stem: string }[] {
  return text
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .split(/[^a-z0-9'.+#-]+/)
    .map((t) => t.replace(/^[.'-]+|[.'-]+$/g, ""))
    .filter((t) => t.length > 2 && !/^\d+$/.test(t) && !STOPWORDS.has(t))
    .map((original) => ({ original, stem: stem(original) }))
    .filter((p) => p.stem.length > 2 && !STOPWORDS.has(p.stem));
}

export function tokenize(text: string): string[] {
  return tokenizePairs(text).map((p) => p.stem);
}

/**
 * stem -> the word a reader should actually see.
 *
 * Where one stem covers several words ("embedding", "embeddings"), the most
 * frequent wins, and the shorter form breaks a tie — that is usually the base
 * form rather than an inflection.
 */
export function surfaceForms(text: string): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();

  for (const { original, stem: s } of tokenizePairs(text)) {
    const forms = counts.get(s) ?? new Map<string, number>();
    forms.set(original, (forms.get(original) ?? 0) + 1);
    counts.set(s, forms);
  }

  const best = new Map<string, string>();
  for (const [s, forms] of counts) {
    const winner = [...forms.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].length - b[0].length
    )[0][0];
    best.set(s, winner);
  }
  return best;
}

/** Resolves stems back to readable words, leaving unknown stems untouched. */
function readable(stems: string[], surfaces: Map<string, string>): string[] {
  return stems.map((s) => surfaces.get(s) ?? s);
}

/**
 * Words that describe a document's structure rather than its subject.
 *
 * Kept separate from STOPWORDS because they are only harmful when *searching*:
 * a thesis genuinely about software modules should still score on "module", but
 * a search query built from "module member assignment" retrieves whatever
 * happens to contain those words. A project specification listing "Module 1,
 * Member 2" produced exactly that query, and matched a solar-cell gasket.
 */
const QUERY_STOPWORDS = new Set([
  "appendix", "assignment", "chapter", "component", "course", "criteria", "deliverable",
  "description", "detail", "details", "document", "draft", "feature", "features", "figure",
  "following", "format", "group", "guideline", "guidelines", "list", "member", "members",
  "milestone", "module", "modules", "note", "notes", "objective", "objectives", "outline",
  "overview", "page", "part", "phase", "point", "points", "project", "purpose", "reference",
  "references", "report", "requirement", "requirements", "review", "scope", "section",
  "semester", "specification", "step", "steps", "submission", "summary", "task", "tasks",
  "template", "term", "title", "topic", "unit", "version",
]);

export interface Document {
  id: string;
  text: string;
}

type Vector = Map<string, number>;

/**
 * TF-IDF vectors for a corpus, L2-normalised so cosine similarity is a plain
 * dot product.
 *
 * IDF uses the smoothed log form: a term appearing in every document scores
 * zero rather than dividing by zero, which is what should happen — a term
 * everything shares distinguishes nothing.
 */
export class TfIdfIndex {
  private readonly idf = new Map<string, number>();
  private readonly vectors = new Map<string, Vector>();
  readonly size: number;

  constructor(documents: Document[]) {
    this.size = documents.length;

    const tokenized = documents.map((d) => ({ id: d.id, tokens: tokenize(d.text) }));

    const docFreq = new Map<string, number>();
    for (const doc of tokenized) {
      for (const term of new Set(doc.tokens)) {
        docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
      }
    }
    for (const [term, freq] of docFreq) {
      this.idf.set(term, Math.log((this.size + 1) / (freq + 1)) + 1);
    }

    for (const doc of tokenized) {
      this.vectors.set(doc.id, this.vectorize(doc.tokens));
    }
  }

  /** IDF for an unseen term: treated as maximally rare, since nothing in the corpus used it. */
  private idfFor(term: string): number {
    return this.idf.get(term) ?? Math.log(this.size + 1) + 1;
  }

  private vectorize(tokens: string[]): Vector {
    const counts = new Map<string, number>();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);

    const vector: Vector = new Map();
    let sumSquares = 0;
    for (const [term, count] of counts) {
      // Sublinear term frequency: a word used 50 times is more important than
      // one used 5 times, but not ten times more.
      const weight = (1 + Math.log(count)) * this.idfFor(term);
      vector.set(term, weight);
      sumSquares += weight * weight;
    }

    const norm = Math.sqrt(sumSquares);
    if (norm > 0) {
      for (const [term, weight] of vector) vector.set(term, weight / norm);
    }
    return vector;
  }

  /** Vector for text that was not in the corpus — the query side of a comparison. */
  vectorFor(text: string): Vector {
    return this.vectorize(tokenize(text));
  }

  vectorOf(id: string): Vector | undefined {
    return this.vectors.get(id);
  }
}

/** Cosine similarity of two L2-normalised vectors, as a plain dot product. */
export function cosine(a: Vector, b: Vector): number {
  // Iterate the smaller vector: the result is identical and the work is bounded
  // by the shorter document rather than the longer one.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let sum = 0;
  for (const [term, weight] of small) {
    const other = large.get(term);
    if (other) sum += weight * other;
  }
  return Math.max(0, Math.min(1, sum));
}

/** The terms contributing most to an overlap, so a match can be explained. */
export function sharedTerms(a: Vector, b: Vector, limit = 5): string[] {
  const contributions: { term: string; weight: number }[] = [];
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [term, weight] of small) {
    const other = large.get(term);
    if (other) contributions.push({ term, weight: weight * other });
  }
  return contributions
    .sort((x, y) => y.weight - x.weight)
    .slice(0, limit)
    .map((c) => c.term);
}

export type Risk = "LOW" | "MODERATE" | "HIGH";

/**
 * Draft stage: at or above this, a passage goes to the supervisor before final
 * submission. Kept as one constant so the badge, the flag, and any future
 * notification cannot drift apart.
 *
 * Set deliberately low. A chapter overlapping an archived thesis by a tenth is
 * worth a human glance, and the cost of a supervisor dismissing a false alarm
 * is far smaller than the cost of missed duplication reaching a viva.
 */
export const SUPERVISOR_ATTENTION_THRESHOLD = 10;

/**
 * Below this, a match is noise: two documents sharing a couple of ordinary
 * words. Anything at or above it is listed, so the reader can judge a weak
 * overlap for themselves rather than having it hidden — but a 2% coincidence is
 * still never presented as related work.
 */
export const MEANINGFUL_SIMILARITY = 8;

/**
 * Bands, ordered so they cannot contradict each other: anything worth a
 * supervisor's attention is HIGH, anything worth listing at all is at least
 * MODERATE, and everything below the listing floor is LOW.
 */
export function riskFor(topSimilarity: number): Risk {
  if (topSimilarity >= SUPERVISOR_ATTENTION_THRESHOLD) return "HIGH";
  if (topSimilarity >= MEANINGFUL_SIMILARITY) return "MODERATE";
  return "LOW";
}

export function riskLabel(risk: Risk): string {
  return risk === "HIGH" ? "needs review" : risk === "MODERATE" ? "moderate" : "low risk";
}

export interface ScoredMatch {
  id: string;
  score: number;
  sharedTerms: string[];
}

/** Every corpus document scored against the query, most similar first. */
export function rankAgainstCorpus(
  index: TfIdfIndex,
  query: string,
  corpus: Document[],
  limit = 5
): ScoredMatch[] {
  const queryVector = index.vectorFor(query);
  // Shared terms are shown to the student, so they resolve back to the words
  // actually written rather than the stems used for matching.
  const surfaces = surfaceForms(query);

  return corpus
    .map((doc) => {
      const docVector = index.vectorOf(doc.id);
      if (!docVector) return { id: doc.id, score: 0, sharedTerms: [] };
      return {
        id: doc.id,
        score: Math.round(cosine(queryVector, docVector) * 100),
        sharedTerms: readable(sharedTerms(queryVector, docVector), surfaces),
      };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** How thoroughly one body of work covers an idea, on the same 0-100 scale. */
function coverageOf(matches: { score: number }[]): number {
  const top = matches[0]?.score ?? 0;
  const runnerUps = matches.slice(1, 4);
  const supporting = runnerUps.length
    ? runnerUps.reduce((sum, m) => sum + m.score, 0) / runnerUps.length
    : 0;

  // Weighted toward the single closest match rather than the average: one piece
  // of work that already does exactly this matters far more than a dozen
  // loosely related ones, and averaging would let a crowd of weak matches hide
  // it. The two weights sum to 1, so an exact duplicate reaches 100 — an
  // earlier version capped the top match at 65, which meant a 97% duplicate
  // still reported 35% novel.
  return top * 0.8 + supporting * 0.2;
}

/**
 * Novelty as the inverse of how well *either* body of work already covers this
 * idea.
 *
 * The archive and the published literature are weighed symmetrically, and the
 * stronger evidence wins rather than being averaged away. A thesis nobody at
 * this university has written is not novel if the field published it last year,
 * and an earlier version of this function let exactly that happen by giving the
 * external half only 15% of the weight.
 */
export function noveltyScore(
  archiveMatches: { score: number }[],
  externalMatches: { score: number }[] = []
): number {
  const coverage = Math.max(coverageOf(archiveMatches), coverageOf(externalMatches));
  return Math.max(0, Math.min(100, Math.round(100 - coverage)));
}

export interface Breakdown {
  understudied: string[];
  alreadyCovered: string[];
}

/**
 * Splits the proposal's own vocabulary into angles the corpus barely touches
 * and methodologies it already covers — the breakdown the spec asks for.
 *
 * A term counts as covered when it appears in a meaningful share of the corpus;
 * terms the corpus rarely or never uses are where the space for a novel
 * contribution actually is.
 */
export function breakdown(
  query: string,
  archive: Document[],
  external: Document[] = [],
  limit = 4
): Breakdown {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0 || (archive.length === 0 && external.length === 0)) {
    return { understudied: [], alreadyCovered: [] };
  }

  const surfaces = surfaceForms(query);
  const archiveTokens = archive.map((d) => new Set(tokenize(d.text)));
  const externalTokens = external.map((d) => new Set(tokenize(d.text)));

  const countIn = (sets: Set<string>[], term: string) =>
    sets.reduce((n, tokens) => n + (tokens.has(term) ? 1 : 0), 0);

  const scored = queryTerms.map((term) => ({
    term,
    inArchive: countIn(archiveTokens, term),
    inExternal: countIn(externalTokens, term),
  }));

  const archiveCutoff = Math.max(2, Math.ceil(archive.length * 0.15));
  // The external set was retrieved *using* this query, so it is biased toward
  // matching it. Appearing in one returned paper therefore proves little;
  // recurring across several is what shows the field genuinely works on it.
  const externalCutoff = Math.max(2, Math.ceil(external.length * 0.25));

  const alreadyCovered = readable(
    scored
      .filter((s) => s.inArchive >= archiveCutoff || s.inExternal >= externalCutoff)
      .sort((a, b) => b.inArchive + b.inExternal - (a.inArchive + a.inExternal))
      .slice(0, limit)
      .map((s) => s.term),
    surfaces
  );

  // Understudied has to hold on *both* sides. Judging it on the archive alone
  // labelled "arrhythmia" an untouched angle while the literature search was
  // simultaneously returning papers on arrhythmia classification.
  const understudied = readable(
    scored
      .filter((s) => s.inArchive <= 1 && s.inExternal <= 1)
      .sort(
        (a, b) =>
          a.inArchive + a.inExternal - (b.inArchive + b.inExternal) ||
          b.term.length - a.term.length
      )
      .slice(0, limit)
      .map((s) => s.term),
    surfaces
  );

  return { understudied, alreadyCovered };
}

/**
 * A short search query built from the most distinctive terms in a proposal.
 *
 * Literature APIs are search engines, not similarity engines: handed a whole
 * abstract they either return nothing or reject the request outright. Semantic
 * Scholar answered a 40-word query with a 429 and a 6-word one with 1,255
 * results, so what goes over the wire has to be a handful of terms.
 *
 * Title terms lead, because a title is already the author's own summary of the
 * work; abstract terms fill the remainder in order of appearance.
 */
export function keywordQuery(title: string, abstract = "", limit = 6): string {
  const seen = new Set<string>();
  const terms: string[] = [];

  // Deduplicated on the stem but emitted as the original word. A literature API
  // is a search engine, not this scorer: "federat learn wearable" matches far
  // less than "federated learning wearable".
  for (const source of [title, abstract]) {
    for (const { original, stem: s } of tokenizePairs(source)) {
      if (seen.has(s) || QUERY_STOPWORDS.has(original) || QUERY_STOPWORDS.has(s)) continue;
      seen.add(s);
      terms.push(original);
      if (terms.length >= limit) return terms.join(" ");
    }
  }

  return terms.join(" ");
}

/**
 * A search query for a document that has no title — an uploaded chapter.
 *
 * keywordQuery takes terms in order of appearance, which works for a title
 * because a title is already a summary. A chapter opens with scaffolding
 * ("this chapter describes…"), so its first words say nothing about its
 * subject. Ranking by how often a term recurs across the whole document
 * recovers what it is actually about.
 */
export function topTerms(text: string, limit = 6, index?: TfIdfIndex): string {
  const surfaces = surfaceForms(text);

  // With a corpus to weigh against, rank by TF-IDF: frequent *and* distinctive.
  // Raw frequency alone picked "chosen", "papers", "science" out of a chapter
  // about citation networks — and duly retrieved a paper titled "How Were 'The
  // Chosen' Chosen?". Rarity is what separates a subject from its filler.
  if (index) {
    const weights = index.vectorFor(text);
    if (weights.size > 0) {
      return [...weights.entries()]
        .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
        .map(([s]) => surfaces.get(s) ?? s)
        .filter((word) => !QUERY_STOPWORDS.has(word))
        .slice(0, limit)
        .join(" ");
    }
  }

  const counts = new Map<string, number>();
  for (const s of tokenize(text)) counts.set(s, (counts.get(s) ?? 0) + 1);
  if (counts.size === 0) return "";

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([s]) => surfaces.get(s) ?? s)
    .filter((word) => !QUERY_STOPWORDS.has(word))
    .slice(0, limit)
    .join(" ");
}

/** Rough word count of what was actually scored. */
export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
