/**
 * Module 3 (Member 3): Smart Notification System — the event catalogue.
 *
 * Email is the only outbound channel. The project's requirement names SMS via
 * Twilio alongside it, but Twilio cannot reliably deliver to the Bangladeshi
 * numbers this platform's users actually have, so shipping an SMS toggle would
 * have meant offering a channel that silently never arrives. In-app plus email
 * is what this deployment can actually stand behind.
 *
 * Every event the platform can raise is described once, here: what it is
 * called, who it is for, which channels it defaults to, and how its message
 * reads. The service, the preference API and the settings UI all read this
 * table, so an event cannot exist in one and be missing from another.
 *
 * Deliberately free of imports so client components can use it, exactly like
 * src/lib/chapters.ts. The union types mirror the Prisma enums by name, and the
 * values cross the boundary unchanged.
 */

export type NotificationEvent =
  | "PROPOSAL_APPROVED"
  | "PROPOSAL_RETURNED"
  | "CHAPTER_SUBMITTED"
  | "CHAPTER_APPROVED"
  | "CHAPTER_RETURNED"
  | "CHAPTER_LOCKED"
  | "SUPERVISOR_COMMENT"
  | "DEADLINE_APPROACHING"
  | "MATCH_REQUEST_RECEIVED"
  | "MATCH_REQUEST_DECIDED"
  | "TEAM_INVITE_RECEIVED"
  | "CONTRIBUTION_UPDATE";

export type NotificationChannel = "IN_APP" | "EMAIL";

export type DeliveryStatus = "PENDING" | "SENT" | "FAILED" | "SKIPPED";

/** Which side of the platform an event is addressed to, for grouping settings. */
export type Audience = "STUDENT" | "SUPERVISOR" | "BOTH";

export interface EventSpec {
  event: NotificationEvent;
  label: string;
  /** Shown under the toggles so a user knows what they are switching off. */
  description: string;
  audience: Audience;
  /** Settings-page grouping. Mirrors the requirement's own list of triggers. */
  group: "Approvals" | "Feedback" | "Deadlines" | "Matchmaking" | "Contribution";
  /** What a user gets before they have chosen anything. */
  defaultEmail: boolean;
}

/**
 * The catalogue.
 *
 * Email defaults on for the events that block someone — an approval they are
 * waiting on, feedback they must act on, a deadline — and off for the ambient
 * ones, which earn a badge on the bell but do not deserve an inbox
 * interruption.
 */
export const EVENT_CATALOGUE: readonly EventSpec[] = [
  {
    event: "PROPOSAL_APPROVED",
    label: "Proposal approved",
    description: "Your supervisor accepted your thesis proposal.",
    audience: "STUDENT",
    group: "Approvals",
    defaultEmail: true,
  },
  {
    event: "PROPOSAL_RETURNED",
    label: "Proposal returned",
    description: "Your supervisor sent the proposal back with comments.",
    audience: "STUDENT",
    group: "Approvals",
    defaultEmail: true,
  },
  {
    event: "CHAPTER_SUBMITTED",
    label: "Chapter submitted for review",
    description: "A student handed a chapter to you for approval.",
    audience: "SUPERVISOR",
    group: "Approvals",
    defaultEmail: true,
  },
  {
    event: "CHAPTER_APPROVED",
    label: "Chapter approved",
    description: "Your supervisor accepted a chapter.",
    audience: "STUDENT",
    group: "Approvals",
    defaultEmail: true,
  },
  {
    event: "CHAPTER_RETURNED",
    label: "Chapter returned for revision",
    description: "Your supervisor sent a chapter back. Their comment is included.",
    audience: "STUDENT",
    group: "Feedback",
    defaultEmail: true,
  },
  {
    event: "CHAPTER_LOCKED",
    label: "Chapter locked",
    description: "A chapter was committed to the final thesis and can no longer be edited.",
    audience: "STUDENT",
    group: "Approvals",
    defaultEmail: true,
  },
  {
    event: "SUPERVISOR_COMMENT",
    label: "Supervisor comment added",
    description: "Your supervisor left a comment on your work.",
    audience: "STUDENT",
    group: "Feedback",
    defaultEmail: true,
  },
  {
    event: "DEADLINE_APPROACHING",
    label: "Deadline approaching",
    description: "A chapter is due soon and has not been submitted yet.",
    audience: "STUDENT",
    group: "Deadlines",
    defaultEmail: true,
  },
  {
    event: "MATCH_REQUEST_RECEIVED",
    label: "Supervision request received",
    description: "A student asked you to supervise their thesis.",
    audience: "SUPERVISOR",
    group: "Matchmaking",
    defaultEmail: true,
  },
  {
    event: "MATCH_REQUEST_DECIDED",
    label: "Supervision request decided",
    description: "A supervisor accepted or declined your request.",
    audience: "STUDENT",
    group: "Matchmaking",
    defaultEmail: true,
  },
  {
    event: "TEAM_INVITE_RECEIVED",
    label: "Teammate invitation",
    description: "Another student invited you to team up.",
    audience: "STUDENT",
    group: "Matchmaking",
    defaultEmail: true,
  },
  {
    event: "CONTRIBUTION_UPDATE",
    label: "Contribution update",
    description: "A commit or pull request moved one of your tasks on the board.",
    audience: "BOTH",
    group: "Contribution",
    defaultEmail: false,
  },
] as const;

const BY_EVENT = new Map<NotificationEvent, EventSpec>(EVENT_CATALOGUE.map((e) => [e.event, e]));

export function specFor(event: NotificationEvent): EventSpec | null {
  return BY_EVENT.get(event) ?? null;
}

export function isKnownEvent(value: string): value is NotificationEvent {
  return BY_EVENT.has(value as NotificationEvent);
}

/** What a user gets on an event they have never configured. */
export function defaultChannels(event: NotificationEvent): { email: boolean } {
  const spec = specFor(event);
  if (!spec) return { email: false };
  return { email: spec.defaultEmail };
}

/** The events worth offering to this role, in settings-page order. */
export function catalogueFor(role: "STUDENT" | "SUPERVISOR" | "ADMIN"): EventSpec[] {
  if (role === "ADMIN") return [];
  return EVENT_CATALOGUE.filter((e) => e.audience === role || e.audience === "BOTH");
}

export const EVENT_GROUPS = ["Approvals", "Feedback", "Deadlines", "Matchmaking", "Contribution"] as const;

// --- message rendering ------------------------------------------------------

/** Plain-text email body. Deliberately not HTML: EmailJS templates own the styling. */
export function toEmailText(title: string, body: string, link: string | null, origin: string): string {
  const lines = [title, "", body];
  if (link) lines.push("", `Open it here: ${origin}${link}`);
  lines.push("", "— ThesisSync", "You can change which alerts you receive in Settings → Notifications.");
  return lines.join("\n");
}

export interface NotificationView {
  id: string;
  event: NotificationEvent;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
  deliveries: { channel: NotificationChannel; status: DeliveryStatus; detail: string | null }[];
}

export interface PreferenceView {
  event: NotificationEvent;
  email: boolean;
}

/** How close to a deadline a reminder goes out. */
export const DEADLINE_WARNING_DAYS = 3;

export const MAX_TITLE = 200;
export const MAX_BODY = 1000;
