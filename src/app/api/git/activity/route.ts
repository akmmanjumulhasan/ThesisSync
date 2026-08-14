import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { buildHeatmap, summarizeByMember } from "@/lib/git-analytics";
import { resolveMemberNames } from "@/services/git-analytics.service";
import { normalizeRepoName, requireRepoAccess } from "@/services/repo-access.service";

/**
 * Module 2 (Member 2): Git-to-Task Contribution Analytics — the read model
 * behind the heatmap, the per-member chart, and the activity feed. Kept as one
 * endpoint because the page refreshes all three together after a sync.
 *
 * Scoped to a repo the caller has connected and proven access to; there is no
 * default repository, so omitting ?repo= is an error rather than a fallback.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const repo = normalizeRepoName(new URL(req.url).searchParams.get("repo") ?? "");
  if (!repo) {
    return NextResponse.json({ error: "A repo parameter is required." }, { status: 400 });
  }

  const access = await requireRepoAccess(session.sub, repo);
  if (!access) {
    return NextResponse.json({ error: "You don't have access to that repository." }, { status: 403 });
  }

  const windowStart = new Date();
  windowStart.setUTCDate(windowStart.getUTCDate() - 21);

  const [windowEvents, recent] = await Promise.all([
    prisma.gitEvent.findMany({
      where: { repo, occurredAt: { gte: windowStart } },
      select: { type: true, actorLogin: true, actorName: true, occurredAt: true, movedTaskTo: true },
    }),
    prisma.gitEvent.findMany({
      where: { repo },
      orderBy: { occurredAt: "desc" },
      take: 20,
      include: { task: { select: { key: true, title: true } } },
    }),
  ]);

  const members = summarizeByMember(windowEvents);
  // Name precedence: the commit's own author name first, then a linked platform
  // profile, then the bare login. See resolveMemberNames for why a profile must
  // never outrank what git itself recorded.
  const nameByLogin = await resolveMemberNames(members.map((m) => m.login));
  const displayName = (login: string, gitName: string) =>
    gitName !== login ? gitName : (nameByLogin.get(login) ?? login);

  return NextResponse.json({
    repo,
    heatmap: buildHeatmap(windowEvents.filter((e) => e.type === "PUSH").map((e) => e.occurredAt)),
    members: members.map((m) => ({ ...m, name: displayName(m.login, m.name) })),
    activity: recent.map((e) => ({
      id: e.id,
      type: e.type,
      actorLogin: e.actorLogin,
      actorName: e.actorName ?? nameByLogin.get(e.actorLogin) ?? e.actorLogin,
      message: e.message,
      sha: e.sha,
      prNumber: e.prNumber,
      prState: e.prState,
      branch: e.branch,
      url: e.url,
      occurredAt: e.occurredAt,
      taskKey: e.task?.key ?? null,
      movedTaskTo: e.movedTaskTo,
    })),
  });
}
