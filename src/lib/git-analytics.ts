/**
 * Module 2 (Member 2): Git-to-Task Contribution Analytics.
 *
 * The pure half of the feature: reading intent out of a commit message, and
 * folding a list of git events into the shapes the dashboard draws. No Prisma,
 * no fetch — everything here is deterministic and unit-testable, which matters
 * because a mis-parsed message silently moves the wrong card.
 */

import type { TaskStatus } from "@prisma/client";

/** "TS-11", "ts-11", "#TS-11" — case-insensitive, hyphen required. */
const TASK_KEY_PATTERN = /\b([A-Z]{2,5})-(\d{1,5})\b/gi;

/**
 * Words that mean "this commit finished the task" rather than "this commit
 * touched the task". Mirrors GitHub's own closing-keyword vocabulary so the
 * behaviour is what a developer already expects from issue-closing syntax.
 */
const CLOSING_KEYWORDS = [
  "close",
  "closes",
  "closed",
  "fix",
  "fixes",
  "fixed",
  "resolve",
  "resolves",
  "resolved",
  "complete",
  "completes",
  "completed",
];

/** Words that mean work has started, moving a card out of the backlog. */
const STARTING_KEYWORDS = ["start", "starts", "started", "begin", "begins", "wip", "working on"];

export interface TaskReference {
  key: string;
  /** DONE when a closing keyword preceded the key, IN_PROGRESS for a starting
   *  keyword, null when the key was merely mentioned. */
  intent: TaskStatus | null;
}

/**
 * Extracts every task key referenced by a commit message, along with what the
 * author appeared to intend.
 *
 * The keyword must appear before the key and within a short window of it, so
 * "fixes TS-11" counts but "fixes a crash. see also TS-11" does not — a passing
 * mention shouldn't close someone's card.
 */
export function parseTaskReferences(message: string): TaskReference[] {
  const refs = new Map<string, TaskStatus | null>();
  const haystack = message.toLowerCase();

  for (const match of message.matchAll(TASK_KEY_PATTERN)) {
    const key = `${match[1].toUpperCase()}-${Number(match[2])}`;
    const at = match.index ?? 0;
    // Look back over the ~24 characters before the key: long enough for
    // "resolves " plus a word, short enough that an unrelated earlier verb in
    // the same sentence doesn't reach it.
    const preceding = haystack.slice(Math.max(0, at - 24), at);

    let intent: TaskStatus | null = null;
    if (CLOSING_KEYWORDS.some((k) => new RegExp(`\\b${k}\\b[\\s:#]*$`).test(preceding))) {
      intent = "DONE";
    } else if (STARTING_KEYWORDS.some((k) => new RegExp(`\\b${k}\\b[\\s:#]*$`).test(preceding))) {
      intent = "IN_PROGRESS";
    }

    // A stronger intent wins if the same key appears twice in one message.
    const existing = refs.get(key);
    if (existing === undefined || (existing === null && intent !== null)) {
      refs.set(key, intent);
    }
  }

  return [...refs].map(([key, intent]) => ({ key, intent }));
}

/** Short sha, the form everyone actually reads. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export interface HeatmapDay {
  /** ISO date, YYYY-MM-DD, in UTC. */
  date: string;
  count: number;
  /** 0–4 bucket used to pick a ramp step. 0 means genuinely no activity. */
  level: 0 | 1 | 2 | 3 | 4;
}

/**
 * Buckets commit activity into the last `days` calendar days, oldest first.
 *
 * Levels are relative to the busiest day in the window rather than absolute, so
 * the heatmap stays readable whether the team ships 3 commits a week or 300.
 */
export function buildHeatmap(dates: Date[], days = 21, today = new Date()): HeatmapDay[] {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const key = d.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const max = Math.max(0, ...counts.values());
  const out: HeatmapDay[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - i);
    const key = day.toISOString().slice(0, 10);
    const count = counts.get(key) ?? 0;

    let level: HeatmapDay["level"] = 0;
    if (count > 0 && max > 0) {
      const ratio = count / max;
      level = ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
    }

    out.push({ date: key, count, level });
  }

  return out;
}

export interface MemberContribution {
  login: string;
  /** Platform display name when the login maps to a ThesisSync account. */
  name: string;
  commits: number;
  pullRequests: number;
  tasksMoved: number;
  lastActiveAt: Date | null;
}

export interface ContributionEventInput {
  type: "PUSH" | "PULL_REQUEST";
  actorLogin: string;
  actorName: string | null;
  occurredAt: Date;
  movedTaskTo: TaskStatus | null;
}

/**
 * Per-member totals for the commit chart, ranked by commits.
 *
 * Keyed on GitHub login rather than display name: two contributors can share a
 * display name, and the login is the identity git actually carries.
 */
export function summarizeByMember(events: ContributionEventInput[]): MemberContribution[] {
  const byLogin = new Map<string, MemberContribution>();

  for (const e of events) {
    const existing = byLogin.get(e.actorLogin) ?? {
      login: e.actorLogin,
      name: e.actorName ?? e.actorLogin,
      commits: 0,
      pullRequests: 0,
      tasksMoved: 0,
      lastActiveAt: null,
    };

    if (e.type === "PUSH") existing.commits += 1;
    else existing.pullRequests += 1;
    if (e.movedTaskTo) existing.tasksMoved += 1;
    if (e.actorName && existing.name === existing.login) existing.name = e.actorName;
    if (!existing.lastActiveAt || e.occurredAt > existing.lastActiveAt) {
      existing.lastActiveAt = e.occurredAt;
    }

    byLogin.set(e.actorLogin, existing);
  }

  return [...byLogin.values()].sort(
    (a, b) => b.commits - a.commits || b.pullRequests - a.pullRequests || a.name.localeCompare(b.name)
  );
}

/** Board column order, left to right. Single source of truth for the UI. */
export const BOARD_COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "BACKLOG", label: "Backlog" },
  { status: "IN_PROGRESS", label: "In Progress" },
  { status: "IN_REVIEW", label: "In Review" },
  { status: "DONE", label: "Done" },
];
