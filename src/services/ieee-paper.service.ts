import "server-only";
import { ProposalStatus, RequestStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  renderIeeePaper,
  type IeeeAuthor,
  type IeeeBlock,
  type IeeePaper,
  type IeeeSection,
  type IeeeSubsection,
} from "@/lib/ieee-layout";

/**
 * Module 3 (Member 2): IEEE Conference Paper Transpiler.
 *
 * The paper's body comes from the student's **locked chapters**, not from their
 * proposal.
 *
 * That distinction is the whole point of this module. A proposal is written
 * before the work exists: it states what the student intends to do, and has no
 * results in it because there are none yet. A conference paper reports what was
 * done and what was found. Sourcing the body from the proposal produced a
 * typeset proposal wearing a paper's clothes — the giveaway being that the old
 * fixed section plan had no Results section at all, because there was nothing to
 * put in one.
 *
 * Locked chapters are the right source because locking is the point at which a
 * chapter is committed to the final thesis (see the Chapter Approval Workflow,
 * Module 3 Member 3). Approved-but-unlocked chapters are deliberately excluded:
 * an approved chapter can still be reopened and rewritten, which would let the
 * paper drift away from the text it claims to transpile.
 *
 * The proposal is still the approval gate, and still supplies the title and
 * abstract — the two fields it legitimately owns, since the student wrote them
 * as the work's identity rather than as a plan for it.
 *
 * The page starts empty regardless. Nothing is carried in that the student did
 * not ask for, and authorship order in particular is a decision about credit
 * that no schema can infer.
 *
 * Nothing is persisted. A paper is a pure function of its inputs, so storing a
 * copy would only create a second version to keep in sync with the first.
 */

/**
 * A section is submitted under its chapter's id.
 *
 * Chapter titles are free text, so there is no fixed plan to map them onto —
 * and guessing which chapter is "the methodology one" would be wrong exactly
 * when a student structures their thesis unusually. Each locked chapter becomes
 * one section, in thesis order, under its own title.
 */
export type SectionField = string;

/** One section's box on the page. */
export interface PaperSectionField {
  field: SectionField;
  heading: string;
}

/** Bullet markers a student is likely to have typed into a textarea. */
const BULLET = /^\s*(?:[-*•·]|\(?\d+[.)]|[a-z][.)])\s+/i;
/** A lightweight subsection marker, surfaced in the UI so it is discoverable. */
const SUBHEADING = /^\s*##\s+(.+?)\s*$/;

export interface PaperBlocker {
  code: "NO_PROPOSAL" | "NOT_APPROVED" | "NO_LOCKED_CHAPTERS" | "NO_TITLE" | "NO_ABSTRACT" | "NO_BODY";
  message: string;
}

export interface PaperOutlineSection {
  heading: string;
  words: number;
  subsections: string[];
}

/** How a person is eligible to appear on the paper. */
export type AuthorRelation = "you" | "teammate" | "supervisor";

export interface PaperCandidate {
  id: string;
  name: string;
  affiliation: string;
  relation: AuthorRelation;
}

export interface PaperOutline {
  title: string;
  authors: { name: string; affiliation: string }[];
  abstractWords: number;
  sections: PaperOutlineSection[];
  referenceCount: number;
  /** Present only once the paper is renderable. */
  pageCount?: number;
}

export interface PaperStatus {
  ready: boolean;
  blockers: PaperBlocker[];
  proposalStatus: ProposalStatus | null;
  outline: PaperOutline | null;
  /** Everyone the student may credit: themselves, their team, their supervisor. */
  candidates: PaperCandidate[];
  /** Every section the paper can carry, so each gets a box. */
  sectionFields: PaperSectionField[];
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Splits a section body into paragraphs, bullets and subsections.
 *
 * Students type these into a plain textarea, so the only structure available is
 * blank lines and the bullet markers they typed by hand. Both are honoured; a
 * "## " line opens an IEEE subsection, which is the one piece of markup the UI
 * advertises.
 */
export function parseFieldBlocks(raw: string): { blocks: IeeeBlock[]; subsections: IeeeSubsection[] } {
  const blocks: IeeeBlock[] = [];
  const subsections: IeeeSubsection[] = [];
  let target: IeeeBlock[] = blocks;

  const chunks = raw.replace(/\r\n?/g, "\n").split(/\n{2,}/);

  for (const chunk of chunks) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    // A run of consecutive bullet lines becomes one bullet per line; anything
    // else is joined back into a single justified paragraph.
    let pending: string[] = [];
    const flushParagraph = () => {
      if (pending.length === 0) return;
      target.push({ kind: "paragraph", text: pending.join(" ") });
      pending = [];
    };

    for (const line of lines) {
      const sub = SUBHEADING.exec(line);
      if (sub) {
        flushParagraph();
        const section: IeeeSubsection = { heading: sub[1], blocks: [] };
        subsections.push(section);
        target = section.blocks;
        continue;
      }

      if (BULLET.test(line)) {
        flushParagraph();
        target.push({ kind: "bullet", text: line.replace(BULLET, "") });
        continue;
      }

      pending.push(line);
    }
    flushParagraph();
  }

  return { blocks, subsections };
}

/**
 * The reference list exactly as the student typed it: one entry per line, with
 * any bracketed number they included stripped, since the engine numbers the
 * list itself.
 */
export function parseReferences(input: string[] | undefined): string[] {
  return (input ?? [])
    .flatMap((line) => line.split("\n"))
    .map((line) => line.trim().replace(/^\[\d+\]\s*/, ""))
    .filter(Boolean)
    .slice(0, 100);
}

/**
 * The proposal — for the approval gate and the student's own identity — the
 * locked chapters that supply the body, and everyone they may credit.
 *
 * A team is implicit in this schema: it is the set of TeamInvite rows that
 * reached ACCEPTED, in either direction. The supervisor comes from an accepted
 * MatchRequest. Reading both here is what stops the author picker from being a
 * free-text field in which anyone could be credited with anyone's work.
 */
async function loadContext(studentId: string) {
  const [proposal, chapters, invites, match] = await Promise.all([
    prisma.thesisProposal.findUnique({
      where: { studentId },
      select: {
        status: true,
        student: { select: { id: true, name: true, email: true, department: true } },
      },
    }),
    // LOCKED only. An approved chapter can still be reopened by the student or
    // withdrawn by the supervisor, so typesetting one would mean the paper's
    // source could change underneath it.
    prisma.thesisChapter.findMany({
      where: { studentId, status: "LOCKED" },
      orderBy: { number: "asc" },
      select: { id: true, number: true, title: true, content: true },
    }),
    prisma.teamInvite.findMany({
      where: {
        status: RequestStatus.ACCEPTED,
        OR: [{ fromUserId: studentId }, { toUserId: studentId }],
      },
      include: {
        from: { select: { id: true, name: true, email: true, department: true } },
        to: { select: { id: true, name: true, email: true, department: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.matchRequest.findFirst({
      where: { studentId, status: RequestStatus.ACCEPTED },
      include: {
        supervisor: {
          include: { user: { select: { id: true, name: true, email: true, department: true } } },
        },
      },
    }),
  ]);

  type Person = { id: string; name: string; email: string; department: string | null; relation: AuthorRelation };
  const people = new Map<string, Person>();

  if (proposal) people.set(proposal.student.id, { ...proposal.student, relation: "you" });

  for (const invite of invites) {
    const mate = invite.fromUserId === studentId ? invite.to : invite.from;
    if (mate.id === studentId || people.has(mate.id)) continue;
    people.set(mate.id, { ...mate, relation: "teammate" });
  }

  if (match && !people.has(match.supervisor.user.id)) {
    people.set(match.supervisor.user.id, { ...match.supervisor.user, relation: "supervisor" });
  }

  return { proposal, chapters, people };
}

export interface PaperOptions {
  /** Overrides the affiliation line under every author. */
  affiliation?: string;
  /** Conference identification line repeated at the top of each page. */
  runningHeader?: string;
  title?: string;
  abstract?: string;
  /** Index terms, printed under the abstract. */
  indexTerms?: string[];
  /** User ids in byline order. Anyone not eligible is ignored. */
  authorIds?: string[];
  /** Reference entries, one per line, in citation order. */
  references?: string[];
  /** Section bodies, keyed by the plan's field name. */
  sections?: Partial<Record<SectionField, string>>;
}

const DEFAULT_AFFILIATION = "Department of Computer Science and Engineering";

export class IeeePaperService {
  /**
   * What the transpiler would produce, and what is stopping it.
   *
   * Returned for both the ready and the not-ready case so the page can explain
   * itself: a student blocked by a pending approval should see which gate they
   * are behind, not an empty screen.
   */
  static async status(studentId: string, options: PaperOptions = {}): Promise<PaperStatus> {
    const context = await loadContext(studentId);
    const candidates = IeeePaperService.candidates(context.people, options);
    const sectionFields = IeeePaperService.sectionFields(context);

    if (!context.proposal) {
      return {
        ready: false,
        proposalStatus: null,
        outline: null,
        candidates,
        sectionFields,
        blockers: [{ code: "NO_PROPOSAL", message: "You have not started a thesis proposal yet." }],
      };
    }

    const blockers: PaperBlocker[] = [];
    if (context.proposal.status !== ProposalStatus.APPROVED) {
      blockers.push({
        code: "NOT_APPROVED",
        message:
          "Your proposal has not been approved yet. The transpiler only typesets for students a supervisor has signed off.",
      });
    }
    if (context.chapters.length === 0) {
      blockers.push({
        code: "NO_LOCKED_CHAPTERS",
        message:
          "No chapters are locked yet. A paper reports finished work, so its sections come from chapters your supervisor has locked.",
      });
    }

    const paper = IeeePaperService.buildPaper(context, options);

    if (!paper.title.trim()) {
      blockers.push({ code: "NO_TITLE", message: "Enter a paper title." });
    }
    if (!paper.abstract.trim()) {
      blockers.push({ code: "NO_ABSTRACT", message: "Enter an abstract." });
    }
    if (paper.sections.length === 0) {
      blockers.push({ code: "NO_BODY", message: "Fill at least one section." });
    }

    const ready = blockers.length === 0;

    const outline: PaperOutline = {
      title: paper.title,
      authors: paper.authors.map((a) => ({ name: a.name, affiliation: a.affiliation })),
      abstractWords: countWords(paper.abstract),
      sections: paper.sections.map((section) => ({
        heading: section.heading,
        words:
          section.blocks.reduce((sum, b) => sum + countWords(b.text), 0) +
          section.subsections.reduce(
            (sum, sub) => sum + sub.blocks.reduce((s, b) => s + countWords(b.text), 0),
            0
          ),
        subsections: section.subsections.map((sub) => sub.heading),
      })),
      referenceCount: paper.references.length,
      // Rendering is the only honest way to know the page count, and it is
      // cheap enough to do for the preview as well as the download.
      pageCount: ready ? renderIeeePaper(paper).pageCount : undefined,
    };

    return {
      ready,
      blockers,
      proposalStatus: context.proposal.status,
      outline,
      candidates,
      sectionFields,
    };
  }

  /** One box per locked chapter, in thesis order, headed by the chapter's own title. */
  private static sectionFields(
    context: Awaited<ReturnType<typeof loadContext>>
  ): PaperSectionField[] {
    return context.chapters.map((chapter) => ({ field: chapter.id, heading: chapter.title }));
  }

  /**
   * The paper's identity, from the proposal: title and abstract only.
   *
   * These are the two fields a proposal legitimately still owns — the student
   * wrote them to name the work, not to plan it, so they survive the work being
   * done. Everything else the proposal holds is intent, and intent does not
   * belong in a paper that reports results.
   *
   * Deliberately a separate call rather than part of the status payload: the
   * page starts empty, and shipping this on every keystroke-pause refresh would
   * be both wasteful and an invitation to prefill something the student never
   * asked for. It is fetched once, when the button is pressed.
   */
  static async identity(studentId: string): Promise<{ title: string; abstract: string } | null> {
    const proposal = await prisma.thesisProposal.findUnique({
      where: { studentId },
      select: { title: true, abstract: true },
    });
    if (!proposal) return null;

    return { title: proposal.title.trim(), abstract: proposal.abstract.trim() };
  }

  /**
   * The paper's body, from the student's locked chapters.
   *
   * Keyed by chapter id so the text lands in the box that belongs to it, and so
   * a chapter renamed between load and submit still matches.
   */
  static async chapterBodies(studentId: string): Promise<{
    sections: Record<string, string>;
    chapters: { id: string; number: number; title: string; words: number }[];
  }> {
    const chapters = await prisma.thesisChapter.findMany({
      where: { studentId, status: "LOCKED" },
      orderBy: { number: "asc" },
      select: { id: true, number: true, title: true, content: true },
    });

    const sections: Record<string, string> = {};
    for (const chapter of chapters) {
      const text = chapter.content.trim();
      if (text) sections[chapter.id] = text;
    }

    return {
      sections,
      chapters: chapters.map((c) => ({
        id: c.id,
        number: c.number,
        title: c.title,
        words: countWords(c.content.trim()),
      })),
    };
  }

  /** The finished PDF, plus a filename derived from the paper's own title. */
  static async render(
    studentId: string,
    options: PaperOptions = {}
  ): Promise<{ buffer: Buffer; fileName: string; pageCount: number } | null> {
    const context = await loadContext(studentId);
    if (!context.proposal || context.proposal.status !== ProposalStatus.APPROVED) return null;
    // Same gate as status(): no locked chapters means there is no finished work
    // to report, whatever was typed into the boxes.
    if (context.chapters.length === 0) return null;

    const paper = IeeePaperService.buildPaper(context, options);
    // A paper with no title and nothing in it is not a paper; refusing here
    // keeps the API honest even when a caller skips the status check.
    if (!paper.title.trim() || paper.sections.length === 0) return null;

    const { buffer, pageCount } = renderIeeePaper(paper);

    const slug =
      paper.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 60) || "ieee-paper";

    return { buffer, fileName: `${slug}-ieee.pdf`, pageCount };
  }

  /** Everyone creditable, in a stable order: the student, their team, then their supervisor. */
  private static candidates(
    people: Awaited<ReturnType<typeof loadContext>>["people"],
    options: PaperOptions
  ): PaperCandidate[] {
    const rank: Record<AuthorRelation, number> = { you: 0, teammate: 1, supervisor: 2 };
    return [...people.values()]
      .sort((a, b) => rank[a.relation] - rank[b.relation] || a.name.localeCompare(b.name))
      .map((p) => ({
        id: p.id,
        name: p.name,
        affiliation: options.affiliation?.trim() || p.department?.trim() || DEFAULT_AFFILIATION,
        relation: p.relation,
      }));
  }

  /** Submitted options to the layout engine's document model. */
  private static buildPaper(
    context: Awaited<ReturnType<typeof loadContext>>,
    options: PaperOptions
  ): IeeePaper {
    const affiliationFor = (department: string | null) =>
      options.affiliation?.trim() || department?.trim() || DEFAULT_AFFILIATION;

    // The byline is exactly what was asked for, in the order it was asked for,
    // filtered to people the student may actually credit. An empty or fully
    // ineligible selection falls back to the student alone rather than
    // producing a paper with no author at all.
    const chosen = (options.authorIds ?? [])
      .map((id) => context.people.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));

    const me = context.proposal ? context.people.get(context.proposal.student.id) : undefined;
    const byline = chosen.length > 0 ? chosen : me ? [me] : [];

    const authors: IeeeAuthor[] = byline.map((p) => ({
      name: p.name,
      affiliation: affiliationFor(p.department),
      email: p.email,
    }));

    // One section per locked chapter, in thesis order. A chapter whose box was
    // left empty is skipped rather than emitted blank, so a student can drop a
    // chapter from the paper without unlocking anything.
    const sections: IeeeSection[] = [];
    for (const chapter of context.chapters) {
      const text = options.sections?.[chapter.id]?.trim();
      if (!text) continue;
      const { blocks, subsections } = parseFieldBlocks(text);
      sections.push({ heading: chapter.title, blocks, subsections });
    }

    return {
      title: options.title?.trim() ?? "",
      authors,
      abstract: options.abstract?.trim() ?? "",
      indexTerms: (options.indexTerms ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 8),
      sections,
      references: parseReferences(options.references),
      runningHeader: options.runningHeader?.trim() || undefined,
    };
  }
}
