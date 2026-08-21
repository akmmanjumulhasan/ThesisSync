/**
 * Module 3 (Member 2): the examiner's brief for the AI Mock Defense Simulator.
 *
 * Everything here is pure: the prompts, the shape the model must answer in, and
 * the parsing that refuses anything else. Keeping it out of the service means
 * the wording of a question can be reviewed and changed without reading any
 * database or network code.
 *
 * The design point is that a viva examiner does not improvise. They read the
 * thesis, decide where it is weak, and then ask about those places. So the
 * model is made to do the same in two passes — analyse, then question — rather
 * than being asked for questions cold, which produces the generic "what is your
 * motivation?" filler this feature exists to avoid.
 */

/** The four areas the requirement names. Every session covers all of them. */
export const FOCUS_AREAS = [
  {
    key: "LIMITATIONS",
    label: "Research limitations",
    brief: "what the work cannot show, and whether the thesis admits it",
  },
  {
    key: "DATA_VALIDATION",
    label: "Data validation",
    brief: "how the data was checked, and whether the evidence supports the claims",
  },
  {
    key: "ETHICS",
    label: "Ethical concerns",
    brief: "consent, bias, harm, and who is affected by getting this wrong",
  },
  {
    key: "METHODOLOGY",
    label: "Methodology gaps",
    brief: "choices that are unjustified, unstated, or not reproducible",
  },
] as const;

export type FocusKey = (typeof FOCUS_AREAS)[number]["key"];

export const FOCUS_LABEL: Record<string, string> = Object.fromEntries(
  FOCUS_AREAS.map((a) => [a.key, a.label])
);

/** How many questions a session asks per area. */
export type Depth = "focused" | "thorough";

export function questionsPerArea(depth: Depth): number {
  return depth === "thorough" ? 2 : 1;
}

/**
 * Beyond this the prompt is padding, not context.
 *
 * Also a hard budget rather than a nicety: Groq's free tier allows 8,000 tokens
 * per minute counting input and reserved output together, and a thesis longer
 * than this leaves no room for the questions it is supposed to produce.
 */
const MAX_THESIS_CHARS = 9000;

/**
 * What the examiner is given to read.
 *
 * The body is the student's supervisor-approved chapters, not their proposal.
 * A viva examines finished work: what was done, what was found, and what the
 * evidence actually supports. A proposal states intent and contains no results,
 * which made one of the four mandated focus areas — DATA_VALIDATION, "how the
 * data was checked, and whether the evidence supports the claims" — impossible
 * to ask about honestly. The model had no data to interrogate and could only
 * invent questions about work that did not exist yet.
 *
 * Title and abstract still come from the proposal. Those name the work rather
 * than plan it, and chapters carry no thesis-level equivalent — a chapter has
 * its own title, not the thesis's. The cited references come from there too,
 * since that is where DOIs are validated.
 */
export interface ThesisSource {
  title: string;
  abstract: string;
  /** Approved or locked chapters, in thesis order. */
  chapters: { number: number; title: string; content: string; status: string }[];
  references: { doi: string; resolvedTitle: string | null; resolvedYear: number | null }[];
}

/**
 * The thesis as the examiner reads it.
 *
 * Chapters are labelled with their own titles and numbered as the student
 * ordered them, so the examiner can cite "Chapter 3" back at them. An empty
 * approved chapter is marked rather than dropped: a chapter with a heading and
 * no substance is itself something an examiner should ask about, and silently
 * omitting it would hide that.
 */
export function buildThesisContext(source: ThesisSource): string {
  const parts = [
    `## TITLE\n${source.title.trim() || "(untitled)"}`,
    `## ABSTRACT\n${source.abstract.trim() || "(not stated in the thesis)"}`,
  ];

  for (const chapter of source.chapters) {
    parts.push(
      `## CHAPTER ${chapter.number}: ${chapter.title}\n${
        chapter.content.trim() || "(this chapter has been approved but is empty)"
      }`
    );
  }

  if (source.references.length > 0) {
    const cited = source.references
      .map((r) => `- ${r.resolvedTitle ?? r.doi}${r.resolvedYear ? ` (${r.resolvedYear})` : ""}`)
      .join("\n");
    parts.push(`## CITED REFERENCES\n${cited}`);
  }

  const full = parts.join("\n\n");
  return full.length > MAX_THESIS_CHARS ? `${full.slice(0, MAX_THESIS_CHARS)}\n\n[truncated]` : full;
}

/**
 * Title and abstract only, for the back-and-forth after the questions exist.
 *
 * Resending the whole thesis to mark every answer would spend the minute's
 * entire token budget on context the reference answer already carries.
 */
export function buildThesisBrief(source: ThesisSource): string {
  return `TITLE: ${source.title.trim()}\n\nABSTRACT: ${source.abstract.trim() || "(none)"}`;
}

/**
 * Enough substance to be worth examining at all.
 *
 * Counts words across the approved chapters. A student with chapters that are
 * approved but nearly empty gets told so, rather than getting a session of
 * questions the model invented out of headings.
 */
export function hasExaminableContent(source: ThesisSource): boolean {
  const body = source.chapters.map((c) => c.content).join(" ").trim();
  return Boolean(source.title.trim()) && body.split(/\s+/).filter(Boolean).length >= 60;
}

// --- pass 1: read the thesis ------------------------------------------------

export interface ThesisAnalysis {
  summary: string;
  findings: { focus: string; weakness: string; evidence: string }[];
}

/**
 * The single preparation prompt: read the thesis, then write the questions.
 *
 * Both happen in one request, and the order of the JSON keys is what makes it
 * genuinely sequential — a language model writes a response front to back, so
 * requiring "analysis" before "questions" forces it to commit to a reading and
 * then write questions conditioned on that reading. Asking in two separate
 * requests would be no more faithful, would double the latency, and would not
 * fit inside a single minute's token allowance.
 */
export function preparationMessages(thesis: string, depth: Depth) {
  const areas = FOCUS_AREAS.map((a) => `- ${a.key}: ${a.brief}`).join("\n");
  const perArea = questionsPerArea(depth);
  const total = perArea * FOCUS_AREAS.length;

  return [
    {
      role: "system" as const,
      content:
        "You are an external examiner preparing to sit on a thesis defence panel. You read a " +
        "thesis, identify precisely where it is vulnerable, and only then write the questions you " +
        "will put to the candidate. You are rigorous and specific, and you never invent content " +
        "that is not in the text. Respond only in valid JSON.",
    },
    {
      role: "user" as const,
      content: `Prepare for this defence in two stages, in this order.

STAGE 1 — read the thesis.
For each of the four areas below, identify the single most significant weakness actually present in this text, and note the part of the thesis that shows it. If the thesis does not address an area at all, say so plainly: an unaddressed area is itself the weakness.

${areas}

STAGE 2 — write the questions, using only what you found in stage 1.
1. Exactly ${perArea} question${perArea === 1 ? "" : "s"} per area — ${total} in total, in the order LIMITATIONS, DATA_VALIDATION, ETHICS, METHODOLOGY.
2. Every question must be answerable from this thesis and must refer to something it actually says. Never ask about data, experiments or claims the text does not contain.
3. Nothing generic. "What motivated your research?" and "What are your future plans?" are worthless at a defence and must not appear.
4. One question per entry — do not stack several together with "and" or a semicolon.
5. For each question, write the strongest answer this thesis supports, in two to four sentences drawn from its text. Where the thesis does not support a good answer, state what the candidate would honestly have to concede.

Return strictly this JSON shape, with the analysis first:
{
  "analysis": {
    "summary": "two or three sentences on what this thesis claims and how well its text supports it",
    "findings": [
      { "focus": "LIMITATIONS", "weakness": "...", "evidence": "the part of the thesis that shows it" }
    ]
  },
  "questions": [
    { "focus": "LIMITATIONS", "question": "...", "referenceAnswer": "..." }
  ]
}

THESIS
------
${thesis}`,
    },
  ];
}

export function parseAnalysis(raw: unknown): ThesisAnalysis {
  const source = (raw as { analysis?: Partial<ThesisAnalysis> })?.analysis ?? (raw as Partial<ThesisAnalysis> | null);
  const findings = Array.isArray(source?.findings) ? source.findings : [];

  return {
    summary: typeof source?.summary === "string" ? source.summary.trim() : "",
    findings: findings
      .filter((f) => f && typeof f.weakness === "string")
      .map((f) => ({
        focus: String(f.focus ?? "").toUpperCase(),
        weakness: String(f.weakness ?? "").trim(),
        evidence: String(f.evidence ?? "").trim(),
      })),
  };
}

// --- the questions themselves ----------------------------------------------

export interface PreparedQuestion {
  focus: FocusKey;
  question: string;
  referenceAnswer: string;
}

/**
 * Validates the model's questions.
 *
 * Anything without a real question and a real reference answer is dropped, and
 * unknown focus values are discarded rather than shown under a made-up heading.
 * Questions are then returned grouped by area in the order the requirement
 * lists them, so a session always opens on limitations and ends on methodology
 * regardless of what order the model happened to emit.
 */
export function parseQuestions(raw: unknown, depth: Depth): PreparedQuestion[] {
  const source = raw as { questions?: unknown } | null;
  const list = Array.isArray(source?.questions) ? source.questions : [];
  const perArea = questionsPerArea(depth);

  const valid: PreparedQuestion[] = [];
  for (const entry of list) {
    const item = entry as Partial<PreparedQuestion>;
    const focus = String(item?.focus ?? "").toUpperCase() as FocusKey;
    const question = String(item?.question ?? "").trim();
    const referenceAnswer = String(item?.referenceAnswer ?? "").trim();

    if (!FOCUS_AREAS.some((a) => a.key === focus)) continue;
    if (question.length < 15 || referenceAnswer.length < 15) continue;

    valid.push({ focus, question, referenceAnswer });
  }

  return FOCUS_AREAS.flatMap((area) =>
    valid.filter((q) => q.focus === area.key).slice(0, perArea)
  );
}

// --- the live exchange ------------------------------------------------------

/** The model puts its mark on the first line so the UI can show it immediately. */
export const SCORE_PREFIX = "SCORE:";

export function evaluationMessages(
  thesis: string,
  question: string,
  referenceAnswer: string,
  studentAnswer: string
) {
  return [
    {
      role: "system" as const,
      content:
        "You are an external examiner at a thesis defence, responding to the candidate's answer. " +
        "You are demanding but fair, and you never flatter. You judge only what the candidate said, " +
        "against what their thesis supports.",
    },
    {
      role: "user" as const,
      content: `Assess the candidate's answer.

Your first line must be exactly "${SCORE_PREFIX} n" where n is an integer from 0 to 10.
Then leave a blank line and write your response to the candidate, in under 130 words:
- say what the answer got right, if anything;
- name what it missed or got wrong, concretely;
- if the thesis supports a stronger answer, say what the candidate should have drawn on;
- close with one short follow-up remark an examiner would actually make.

Address the candidate directly as "you". Do not repeat the question back. Do not use headings or bullet points.

QUESTION
${question}

WHAT THE THESIS SUPPORTS
${referenceAnswer}

THE CANDIDATE'S ANSWER
${studentAnswer}

THESIS FOR REFERENCE
------
${thesis}`,
    },
  ];
}

/** Splits "SCORE: 7" off the front of an evaluation, returning both parts. */
export function splitEvaluation(raw: string): { score: number | null; text: string } {
  const match = new RegExp(`^\\s*${SCORE_PREFIX}\\s*(\\d{1,2})(?:\\s*/\\s*10)?`, "i").exec(raw);
  if (!match) return { score: null, text: raw.trim() };

  const score = Math.max(0, Math.min(10, Number(match[1])));
  return { score, text: raw.slice(match[0].length).trim() };
}

/** A session's mark: the mean of what was answered, on the same 0-10 scale. */
export function overallScore(scores: (number | null)[]): number | null {
  const marked = scores.filter((s): s is number => typeof s === "number");
  if (marked.length === 0) return null;
  return Math.round((marked.reduce((sum, s) => sum + s, 0) / marked.length) * 10) / 10;
}
