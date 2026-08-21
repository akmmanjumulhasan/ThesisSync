/**
 * Module 3 (Member 1) — Version Control & Inline Annotation.
 *
 * Runs a chapter draft's text through LanguageTool's check API for
 * grammar/style annotations: https://languagetool.org/http-api/. Defaults to
 * the public https://api.languagetool.org/v2/check endpoint (no key
 * required, the same low-volume-friendly courtesy pattern already used for
 * Semantic Scholar and CrossRef elsewhere in this project) — point
 * LANGUAGETOOL_API_URL at a self-hosted or premium instance and set
 * LANGUAGETOOL_API_KEY/LANGUAGETOOL_USERNAME to raise the limit.
 *
 * Writing-quality checks are a supplementary annotation, not a save-blocking
 * gate: every method here returns null on failure instead of throwing, so a
 * flaky network call never stops a student from saving a draft version.
 * Self-contained: no imports from outside this project.
 */

const DEFAULT_LANGUAGETOOL_URL = "https://api.languagetool.org/v2/check";

// The public API caps request bodies well under this; trimming defensively
// avoids sending something that's guaranteed to be rejected outright.
const MAX_CHECK_LENGTH = 20_000;

export interface WritingIssue {
  message: string;
  shortMessage: string;
  offset: number;
  length: number;
  ruleId: string;
  category: string;
  replacements: string[];
}

interface LanguageToolMatch {
  message: string;
  shortMessage?: string;
  offset: number;
  length: number;
  rule?: { id?: string; category?: { name?: string } };
  replacements?: { value: string }[];
}

function checkUrl(): string {
  return process.env.LANGUAGETOOL_API_URL?.trim() || DEFAULT_LANGUAGETOOL_URL;
}

export class LanguageToolService {
  /**
   * Checks a block of text. Returns null (never throws) if the text is empty
   * or the request fails after one retry — callers should treat null as
   * "check unavailable", not "no issues found".
   */
  static async check(text: string, attempt = 0): Promise<WritingIssue[] | null> {
    const trimmed = text.trim().slice(0, MAX_CHECK_LENGTH);
    if (!trimmed) return [];

    const params = new URLSearchParams({ text: trimmed, language: "en-US" });
    const apiKey = process.env.LANGUAGETOOL_API_KEY?.trim();
    const username = process.env.LANGUAGETOOL_USERNAME?.trim();
    if (apiKey && username) {
      params.set("apiKey", apiKey);
      params.set("username", username);
    }

    try {
      const res = await fetch(checkUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: params.toString(),
      });

      if (!res.ok) {
        if (attempt === 0) return LanguageToolService.check(text, attempt + 1);
        return null;
      }

      const body = (await res.json()) as { matches?: LanguageToolMatch[] };
      return (body.matches ?? []).map((m) => ({
        message: m.message,
        shortMessage: m.shortMessage || m.message,
        offset: m.offset,
        length: m.length,
        ruleId: m.rule?.id ?? "UNKNOWN",
        category: m.rule?.category?.name ?? "General",
        replacements: (m.replacements ?? []).slice(0, 5).map((r) => r.value),
      }));
    } catch {
      if (attempt === 0) return LanguageToolService.check(text, attempt + 1);
      return null;
    }
  }
}
