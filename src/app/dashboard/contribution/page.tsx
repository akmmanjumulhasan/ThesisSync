import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { buildHeatmap, summarizeByMember } from "@/lib/git-analytics";
import { resolveMemberNames } from "@/services/git-analytics.service";
import {
  listAccessibleRepos,
  requireRepoAccess,
  supervisedStudentsWithRepos,
} from "@/services/repo-access.service";
import { ContributionClient } from "@/components/contribution/ContributionClient";
import { SupervisorContributionClient } from "@/components/contribution/SupervisorContributionClient";

/**
 * Module 2 (Member 2): Git-to-Task Contribution Analytics.
 *
 * There is no default repository. A user sees the repos they have connected —
 * and proven access to — and picks one; `?repo=` selects it, falling back to the
 * most recently connected. With none connected, the client renders the connect
 * form instead of an empty board.
 */
export default async function ContributionPage({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { repo: requestedRepo } = await searchParams;

  // Supervisors get a different question answered — see the supervisor view.
  if (session.role === "SUPERVISOR") {
    return renderSupervisorView(session.sub, session.name, requestedRepo);
  }

  const [accessible, developer] = await Promise.all([
    listAccessibleRepos(session.sub),
    prisma.developerProfile.findUnique({ where: { userId: session.sub } }),
  ]);

  const repos = accessible.map((r) => ({
    fullName: r.fullName,
    role: r.role,
    isPrivate: r.isPrivate,
  }));

  // A repo named in the URL still has to be one this user holds access to.
  const selected =
    (requestedRepo && (await requireRepoAccess(session.sub, requestedRepo))?.fullName) ??
    repos[0]?.fullName ??
    null;

  if (!selected) {
    return (
      <ContributionClient
        userName={session.name}
        repo={null}
        repos={repos}
        githubLogin={developer?.isVerified ? developer.githubUsername : null}
        initialTasks={[]}
        initialHeatmap={buildHeatmap([])}
        initialMembers={[]}
        initialActivity={[]}
      />
    );
  }

  const windowStart = new Date();
  windowStart.setUTCDate(windowStart.getUTCDate() - 21);

  const [tasks, windowEvents, recent] = await Promise.all([
    prisma.kanbanTask.findMany({
      where: { repo: selected },
      include: {
        assignee: { select: { name: true } },
        events: {
          orderBy: { occurredAt: "desc" },
          take: 5,
          select: { id: true, type: true, sha: true, prNumber: true, prState: true, url: true },
        },
      },
      orderBy: [{ status: "asc" }, { key: "asc" }],
    }),
    prisma.gitEvent.findMany({
      where: { repo: selected, occurredAt: { gte: windowStart } },
      select: { type: true, actorLogin: true, actorName: true, occurredAt: true, movedTaskTo: true },
    }),
    prisma.gitEvent.findMany({
      where: { repo: selected },
      orderBy: { occurredAt: "desc" },
      take: 20,
      include: { task: { select: { key: true } } },
    }),
  ]);

  const members = summarizeByMember(windowEvents);
  // Name precedence: the commit's own author name first, then a linked platform
  // profile, then the bare login. See resolveMemberNames for why a profile must
  // never outrank what git itself recorded.
  const nameByLogin = await resolveMemberNames(members.map((m) => m.login));
  const displayName = (login: string, gitName: string) =>
    gitName !== login ? gitName : (nameByLogin.get(login) ?? login);

  return (
    <ContributionClient
      userName={session.name}
      repo={selected}
      repos={repos}
      githubLogin={developer?.isVerified ? developer.githubUsername : null}
      initialTasks={tasks.map((t) => ({
        id: t.id,
        key: t.key,
        title: t.title,
        status: t.status,
        autoNote: t.autoNote,
        assignee: t.assignee?.name ?? null,
        linkedCommits: t.events.filter((e) => e.type === "PUSH").length,
        openPr: t.events.find((e) => e.type === "PULL_REQUEST" && e.prState === "open")?.prNumber ?? null,
      }))}
      initialHeatmap={buildHeatmap(
        windowEvents.filter((e) => e.type === "PUSH").map((e) => e.occurredAt)
      )}
      initialMembers={members.map((m) => ({
        login: m.login,
        name: displayName(m.login, m.name),
        commits: m.commits,
        pullRequests: m.pullRequests,
        tasksMoved: m.tasksMoved,
      }))}
      initialActivity={recent.map((e) => ({
        id: e.id,
        type: e.type,
        actorName: e.actorName ?? nameByLogin.get(e.actorLogin) ?? e.actorLogin,
        message: e.message,
        sha: e.sha,
        prNumber: e.prNumber,
        prState: e.prState,
        branch: e.branch,
        url: e.url,
        occurredAt: e.occurredAt.toISOString(),
        taskKey: e.task?.key ?? null,
        movedTaskTo: e.movedTaskTo,
      }))}
    />
  );
}

/**
 * Module 2 (Member 2): the supervisor's side.
 *
 * Aggregates every supervised student's activity from the same GitEvent rows
 * the student's own board reads, so the two views can never disagree, and
 * resolves the selected repository only if one of those students connected it.
 */
async function renderSupervisorView(userId: string, userName: string, requestedRepo?: string) {
  const windowStart = new Date();
  windowStart.setUTCDate(windowStart.getUTCDate() - 21);

  const students = await supervisedStudentsWithRepos(userId);
  const repoNames = [...new Set(students.flatMap((s) => s.repos.map((r) => r.fullName)))];

  const [events, tasksByRepo, devProfiles] = await Promise.all([
    prisma.gitEvent.findMany({
      where: { repo: { in: repoNames }, occurredAt: { gte: windowStart } },
      select: { repo: true, type: true, actorLogin: true, occurredAt: true },
    }),
    prisma.kanbanTask.findMany({
      where: { repo: { in: repoNames } },
      select: { repo: true, status: true },
    }),
    // A student's commits are attributed by their verified GitHub login, so a
    // student who has not verified shows zero rather than someone else's work.
    prisma.developerProfile.findMany({
      where: { userId: { in: students.map((s) => s.userId) } },
      select: { userId: true, githubUsername: true },
    }),
  ]);

  const loginByStudent = new Map(devProfiles.map((d) => [d.userId, d.githubUsername.toLowerCase()]));

  const rows = students.map((student) => {
    const login = loginByStudent.get(student.userId);
    const owned = new Set(student.repos.map((r) => r.fullName));
    const mine = events.filter(
      (e) => owned.has(e.repo) && login !== undefined && e.actorLogin.toLowerCase() === login
    );

    const tasks = tasksByRepo.filter((t) => owned.has(t.repo));
    const lastActive = mine.reduce<Date | null>(
      (latest, e) => (!latest || e.occurredAt > latest ? e.occurredAt : latest),
      null
    );

    return {
      ...student,
      commits: mine.filter((e) => e.type === "PUSH").length,
      pullRequests: mine.filter((e) => e.type === "PULL_REQUEST").length,
      tasksDone: tasks.filter((t) => t.status === "DONE").length,
      tasksTotal: tasks.length,
      lastActiveAt: lastActive?.toISOString() ?? null,
    };
  });

  const selected =
    requestedRepo && repoNames.includes(requestedRepo) ? requestedRepo : null;

  if (!selected) {
    return (
      <SupervisorContributionClient
        userName={userName}
        students={rows}
        selectedRepo={null}
        heatmap={buildHeatmap([])}
        members={[]}
        activity={[]}
        tasks={[]}
      />
    );
  }

  const [windowEvents, recent, tasks] = await Promise.all([
    prisma.gitEvent.findMany({
      where: { repo: selected, occurredAt: { gte: windowStart } },
      select: { type: true, actorLogin: true, actorName: true, occurredAt: true, movedTaskTo: true },
    }),
    prisma.gitEvent.findMany({
      where: { repo: selected },
      orderBy: { occurredAt: "desc" },
      take: 20,
      include: { task: { select: { key: true } } },
    }),
    prisma.kanbanTask.findMany({
      where: { repo: selected },
      include: {
        assignee: { select: { name: true } },
        events: {
          orderBy: { occurredAt: "desc" },
          take: 5,
          select: { id: true, type: true, prNumber: true, prState: true },
        },
      },
      orderBy: [{ status: "asc" }, { key: "asc" }],
    }),
  ]);

  const members = summarizeByMember(windowEvents);
  const nameByLogin = await resolveMemberNames(members.map((m) => m.login));
  const displayName = (login: string, gitName: string) =>
    gitName !== login ? gitName : (nameByLogin.get(login) ?? login);

  return (
    <SupervisorContributionClient
      userName={userName}
      students={rows}
      selectedRepo={selected}
      heatmap={buildHeatmap(windowEvents.filter((e) => e.type === "PUSH").map((e) => e.occurredAt))}
      members={members.map((m) => ({
        login: m.login,
        name: displayName(m.login, m.name),
        commits: m.commits,
        pullRequests: m.pullRequests,
        tasksMoved: m.tasksMoved,
      }))}
      activity={recent.map((e) => ({
        id: e.id,
        type: e.type,
        actorName: e.actorName ?? nameByLogin.get(e.actorLogin) ?? e.actorLogin,
        message: e.message,
        sha: e.sha,
        prNumber: e.prNumber,
        prState: e.prState,
        branch: e.branch,
        url: e.url,
        occurredAt: e.occurredAt.toISOString(),
        taskKey: e.task?.key ?? null,
        movedTaskTo: e.movedTaskTo,
      }))}
      tasks={tasks.map((t) => ({
        id: t.id,
        key: t.key,
        title: t.title,
        status: t.status,
        autoNote: t.autoNote,
        assignee: t.assignee?.name ?? null,
        linkedCommits: t.events.filter((e) => e.type === "PUSH").length,
        openPr: t.events.find((e) => e.type === "PULL_REQUEST" && e.prState === "open")?.prNumber ?? null,
      }))}
    />
  );
}
