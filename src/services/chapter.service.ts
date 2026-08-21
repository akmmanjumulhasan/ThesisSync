import "server-only";
import { Prisma, ProposalStatus, RequestStatus, Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { NotificationService } from "@/services/notification.service";
import {
  MAX_CHAPTERS,
  MAX_COMMENT_LENGTH,
  MAX_CONTENT_LENGTH,
  MAX_TITLE_LENGTH,
  checkTransition,
  isDeletable,
  isEditable,
  type ChapterAction,
  type ChapterStatus,
} from "@/lib/chapters";

/**
 * Module 3 (Member 3): Chapter Approval Workflow — every database read and
 * write the pipeline performs.
 *
 * Two invariants are enforced here rather than in the route handler, so they
 * hold no matter which caller arrives:
 *
 *  1. A status never changes without an audit row being written in the same
 *     transaction. `transitionChapter` is the only function that touches
 *     `status`, and it always appends. There is no path that moves a chapter
 *     quietly.
 *  2. A supervisor only ever reaches their own students. Every supervisor entry
 *     point re-derives that link from an ACCEPTED MatchRequest at call time
 *     instead of trusting the role on the session.
 */

/**
 * The trail, newest first. `id` breaks ties on createdAt, because two entries
 * written in the same transaction can share a timestamp and an unstable order
 * would shuffle the history between page loads.
 *
 * The actor relation is deliberately not joined: actorName is denormalised onto
 * the row precisely so the trail reads correctly without it.
 */
const AUDIT_INCLUDE = {
  audit: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
} satisfies Prisma.ThesisChapterInclude;

/** Every chapter of this student's thesis, in thesis order, newest audit first. */
export async function listChapters(studentId: string) {
  return prisma.thesisChapter.findMany({
    where: { studentId },
    orderBy: { number: "asc" },
    include: AUDIT_INCLUDE,
  });
}

export interface ChapterGate {
  /** Whether chapter work is unlocked at all. */
  open: boolean;
  hasSupervisor: boolean;
  supervisorName: string | null;
  proposalStatus: ProposalStatus | null;
  /** Why it is closed, phrased for the student. Null when open. */
  reason: string | null;
}

/**
 * Chapter writing is gated on an approved proposal.
 *
 * This is not a rule this feature invented — the Structured Thesis Proposal
 * Builder (Module 1, Member 3) already tells the student "chapter writing can
 * begin" the moment their proposal is approved, and describes itself as the
 * gate before chapter writing. Reading the same condition here is what makes
 * that promise true rather than decorative.
 */
export async function chapterGate(studentId: string): Promise<ChapterGate> {
  const [proposal, accepted] = await Promise.all([
    prisma.thesisProposal.findUnique({
      where: { studentId },
      select: { status: true },
    }),
    prisma.matchRequest.findFirst({
      where: { studentId, status: RequestStatus.ACCEPTED },
      include: { supervisor: { include: { user: { select: { name: true } } } } },
    }),
  ]);

  const supervisorName = accepted?.supervisor.user.name ?? null;
  const proposalStatus = proposal?.status ?? null;

  if (!accepted) {
    return {
      open: false,
      hasSupervisor: false,
      supervisorName: null,
      proposalStatus,
      reason: "Match with a supervisor before starting chapter work — every stage of the pipeline needs someone to approve it.",
    };
  }
  if (proposalStatus !== ProposalStatus.APPROVED) {
    return {
      open: false,
      hasSupervisor: true,
      supervisorName,
      proposalStatus,
      reason:
        proposalStatus === null
          ? "Your thesis proposal has to be approved before chapter work opens up."
          : `Your proposal is at ${proposalStatus.toLowerCase()}. Chapter work opens once it is approved.`,
    };
  }

  return { open: true, hasSupervisor: true, supervisorName, proposalStatus, reason: null };
}

/**
 * The supervisor's queue: every chapter belonging to a student whose
 * supervision request this supervisor accepted, that is currently sitting on
 * their desk.
 *
 * APPROVED is in the queue on purpose. An approved chapter still needs an
 * explicit lock, and leaving it out would hide the one remaining action from
 * the only person who can take it.
 */
export async function supervisorQueue(supervisorUserId: string) {
  const profile = await prisma.supervisorProfile.findUnique({
    where: { userId: supervisorUserId },
    select: { id: true },
  });
  if (!profile) return [];

  const accepted = await prisma.matchRequest.findMany({
    where: { supervisorId: profile.id, status: RequestStatus.ACCEPTED },
    select: { studentId: true },
  });
  const studentIds = accepted.map((r) => r.studentId);
  if (studentIds.length === 0) return [];

  return prisma.thesisChapter.findMany({
    where: {
      studentId: { in: studentIds },
      status: { in: ["SUBMITTED", "IN_REVIEW", "APPROVED"] },
    },
    // Longest wait first; a chapter with no submission timestamp cannot be in
    // this set, but nulls sort last regardless so the order stays defined.
    orderBy: [{ submittedAt: "asc" }, { number: "asc" }],
    include: {
      ...AUDIT_INCLUDE,
      student: { select: { id: true, name: true, email: true } },
    },
  });
}

/** True when this supervisor is the student's own accepted supervisor. */
export async function supervises(supervisorUserId: string, studentId: string): Promise<boolean> {
  const profile = await prisma.supervisorProfile.findUnique({
    where: { userId: supervisorUserId },
    select: { id: true },
  });
  if (!profile) return false;

  const link = await prisma.matchRequest.findUnique({
    where: { studentId_supervisorId: { studentId, supervisorId: profile.id } },
    select: { status: true },
  });
  return link?.status === RequestStatus.ACCEPTED;
}

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/**
 * Add a chapter to the end of the thesis.
 *
 * The number is derived from the current maximum rather than from a count, so
 * it stays correct after a middle chapter has been removed and the rest
 * renumbered.
 */
export async function createChapter(studentId: string, rawTitle: string, actorName: string) {
  const title = rawTitle.trim().slice(0, MAX_TITLE_LENGTH);
  if (!title) {
    return { ok: false as const, status: 400, error: "Give the chapter a title." };
  }

  const existing = await prisma.thesisChapter.count({ where: { studentId } });
  if (existing >= MAX_CHAPTERS) {
    return { ok: false as const, status: 400, error: `A thesis is capped at ${MAX_CHAPTERS} chapters here.` };
  }

  const last = await prisma.thesisChapter.findFirst({
    where: { studentId },
    orderBy: { number: "desc" },
    select: { number: true },
  });

  const chapter = await prisma.$transaction(async (tx) => {
    const created = await tx.thesisChapter.create({
      data: { studentId, number: (last?.number ?? 0) + 1, title },
    });
    await tx.chapterAuditEntry.create({
      data: {
        chapterId: created.id,
        event: "CREATED",
        fromStatus: null,
        toStatus: "DRAFT",
        version: 1,
        actorId: studentId,
        actorName,
        actorRole: Role.STUDENT,
      },
    });
    return created;
  });

  return { ok: true as const, data: chapter };
}

/** Save a student's edits. Only ever legal while the chapter is in DRAFT. */
export async function saveChapter(
  studentId: string,
  chapterId: string,
  rawTitle: string | undefined,
  rawContent: string | undefined
) {
  const chapter = await prisma.thesisChapter.findUnique({ where: { id: chapterId } });
  if (!chapter || chapter.studentId !== studentId) {
    return { ok: false as const, status: 404, error: "Chapter not found." };
  }
  if (!isEditable(chapter.status as ChapterStatus)) {
    return {
      ok: false as const,
      status: 409,
      error:
        chapter.status === "LOCKED"
          ? "This chapter is locked and can no longer be edited."
          : "This chapter is with your supervisor. It becomes editable again only if they return it.",
    };
  }

  const title = typeof rawTitle === "string" ? rawTitle.trim().slice(0, MAX_TITLE_LENGTH) : undefined;
  if (title !== undefined && !title) {
    return { ok: false as const, status: 400, error: "A chapter needs a title." };
  }
  const content = typeof rawContent === "string" ? rawContent.slice(0, MAX_CONTENT_LENGTH) : undefined;

  const saved = await prisma.thesisChapter.update({
    where: { id: chapterId },
    data: { ...(title !== undefined && { title }), ...(content !== undefined && { content }) },
  });
  return { ok: true as const, data: saved };
}

/**
 * Remove a chapter that never entered the pipeline, closing the numbering gap
 * behind it.
 *
 * The renumbering runs in ascending order inside the same transaction, so each
 * update moves into a slot the previous one has already vacated and the
 * @@unique([studentId, number]) constraint is never momentarily violated.
 */
export async function deleteChapter(studentId: string, chapterId: string) {
  const chapter = await prisma.thesisChapter.findUnique({ where: { id: chapterId } });
  if (!chapter || chapter.studentId !== studentId) {
    return { ok: false as const, status: 404, error: "Chapter not found." };
  }
  if (!isDeletable(chapter.status as ChapterStatus, chapter.submittedAt)) {
    return {
      ok: false as const,
      status: 409,
      error: "This chapter has already been through review, so its approval record can't be deleted.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.thesisChapter.delete({ where: { id: chapterId } });
    const after = await tx.thesisChapter.findMany({
      where: { studentId, number: { gt: chapter.number } },
      orderBy: { number: "asc" },
      select: { id: true, number: true },
    });
    for (const c of after) {
      await tx.thesisChapter.update({ where: { id: c.id }, data: { number: c.number - 1 } });
    }
  });

  return { ok: true as const, data: { id: chapterId } };
}

export interface TransitionActor {
  id: string;
  name: string;
  role: Role;
}

/**
 * The only function in the codebase that changes a chapter's status.
 *
 * Everything it does happens in one transaction: the status move and the audit
 * row that explains it are written together or not at all, so the trail cannot
 * drift from the state it is supposed to describe.
 *
 * The legality of the move is decided by `checkTransition` in src/lib/chapters,
 * the same table the UI draws its buttons from — this function contains no
 * independent opinion about which transitions exist.
 */
export async function transitionChapter(
  chapterId: string,
  action: ChapterAction,
  rawComment: string,
  actor: TransitionActor
): Promise<ServiceResult<{ id: string }>> {
  const chapter = await prisma.thesisChapter.findUnique({
    where: { id: chapterId },
    select: { id: true, studentId: true, status: true, version: true },
  });
  if (!chapter) {
    return { ok: false, status: 404, error: "Chapter not found." };
  }

  const role: "STUDENT" | "SUPERVISOR" = actor.role === Role.SUPERVISOR ? "SUPERVISOR" : "STUDENT";
  const comment = rawComment.trim().slice(0, MAX_COMMENT_LENGTH);

  // Who may act on *this* chapter, before asking whether the move itself is legal.
  if (role === "STUDENT") {
    if (chapter.studentId !== actor.id) {
      return { ok: false, status: 404, error: "Chapter not found." };
    }
  } else if (!(await supervises(actor.id, chapter.studentId))) {
    return { ok: false, status: 403, error: "You are not this student's accepted supervisor." };
  }

  const verdict = checkTransition(action, chapter.status as ChapterStatus, role, comment);
  if (!verdict.ok) {
    return { ok: false, status: 409, error: verdict.reason };
  }
  const { transition } = verdict;

  // Any retreat to DRAFT closes the current round and opens a new one, whether
  // the supervisor sent it back or the student pulled it back. Keyed on the
  // destination rather than on the event, so a future backwards transition
  // cannot forget to bump. The audit row keeps the version of the round it
  // belongs to, not the one being opened.
  const closingVersion = chapter.version;
  const nextVersion = transition.to === "DRAFT" ? chapter.version + 1 : chapter.version;

  try {
    await prisma.$transaction(async (tx) => {
      // Move only if the status is still what the check was made against. Two
      // supervisors clicking at once therefore produce one transition and one
      // audit row, not two of each — the loser is told the chapter moved.
      const moved = await tx.thesisChapter.updateMany({
        where: { id: chapterId, status: transition.from },
        data: {
          status: transition.to,
          version: nextVersion,
          ...(transition.event === "SUBMITTED" && { submittedAt: new Date() }),
        },
      });
      if (moved.count === 0) {
        throw new StaleTransitionError();
      }

      await tx.chapterAuditEntry.create({
        data: {
          chapterId,
          event: transition.event,
          fromStatus: transition.from,
          toStatus: transition.to,
          version: closingVersion,
          comment: comment || null,
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
        },
      });
    });
  } catch (e) {
    if (e instanceof StaleTransitionError) {
      return { ok: false, status: 409, error: "This chapter just moved on. Reload to see where it is now." };
    }
    throw e;
  }

  // Module 3 (Member 3): Smart Notification System.
  //
  // Raised after the transaction commits, so nothing is announced that was
  // rolled back, and outside it, so a provider timeout cannot hold a database
  // transaction open. Failures are swallowed by safeNotify — losing an alert is
  // recoverable, losing the transition that earned it is not.
  await notifyChapterTransition(chapterId, transition.event, comment, actor);

  return { ok: true, data: { id: chapterId } };
}

/**
 * Turn a completed transition into an alert for whoever is now waiting.
 *
 * The recipient flips with the direction of the move: a submission lands on the
 * supervisor's desk, everything else lands back on the student's. A student's
 * own REOPEN notifies nobody — they did it themselves, and telling someone what
 * they just did is how a notification feed becomes noise people mute.
 */
async function notifyChapterTransition(
  chapterId: string,
  event: string,
  comment: string,
  actor: TransitionActor
): Promise<void> {
  const chapter = await prisma.thesisChapter.findUnique({
    where: { id: chapterId },
    select: { id: true, number: true, title: true, studentId: true },
  });
  if (!chapter) return;

  const label = `Chapter ${chapter.number}: ${chapter.title}`;

  if (event === "SUBMITTED") {
    const supervisorUserId = await supervisorUserFor(chapter.studentId);
    if (!supervisorUserId) return;
    await NotificationService.safeNotify({
      userId: supervisorUserId,
      event: "CHAPTER_SUBMITTED",
      title: `${actor.name} submitted a chapter`,
      body: `${label} is waiting for your review.`,
      link: "/dashboard/chapter-reviews",
      subjectType: "chapter",
      subjectId: chapter.id,
    });
    return;
  }

  const forStudent: Record<string, { event: string; title: string; body: string }> = {
    APPROVED: {
      event: "CHAPTER_APPROVED",
      title: `${label} was approved`,
      body: `${actor.name} approved this chapter.${comment ? ` They added: "${comment}"` : ""}`,
    },
    RETURNED: {
      event: "CHAPTER_RETURNED",
      title: `${label} was returned for revision`,
      body: `${actor.name} sent this chapter back: "${comment}"`,
    },
    LOCKED: {
      event: "CHAPTER_LOCKED",
      title: `${label} was locked`,
      body: `${actor.name} committed this chapter to your final thesis. It can no longer be edited.`,
    },
  };

  const plan = forStudent[event];
  if (!plan) return;

  await NotificationService.safeNotify({
    userId: chapter.studentId,
    event: plan.event as never,
    title: plan.title,
    body: plan.body,
    link: "/dashboard/chapters",
    subjectType: "chapter",
    subjectId: chapter.id,
  });

  // A returned chapter carries the supervisor's reasoning, which is feedback in
  // its own right. Sent as a separate SUPERVISOR_COMMENT so a student who wants
  // texts for feedback but not for status changes can have exactly that.
  if (event === "RETURNED" && comment) {
    await NotificationService.safeNotify({
      userId: chapter.studentId,
      event: "SUPERVISOR_COMMENT",
      title: `${actor.name} commented on ${label}`,
      body: comment,
      link: "/dashboard/chapters",
      subjectType: "chapter",
      subjectId: chapter.id,
    });
  }
}

/** The user id of a student's accepted supervisor, or null if they have none. */
async function supervisorUserFor(studentId: string): Promise<string | null> {
  const match = await prisma.matchRequest.findFirst({
    where: { studentId, status: RequestStatus.ACCEPTED },
    select: { supervisor: { select: { userId: true } } },
  });
  return match?.supervisor.userId ?? null;
}

/** Raised inside the transition transaction when the row moved underneath us. */
class StaleTransitionError extends Error {}
