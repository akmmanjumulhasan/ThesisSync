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
 * Splits text into scoreable terms. Keeps intra-word hyphens and dots so
 * "tf-idf", "node.js", and "f1-score" survive as single terms — losing those
 * would erase exactly the technical vocabulary the score depends on.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .split(/[^a-z0-9'.+#-]+/)
    .map((t) => t.replace(/^[.'-]+|[.'-]+$/g, ""))
    .filter((t) => t.length > 2 && !/^\d+$/.test(t) && !STOPWORDS.has(t))
    .map(stem)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

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
 * The single similarity threshold in the system.
 *
 * The spec's rule — flag passages above 30% for supervisor attention — lives
 * here so the badge, the flag, and any future notification cannot drift apart.
 */
export const SUPERVISOR_ATTENTION_THRESHOLD = 30;

export function riskFor(topSimilarity: number): Risk {
  if (topSimilarity >= SUPERVISOR_ATTENTION_THRESHOLD) return "HIGH";
  if (topSimilarity >= 15) return "MODERATE";
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

  return corpus
    .map((doc) => {
      const docVector = index.vectorOf(doc.id);
      if (!docVector) return { id: doc.id, score: 0, sharedTerms: [] };
      return {
        id: doc.id,
        score: Math.round(cosine(queryVector, docVector) * 100),
        sharedTerms: sharedTerms(queryVector, docVector),
      };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Novelty as the inverse of how well the corpus already covers this idea.
 *
 * Weighted toward the single closest match rather than the average: one thesis
 * that already does exactly this matters far more than a dozen loosely related
 * ones, and averaging would let a crowd of weak matches hide it.
 */
export function noveltyScore(matches: ScoredMatch[], externalOverlap = 0): number {
  const top = matches[0]?.score ?? 0;
  const runnerUps = matches.slice(1, 4);
  const supporting = runnerUps.length
    ? runnerUps.reduce((sum, m) => sum + m.score, 0) / runnerUps.length
    : 0;

  const coverage = top * 0.65 + supporting * 0.2 + externalOverlap * 0.15;
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
  corpus: Document[],
  limit = 4
): Breakdown {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0 || corpus.length === 0) {
    return { understudied: [], alreadyCovered: [] };
  }

  const corpusTokens = corpus.map((d) => new Set(tokenize(d.text)));

  const scored = queryTerms.map((term) => ({
    term,
    docs: corpusTokens.reduce((n, tokens) => n + (tokens.has(term) ? 1 : 0), 0),
  }));

  const coveredCutoff = Math.max(2, Math.ceil(corpus.length * 0.15));

  const alreadyCovered = scored
    .filter((s) => s.docs >= coveredCutoff)
    .sort((a, b) => b.docs - a.docs)
    .slice(0, limit)
    .map((s) => s.term);

  const understudied = scored
    .filter((s) => s.docs <= 1)
    .sort((a, b) => a.docs - b.docs || b.term.length - a.term.length)
    .slice(0, limit)
    .map((s) => s.term);

  return { understudied, alreadyCovered };
}

/** Rough word count of what was actually scored. */
export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
