import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { GitHubService } from "@/services/github.service";
import { ingestEvents, type IncomingEvent } from "@/services/git-analytics.service";
import { normalizeRepoName, requireRepoAccess } from "@/services/repo-access.service";

/**
 * Module 2 (Member 2): Git-to-Task Contribution Analytics — backfill.
 *
 * Webhooks only report what happens *after* they're configured, which would
 * leave the heatmap empty on a repo with months of history. This pulls that
 * history from the REST API on demand. It shares ingestEvents with the webhook,
 * so re-running it is safe — already-seen events are skipped, not re-counted.
 *
 * Syncing writes analytics rows for a repository, so it demands the same proven
 * access as reading one.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { repo: repoInput } = await req.json().catch(() => ({ repo: null }));
  const repo = normalizeRepoName(typeof repoInput === "string" ? repoInput : "");
  if (!repo) {
    return NextResponse.json({ error: "A repo is required." }, { status: 400 });
  }

  const access = await requireRepoAccess(session.sub, repo);
  if (!access) {
    return NextResponse.json({ error: "You don't have access to that repository." }, { status: 403 });
  }

  // The heatmap window, with a few days of margin so a sync run near midnight
  // doesn't clip the oldest column.
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);

  try {
    const [commits, pulls] = await Promise.all([
      GitHubService.fetchRepoCommits(repo, since),
      GitHubService.fetchRepoPullRequests(repo),
    ]);

    const incoming: IncomingEvent[] = [];

    for (const c of commits) {
      const authored = c.commit.author?.date;
      incoming.push({
        externalId: `push:${c.sha}`,
        type: "PUSH",
        repo,
        // Falls back to the git-config name when the commit isn't linked to a
        // GitHub account, so those commits still reach the charts.
        actorLogin: c.author?.login ?? c.commit.author?.name ?? "unknown",
        actorName: c.commit.author?.name ?? null,
        message: c.commit.message,
        sha: c.sha,
        url: c.html_url,
        occurredAt: authored ? new Date(authored) : new Date(),
      });
    }

    for (const p of pulls) {
      const state = p.merged_at ? "merged" : p.state;
      incoming.push({
        externalId: `pr:${p.number}:${state}`,
        type: "PULL_REQUEST",
        repo,
        actorLogin: p.user?.login ?? "unknown",
        actorName: null,
        message: p.title,
        prNumber: p.number,
        prState: state,
        branch: p.head?.ref ?? null,
        url: p.html_url,
        occurredAt: new Date(p.merged_at ?? p.updated_at ?? p.created_at),
      });
    }

    const result = await ingestEvents(incoming);
    return NextResponse.json({ ok: true, repo, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed.";
    // Almost always a rate limit or a private/renamed repo — worth surfacing
    // verbatim rather than as a generic 500, since the fix is on GitHub's side.
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
