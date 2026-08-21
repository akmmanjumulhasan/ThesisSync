import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { getSession } from "@/lib/auth";
import type { PaperOptions, SectionField } from "@/services/ieee-paper.service";

/**
 * Module 3 (Member 2): request parsing shared by the transpiler's two routes.
 *
 * Both the outline and the PDF are built from the same options, so reading them
 * lives here rather than being written twice and drifting apart.
 */

const MAX_HEADER = 120;
const MAX_AFFILIATION = 160;
const MAX_TITLE = 300;
const MAX_ABSTRACT = 4000;
/**
 * Sections now carry chapter prose rather than a proposal's short fields, so
 * the old 4,000-character cap (which matched the proposal builder) would have
 * silently truncated real chapters. Still bounded — a conference paper is a few
 * pages, and an unbounded body would be a denial-of-service vector on the
 * renderer.
 */
const MAX_SECTION = 20_000;
/** A thesis is capped at 20 chapters, so a submission carrying more is malformed. */
const MAX_SECTIONS = 20;
const MAX_SECTION_KEY = 64;
const MAX_REFERENCE = 600;
const MAX_REFERENCES = 100;
const MAX_AUTHORS = 12;

function text(value: unknown, limit: number): string | undefined {
  return typeof value === "string" ? value.slice(0, limit) : undefined;
}

function list(value: unknown, limit: number, max: number): string[] | undefined {
  if (typeof value === "string") return value.split("\n").map((v) => v.slice(0, limit)).slice(0, max);
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.slice(0, limit))
    .slice(0, max);
}

/**
 * Section bodies, keyed by chapter id.
 *
 * There is no fixed key list to check against any more, because the sections
 * are the student's own locked chapters. Bounds are enforced here — key shape,
 * count and length — and the service does the authorization: it only emits
 * sections for chapters that came back from the database as this student's and
 * LOCKED, so a fabricated or borrowed id in this payload matches nothing and is
 * dropped.
 */
function sections(value: unknown): PaperOptions["sections"] {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const out: Partial<Record<SectionField, string>> = {};
  for (const key of Object.keys(source).slice(0, MAX_SECTIONS)) {
    if (key.length > MAX_SECTION_KEY) continue;
    const entry = text(source[key], MAX_SECTION);
    if (entry !== undefined) out[key] = entry;
  }
  return out;
}

export function readOptions(source: Record<string, unknown>): PaperOptions {
  return {
    affiliation: text(source.affiliation, MAX_AFFILIATION),
    runningHeader: text(source.runningHeader, MAX_HEADER),
    title: text(source.title, MAX_TITLE),
    abstract: text(source.abstract, MAX_ABSTRACT),
    authorIds: list(source.authorIds, 64, MAX_AUTHORS),
    references: list(source.references, MAX_REFERENCE, MAX_REFERENCES),
    sections: sections(source.sections),
    // Comma-separated on the page, since IEEE prints them as one run-on line.
    indexTerms:
      typeof source.indexTerms === "string"
        ? source.indexTerms.split(",").map((t) => t.trim().slice(0, 60)).filter(Boolean).slice(0, 8)
        : list(source.indexTerms, 60, 8),
  };
}

/** The signed-in student, or the response explaining why there isn't one. */
export async function requireStudent() {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: "You must be signed in." }, { status: 401 }) };
  }
  if (session.role !== Role.STUDENT) {
    return {
      error: NextResponse.json(
        { error: "The IEEE Conference Paper Transpiler is available to student accounts." },
        { status: 403 }
      ),
    };
  }
  return { studentId: session.sub };
}
