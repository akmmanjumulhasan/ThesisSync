/**
 * Module 3 (Member 3): Chapter Approval Workflow — the pipeline itself.
 *
 * Every rule about how a chapter moves lives here, and both sides read it: the
 * route handler decides what it will permit from this table, and the UI decides
 * which buttons to render from the same table. A pipeline enforced in one place
 * and drawn from another is a pipeline that eventually disagrees with itself —
 * a button the server rejects, or worse, a transition the UI hides but the
 * server still allows.
 *
 * Deliberately free of imports: this module is pulled into client components,
 * so the statuses are declared as string unions matching the Prisma enums by
 * name rather than importing the generated enums (which would drag the client
 * into the bundle). The names are identical, so values cross the boundary
 * unchanged.
 */

export type ChapterStatus = "DRAFT" | "SUBMITTED" | "IN_REVIEW" | "APPROVED" | "LOCKED";

export type ChapterEvent =
  | "CREATED"
  | "SUBMITTED"
  | "REVIEW_STARTED"
  | "APPROVED"
  | "RETURNED"
  | "REOPENED"
  | "LOCKED";

export type ChapterAction = "SUBMIT" | "START_REVIEW" | "APPROVE" | "RETURN" | "REOPEN" | "UNAPPROVE" | "LOCK";

export type ActorRole = "STUDENT" | "SUPERVISOR";

/** The pipeline as the student sees it, left to right. */
export const PIPELINE: readonly ChapterStatus[] = ["DRAFT", "SUBMITTED", "IN_REVIEW", "APPROVED", "LOCKED"] as const;

export interface Transition {
  action: ChapterAction;
  from: ChapterStatus;
  to: ChapterStatus;
  /** Who is allowed to perform it. Exactly one role — never "either". */
  actor: ActorRole;
  event: ChapterEvent;
  /** A returned chapter must say why; nothing else demands a note. */
  requiresComment: boolean;
  /** Button text, and the phrasing used in error messages. */
  label: string;
  /** Shown under the button so a supervisor knows what the click commits to. */
  hint: string;
}

/**
 * The complete set of legal moves. Anything not in this table cannot happen —
 * there is no fallback branch anywhere that permits a transition by inference.
 *
 * The rule the requirement actually turns on is that nothing *advances* without
 * the supervisor: every move rightward along PIPELINE has `actor: "SUPERVISOR"`
 * except SUBMIT, which is the student handing their own work over. Retreats to
 * DRAFT are a different matter, and the student owns one of them — withdrawing
 * their own approved chapter to amend it, at the cost of the approval.
 *
 * Action names are unique: `transitionFor` resolves by action alone, so a state
 * pair must never be reachable under a name already in use. That is why the
 * supervisor's retreat from APPROVED is UNAPPROVE rather than a second RETURN.
 */
export const TRANSITIONS: readonly Transition[] = [
  {
    action: "SUBMIT",
    from: "DRAFT",
    to: "SUBMITTED",
    actor: "STUDENT",
    event: "SUBMITTED",
    requiresComment: false,
    label: "Submit for approval",
    hint: "Hands the chapter to your supervisor. It becomes read-only until they act on it.",
  },
  {
    action: "START_REVIEW",
    from: "SUBMITTED",
    to: "IN_REVIEW",
    actor: "SUPERVISOR",
    event: "REVIEW_STARTED",
    requiresComment: false,
    label: "Start review",
    hint: "Tells the student you have picked this up. Recorded against your name.",
  },
  {
    action: "APPROVE",
    from: "IN_REVIEW",
    to: "APPROVED",
    actor: "SUPERVISOR",
    event: "APPROVED",
    requiresComment: false,
    label: "Approve",
    hint: "Accepts the chapter as it stands. It can still be locked afterwards.",
  },
  {
    action: "RETURN",
    from: "IN_REVIEW",
    to: "DRAFT",
    actor: "SUPERVISOR",
    event: "RETURNED",
    requiresComment: true,
    label: "Return for revision",
    hint: "Sends it back to the student as a new draft. Your comment is required.",
  },
  {
    action: "REOPEN",
    from: "APPROVED",
    to: "DRAFT",
    actor: "STUDENT",
    event: "REOPENED",
    requiresComment: false,
    label: "Reopen for edits",
    hint: "Cancels the approval and returns the chapter to draft. It will need approving again.",
  },
  {
    action: "UNAPPROVE",
    from: "APPROVED",
    to: "DRAFT",
    actor: "SUPERVISOR",
    event: "RETURNED",
    requiresComment: true,
    label: "Withdraw approval",
    hint: "For an approval given too early. Sends it back to draft; your comment is required.",
  },
  {
    action: "LOCK",
    from: "APPROVED",
    to: "LOCKED",
    actor: "SUPERVISOR",
    event: "LOCKED",
    requiresComment: false,
    label: "Lock chapter",
    hint: "Final, and irreversible for both of you. Nothing can change this chapter afterwards.",
  },
] as const;

/** The rule for an action, or null if that action does not exist at all. */
export function transitionFor(action: ChapterAction): Transition | null {
  return TRANSITIONS.find((t) => t.action === action) ?? null;
}

/**
 * The one function that answers "may this happen?". Returns the rule on
 * success, or a reason string the caller can show verbatim — the API returns it
 * as the error body, so a rejected transition always explains itself.
 */
export function checkTransition(
  action: ChapterAction,
  from: ChapterStatus,
  role: ActorRole,
  comment: string
): { ok: true; transition: Transition } | { ok: false; reason: string } {
  const transition = transitionFor(action);
  if (!transition) {
    return { ok: false, reason: "That is not a recognised action." };
  }
  if (transition.actor !== role) {
    return {
      ok: false,
      reason:
        transition.actor === "SUPERVISOR"
          ? `Only a supervisor can ${transition.label.toLowerCase()}.`
          : `Only the student can ${transition.label.toLowerCase()}.`,
    };
  }
  if (transition.from !== from) {
    return {
      ok: false,
      reason: `"${transition.label}" applies to a chapter at ${STATUS_META[transition.from].label}, and this one is at ${STATUS_META[from].label}.`,
    };
  }
  if (transition.requiresComment && !comment.trim()) {
    return { ok: false, reason: "Add a comment explaining what needs revision." };
  }
  return { ok: true, transition };
}

/** Every move this role can make from this state — what the UI renders as buttons. */
export function availableActions(from: ChapterStatus, role: ActorRole): Transition[] {
  return TRANSITIONS.filter((t) => t.from === from && t.actor === role);
}

/** The student may only type into a chapter that is sitting in DRAFT. */
export function isEditable(status: ChapterStatus): boolean {
  return status === "DRAFT";
}

/** Terminal state: write access is over for good. */
export function isLocked(status: ChapterStatus): boolean {
  return status === "LOCKED";
}

/**
 * A chapter can only be removed before it has ever been submitted. Once it has
 * entered the pipeline there is an approval record attached to it, and deleting
 * the chapter would delete that record too.
 */
export function isDeletable(status: ChapterStatus, submittedAt: string | Date | null): boolean {
  return status === "DRAFT" && submittedAt === null;
}

/** Whether this status is waiting on the supervisor rather than on the student. */
export function awaitsSupervisor(status: ChapterStatus): boolean {
  return status === "SUBMITTED" || status === "IN_REVIEW" || status === "APPROVED";
}

type Tone = "success" | "danger" | "neutral" | "brand" | "warning";

export const STATUS_META: Record<ChapterStatus, { label: string; tone: Tone; blurb: string }> = {
  DRAFT: { label: "Draft", tone: "neutral", blurb: "Yours to edit. Submit it when you want your supervisor to look." },
  SUBMITTED: { label: "Submitted", tone: "warning", blurb: "Waiting for your supervisor to begin their review." },
  IN_REVIEW: { label: "In review", tone: "warning", blurb: "Your supervisor is reading it now." },
  APPROVED: {
    label: "Approved",
    tone: "success",
    blurb: "Accepted by your supervisor. You can still reopen it to amend, but that cancels the approval.",
  },
  LOCKED: {
    label: "Locked",
    tone: "brand",
    blurb: "Committed to the final thesis. Nobody can change it now — not you, and not your supervisor.",
  },
};

export const EVENT_META: Record<ChapterEvent, { verb: string; tone: Tone }> = {
  CREATED: { verb: "created the chapter", tone: "neutral" },
  SUBMITTED: { verb: "submitted for approval", tone: "warning" },
  REVIEW_STARTED: { verb: "started the review", tone: "warning" },
  APPROVED: { verb: "approved the chapter", tone: "success" },
  RETURNED: { verb: "returned it for revision", tone: "danger" },
  REOPENED: { verb: "reopened it for edits, cancelling the approval", tone: "warning" },
  LOCKED: { verb: "locked the chapter", tone: "brand" },
};

/** 0-100 across the whole thesis, counting a chapter done only once it is locked. */
export function thesisProgress(statuses: ChapterStatus[]): number {
  if (statuses.length === 0) return 0;
  const earned = statuses.reduce((sum, s) => sum + PIPELINE.indexOf(s), 0);
  const possible = statuses.length * (PIPELINE.length - 1);
  return Math.round((earned / possible) * 100);
}

/** Standard scaffold offered on an empty thesis. Titles are editable afterwards. */
export const STANDARD_CHAPTERS: readonly string[] = [
  "Introduction",
  "Literature Review",
  "Methodology",
  "Results and Analysis",
  "Conclusion and Future Work",
] as const;

/**
 * A chapter and its trail as they cross from a Server Component into a client
 * one: dates already strings, relations already flattened. Declared here so the
 * student page and the supervisor page describe the same shape rather than each
 * inventing their own.
 */
export interface AuditView {
  id: string;
  event: ChapterEvent;
  fromStatus: ChapterStatus | null;
  toStatus: ChapterStatus;
  version: number;
  comment: string | null;
  actorName: string;
  actorRole: "STUDENT" | "SUPERVISOR" | "ADMIN";
  createdAt: string;
}

export interface ChapterView {
  id: string;
  number: number;
  title: string;
  content: string;
  status: ChapterStatus;
  version: number;
  submittedAt: string | null;
  updatedAt: string;
  audit: AuditView[];
}

/** A queued chapter carries its author, since a supervisor sees several students'. */
export interface QueuedChapterView extends ChapterView {
  studentName: string;
  studentEmail: string;
}

/** The most recent entry recording this event, if the chapter has one. */
export function lastEvent(audit: AuditView[], event: ChapterEvent): AuditView | null {
  return audit.find((a) => a.event === event) ?? null;
}

export const MAX_CHAPTERS = 20;
export const MAX_TITLE_LENGTH = 200;
export const MAX_CONTENT_LENGTH = 200_000;
export const MAX_COMMENT_LENGTH = 2000;
