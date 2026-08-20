import "server-only";
import prisma from "@/lib/prisma";
import { GroqService } from "@/services/groq.service";
import {
  buildThesisBrief,
  buildThesisContext,
  evaluationMessages,
  hasExaminableContent,
  overallScore,
  parseAnalysis,
  parseQuestions,
  preparationMessages,
  splitEvaluation,
  type Depth,
  type ThesisAnalysis,
  type ThesisSource,
} from "@/lib/defense";

/**
 * Module 3 (Member 2): AI Mock Defense Simulator.
 *
 * Pulls the student's thesis out of the database, has the examiner read it,
 * and turns the reading into a set of questions with the answers the thesis
 * itself supports. The exchange that follows is stored question by question so
 * a student can come back to a session, and so a supervisor could review what
 * was asked and how it went.
 */

export interface DefenseQuestionView {
  id: string;
  position: number;
  focus: string | null;
  question: string;
  answer: string | null;
  evaluation: string | null;
  score: number | null;
  /** Withheld until the student has answered, so it cannot be copied. */
  referenceAnswer: string | null;
}

export interface DefenseSessionView {
  id: string;
  createdAt: string;
  isActive: boolean;
  overallScore: number | null;
  analysis: ThesisAnalysis | null;
  questions: DefenseQuestionView[];
}

export interface DefenseState {
  ready: boolean;
  blocker: string | null;
  thesisTitle: string | null;
  session: DefenseSessionView | null;
}

async function loadThesis(studentId: string) {
  return prisma.thesisProposal.findUnique({
    where: { studentId },
    select: {
      id: true,
      title: true,
      abstract: true,
      problemStatement: true,
      researchObjectives: true,
      methodologyOutline: true,
      methodology: true,
      expectedContribution: true,
      limitations: true,
      references: {
        select: { doi: true, resolvedTitle: true, resolvedYear: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

/**
 * The reference answer is hidden until the student has answered that question.
 *
 * The point of the exercise is to make the candidate retrieve it themselves; a
 * model answer visible beside the question turns a rehearsal into a reading
 * comprehension test.
 */
function toQuestionView(row: {
  id: string;
  position: number;
  focus: string | null;
  question: string;
  answer: string | null;
  evaluation: string | null;
  score: number | null;
  referenceAnswer: string | null;
}): DefenseQuestionView {
  return {
    id: row.id,
    position: row.position,
    focus: row.focus,
    question: row.question,
    answer: row.answer,
    evaluation: row.evaluation,
    score: row.score,
    referenceAnswer: row.answer ? row.referenceAnswer : null,
  };
}

export class DefenseService {
  /** The student's current session, or why one cannot start. */
  static async state(studentId: string): Promise<DefenseState> {
    const thesis = await loadThesis(studentId);

    if (!thesis) {
      return {
        ready: false,
        blocker: "You have not started a thesis proposal yet, so there is nothing to defend.",
        thesisTitle: null,
        session: null,
      };
    }

    const ready = hasExaminableContent(thesis as ThesisSource);
    const session = await DefenseService.latestSession(studentId);

    return {
      ready,
      blocker: ready
        ? null
        : "Your thesis needs a title and a substantial body before an examiner can question it.",
      thesisTitle: thesis.title.trim() || null,
      session,
    };
  }

  static async latestSession(studentId: string): Promise<DefenseSessionView | null> {
    const session = await prisma.mockDefenseSession.findFirst({
      where: { userId: studentId },
      orderBy: { createdAt: "desc" },
      include: { interactions: { orderBy: { position: "asc" } } },
    });
    if (!session) return null;

    let analysis: ThesisAnalysis | null = null;
    if (session.analysis) {
      try {
        analysis = JSON.parse(session.analysis) as ThesisAnalysis;
      } catch {
        // A session written by an older shape is still perfectly usable.
      }
    }

    return {
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      isActive: session.isActive,
      overallScore: session.overallScore,
      analysis,
      questions: session.interactions.map(toQuestionView),
    };
  }

  /**
   * Starts a session: read the thesis, then write the questions.
   *
   * Two passes rather than one. Asking for questions directly produces the
   * generic filler a candidate learns nothing from; making the model commit to
   * a reading first, and then write only from that reading, is what keeps every
   * question anchored to something the thesis actually says.
   */
  static async start(studentId: string, depth: Depth): Promise<DefenseSessionView> {
    const thesis = await loadThesis(studentId);
    if (!thesis) throw new Error("No thesis proposal to defend.");

    const source = thesis as ThesisSource;
    if (!hasExaminableContent(source)) {
      throw new Error("This thesis does not have enough content to examine.");
    }

    const context = buildThesisContext(source);

    // One request, but the response is ordered: the reading is written before
    // the questions, so the questions are produced from it rather than beside
    // it. Splitting this into two calls would double the latency and overrun
    // the per-minute token allowance without making the sequence any more real.
    const prepared = await GroqService.completeJson<unknown>({
      messages: preparationMessages(context, depth),
      effort: "medium",
      temperature: 0.4,
      maxTokens: 3000,
    });

    const analysis = parseAnalysis(prepared);
    const questions = parseQuestions(prepared, depth);

    if (questions.length === 0) {
      throw new Error("The examiner could not form questions from this thesis. Try again.");
    }

    // Only one session is live at a time; earlier ones stay readable but closed.
    await prisma.mockDefenseSession.updateMany({
      where: { userId: studentId, isActive: true },
      data: { isActive: false },
    });

    const session = await prisma.mockDefenseSession.create({
      data: {
        userId: studentId,
        proposalId: thesis.id,
        analysis: JSON.stringify(analysis),
        interactions: {
          create: questions.map((q, i) => ({
            position: i,
            focus: q.focus,
            question: q.question,
            referenceAnswer: q.referenceAnswer,
          })),
        },
      },
      include: { interactions: { orderBy: { position: "asc" } } },
    });

    return {
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      isActive: session.isActive,
      overallScore: session.overallScore,
      analysis,
      questions: session.interactions.map(toQuestionView),
    };
  }

  /**
   * Answers one question, streaming the examiner's response back as it arrives.
   *
   * The answer is recorded before the model is called, so a dropped connection
   * loses the critique rather than the candidate's work. The mark and the
   * critique are saved once the stream completes.
   */
  static async *answer(
    studentId: string,
    interactionId: string,
    studentAnswer: string
  ): AsyncGenerator<string> {
    const interaction = await prisma.defenseInteraction.findFirst({
      where: { id: interactionId, session: { userId: studentId } },
      include: { session: { select: { id: true, proposalId: true } } },
    });
    if (!interaction) throw new Error("That question is not part of one of your sessions.");

    const thesis = await loadThesis(studentId);
    if (!thesis) throw new Error("No thesis proposal to defend.");

    await prisma.defenseInteraction.update({
      where: { id: interaction.id },
      data: { answer: studentAnswer },
    });

    // Only the title and abstract go along here. The reference answer already
    // carries what the thesis says about this question, so resending the whole
    // document to mark one reply would spend the minute's token budget on
    // context that is not doing any work.
    const messages = evaluationMessages(
      buildThesisBrief(thesis as ThesisSource),
      interaction.question,
      interaction.referenceAnswer ?? "(no reference answer was recorded)",
      studentAnswer
    );

    let full = "";
    for await (const chunk of GroqService.stream({
      messages,
      effort: "low",
      temperature: 0.3,
      maxTokens: 900,
    })) {
      full += chunk;
      yield chunk;
    }

    const { score, text } = splitEvaluation(full);

    await prisma.defenseInteraction.update({
      where: { id: interaction.id },
      data: { evaluation: text, score },
    });

    // The session mark is the mean of what has been answered so far, so it is
    // meaningful mid-session rather than only at the end.
    const marks = await prisma.defenseInteraction.findMany({
      where: { sessionId: interaction.sessionId },
      select: { score: true },
    });

    await prisma.mockDefenseSession.update({
      where: { id: interaction.sessionId },
      data: { overallScore: overallScore(marks.map((m) => m.score)) },
    });
  }

  /** Closes the session once the candidate has been through every question. */
  static async finish(studentId: string, sessionId: string): Promise<void> {
    await prisma.mockDefenseSession.updateMany({
      where: { id: sessionId, userId: studentId },
      data: { isActive: false },
    });
  }
}
