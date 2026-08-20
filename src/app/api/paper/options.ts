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
/** Matches the proposal builder's own per-field cap. */
const MAX_SECTION = 4000;
const MAX_REFERENCE = 600;
const MAX_REFERENCES = 100;
const MAX_AUTHORS = 12;

const SECTION_FIELDS: SectionField[] = [
  "problemStatement",
  "researchObjectives",
  "methodologyOutline",
  "expectedContribution",
  "limitations",
];

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

/** Only the fields the section plan knows about; anything else is discarded. */
function sections(value: unknown): PaperOptions["sections"] {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const out: Partial<Record<SectionField, string>> = {};
  for (const field of SECTION_FIELDS) {
    const entry = text(source[field], MAX_SECTION);
    if (entry !== undefined) out[field] = entry;
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
