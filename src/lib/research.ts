/**
 * Module 1 (Member 1) — Research Landscape & Trend Analyzer
 *
 * Pure functions that turn raw Semantic Scholar / OpenAlex results into the
 * landscape summary shown to the student: what's heavily covered, where the
 * gaps are, monthly coverage for the last year, and whether the field is
 * growing, holding steady ("active"), or saturating. Kept separate from the
 * fetch layer (services/research.service.ts) so the derivation logic is
 * testable on its own, same split as lib/matching.ts.
 */

import type { LandscapePaper, YearlyCount } from "@/services/research.service";

export type FieldStatus = "growing" | "active" | "saturating";

export interface TagCount {
  tag: string;
  count: number;
}

/** How often each field-of-study tag shows up across the search results, most-common first. */
export function tagFrequency(papers: LandscapePaper[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const paper of papers) {
    for (const tag of paper.fieldsOfStudy) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
}

/** The most heavily represented tags — where a topic is already well-trodden. */
export function pickHeavilyCovered(freq: TagCount[], limit = 5): string[] {
  return freq.slice(0, limit).map((f) => f.tag);
}

/**
 * The least-represented tags that still appeared at least once — plausible
 * openings for a novel contribution. Never overlaps with the heavily-covered set.
 */
export function pickUnderstudiedGaps(freq: TagCount[], limit = 5): string[] {
  const heavilySet = new Set(pickHeavilyCovered(freq, limit));
  return [...freq]
    .reverse()
    .filter((f) => !heavilySet.has(f.tag))
    .slice(0, limit)
    .map((f) => f.tag);
}

export interface MonthBucket {
  month: string; // e.g. "Mar '25"
  count: number;
}

/**
 * Papers-per-month for the trailing 12 months (oldest -> newest), counted from
 * each paper's `publicationDate`. Papers without a known publication date are
 * skipped rather than guessed into a bucket.
 */
export function bucketMonthlyCoverage(papers: LandscapePaper[], now = new Date()): MonthBucket[] {
  const buckets: MonthBucket[] = [];
  const keys: string[] = []; // "YYYY-M" per bucket, for matching below

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${d.getMonth()}`);
    buckets.push({
      month: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }).replace(" ", " '"),
      count: 0,
    });
  }

  const indexByKey = new Map(keys.map((k, i) => [k, i]));

  for (const paper of papers) {
    if (!paper.publicationDate) continue;
    const d = new Date(paper.publicationDate);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const idx = indexByKey.get(key);
    if (idx !== undefined) buckets[idx].count += 1;
  }

  return buckets;
}

/**
 * Compares the two most recent years of publication volume against the two
 * years before that. Needs at least two distinct years of data to say anything
 * more specific than "active" — this deliberately never guesses momentum from
 * a single data point.
 */
export function determineFieldStatus(yearly: YearlyCount[]): FieldStatus {
  const sorted = [...yearly].sort((a, b) => a.year - b.year);
  if (sorted.length < 2) return "active";

  const recent = sorted.slice(-2);
  const earlier = sorted.slice(-4, -2);
  if (earlier.length === 0) return "active";

  const recentSum = recent.reduce((s, y) => s + y.count, 0);
  const earlierSum = earlier.reduce((s, y) => s + y.count, 0);

  const growthRatio = (recentSum - earlierSum) / Math.max(earlierSum, 1);
  if (growthRatio > 0.15) return "growing";
  if (growthRatio < -0.15) return "saturating";
  return "active";
}

export interface RecentPaper {
  title: string;
  venue: string;
  year: number | string;
  url: string;
}

/** The most recently published papers, formatted for the results table. */
export function pickRecentPapers(papers: LandscapePaper[], limit = 6): RecentPaper[] {
  return [...papers]
    .sort((a, b) => {
      const ad = a.publicationDate ? new Date(a.publicationDate).getTime() : (a.year ?? 0) * 10000;
      const bd = b.publicationDate ? new Date(b.publicationDate).getTime() : (b.year ?? 0) * 10000;
      return bd - ad;
    })
    .slice(0, limit)
    .map((p) => ({
      title: p.title,
      venue: p.venue || "Preprint / unlisted venue",
      year: p.year ?? "—",
      url: p.url || `https://www.semanticscholar.org/search?q=${encodeURIComponent(p.title)}`,
    }));
}
