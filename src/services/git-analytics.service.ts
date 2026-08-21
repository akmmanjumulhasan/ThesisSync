import "server-only";
import type { GitEventType, TaskStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { parseTaskReferences, shortSha } from "@/lib/git-analytics";
import { NotificationService } from "@/services/notification.service";

/**
 * Module 2 (Member 2): Git-to-Task Contribution Analytics — ingestion.
 *
 * Both entry points land here: the live webhook (POST /api/git/webhook) and the
 * backfill (POST /api/git/sync). They must agree exactly on how an event is
 * deduped and how a task moves, so neither implements that itself.
 */

/** The repo the board tracks. Defaults to this project's own repository. */
export const TRACKED_REPO = process.env.GIT_ANALYTICS_REPO ?? "akmmanjumulhasan/ThesisSync";

export interface IncomingEvent {
  externalId: string;
  type: GitEventType;
  repo: string;
  actorLogin: string;
  actorName?: string | null;
  message: string;
  sha?: string | null;
  prNumber?: number | null;
  prState?: string | null;
  branch?: string | null;
  url?: string | null;
  occurredAt: Date;
}

export interface IngestResult {
  recorded: number;
  skipped: number;
  movedTasks: { key: string; to: TaskStatus }[];
}

/**
 * Records events and applies any task transitions their messages ask for.
 *
 * Idempotent by `externalId`: a webhook delivery and a later backfill can both
 * report the same commit, and the second one must not double-count it in the
 * heatmap or the per-member chart.
 */
export async function ingestEvents(events: IncomingEvent[]): Promise<IngestResult> {
  const result: IngestResult = { recorded: 0, skipped: 0, movedTasks: [] };
  if (events.length === 0) return result;

  const existing = await prisma.gitEvent.findMany({
    where: { externalId: { in: events.map((e) => e.externalId) } },
    select: { externalId: true },
  });
  const seen = new Set(existing.map((e) => e.externalId));

  // Oldest first: if two commits in one push both touch a task, the last word
  // should be the newest commit's, which means applying them in order.
  const fresh = events
    .filter((e) => !seen.has(e.externalId))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  result.skipped = events.length - fresh.length;

  for (const event of fresh) {
    const refs = parseTaskReferences(event.message);
    let linkedTaskId: string | null = null;
    let movedTo: TaskStatus | null = null;

    for (const ref of refs) {
      const task = await prisma.kanbanTask.findUnique({ where: { key: ref.key } });
      if (!task) continue;

      // First matching task owns the link — a commit message that names several
      // tasks still belongs to one card in the feed.
      linkedTaskId ??= task.id;

      if (!ref.intent || task.status === ref.intent) continue;

      const trace =
        event.type === "PULL_REQUEST" && event.prNumber
          ? `moved via PR #${event.prNumber}`
          : event.sha
            ? `moved via commit ${shortSha(event.sha)}`
            : "moved automatically from git";

      await prisma.kanbanTask.update({
        where: { id: task.id },
        data: { status: ref.intent, autoNote: trace },
      });

      // Module 3 (Member 3): Smart Notification System.
      //
      // Only the assignee is told, and only when someone else moved their card.
      // A developer whose own commit moved their own task already knows; the
      // alert exists for the case where a teammate's merge closed work you were
      // holding. Deduped over an hour so a push of twenty commits referencing
      // the same task produces one alert, not twenty.
      if (task.assigneeId) {
        await NotificationService.safeNotify({
          userId: task.assigneeId,
          event: "CONTRIBUTION_UPDATE",
          title: `${task.key} moved to ${ref.intent.replace(/_/g, " ").toLowerCase()}`,
          body: `"${task.title}" ${trace}${event.actorName ? ` by ${event.actorName}` : ""}.`,
          link: "/dashboard/contribution",
          subjectType: "task",
          subjectId: task.id,
          dedupeWithinMs: 60 * 60 * 1000,
        });
      }

      if (task.id === linkedTaskId) movedTo = ref.intent;
      result.movedTasks.push({ key: task.key, to: ref.intent });
    }

    await prisma.gitEvent.create({
      data: {
        externalId: event.externalId,
        type: event.type,
        repo: event.repo,
        actorLogin: event.actorLogin,
        actorName: event.actorName ?? null,
        message: event.message.split("\n")[0].slice(0, 500),
        sha: event.sha ?? null,
        prNumber: event.prNumber ?? null,
        prState: event.prState ?? null,
        branch: event.branch ?? null,
        url: event.url ?? null,
        occurredAt: event.occurredAt,
        taskId: linkedTaskId,
        movedTaskTo: movedTo,
      },
    });

    result.recorded += 1;
  }

  return result;
}

/**
 * Maps GitHub logins to ThesisSync display names via verified developer
 * profiles — a *fallback* only, for contributors whose commits carry no author
 * name.
 *
 * Never use this to override a name git already supplied. A DeveloperProfile is
 * self-declared and can point anywhere: this project's own data has `D1pt0`
 * (Dabobbroto Chakroborty's account) claimed by a profile whose user is named
 * "Maksud", and preferring that row renamed his 17 commits to someone else on
 * the chart. The commit's author name is what the repository actually attests.
 */
export async function resolveMemberNames(logins: string[]): Promise<Map<string, string>> {
  if (logins.length === 0) return new Map();

  const profiles = await prisma.developerProfile.findMany({
    where: { githubUsername: { in: logins } },
    select: { githubUsername: true, user: { select: { name: true } } },
  });

  return new Map(profiles.map((p) => [p.githubUsername, p.user.name]));
}
