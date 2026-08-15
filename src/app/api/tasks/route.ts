import { NextResponse } from "next/server";
import { TaskStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canReadRepo, normalizeRepoName, requireRepoAccess } from "@/services/repo-access.service";

/**
 * Module 2 (Member 2): Git-to-Task Contribution Analytics — the kanban board's
 * own CRUD. Git moves cards automatically; this is how a human creates one in
 * the first place and overrides a column by hand.
 *
 * Every operation is scoped to a repository the caller has connected and proven
 * access to, so one team's board is never readable or editable by another.
 */

/**
 * Shared gate. `mode` decides how much standing is required: reading a board is
 * open to the supervisor of a student who connected it, while creating or
 * moving a card stays with the people actually doing the work.
 */
async function repoFor(
  userId: string,
  role: string,
  raw: string | null,
  mode: "read" | "write" = "write"
) {
  const repo = normalizeRepoName(raw ?? "");
  if (!repo) return { error: "A repo is required.", status: 400 as const, repo: null };

  const allowed =
    mode === "read" ? await canReadRepo(userId, role, repo) : Boolean(await requireRepoAccess(userId, repo));

  if (!allowed) {
    return { error: "You don't have access to that repository.", status: 403 as const, repo: null };
  }
  return { error: null, status: 200 as const, repo };
}

const VALID_STATUSES = Object.values(TaskStatus);

/** The board, plus each card's linked commits/PRs so the UI can show the trace. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const gate = await repoFor(session.sub, session.role, new URL(req.url).searchParams.get("repo"), "read");
  if (!gate.repo) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const tasks = await prisma.kanbanTask.findMany({
    where: { repo: gate.repo },
    include: {
      assignee: { select: { name: true } },
      events: {
        orderBy: { occurredAt: "desc" },
        take: 5,
        select: { id: true, type: true, sha: true, prNumber: true, prState: true, url: true },
      },
    },
    orderBy: [{ status: "asc" }, { key: "asc" }],
  });

  return NextResponse.json({
    repo: gate.repo,
    tasks: tasks.map((t) => ({
      id: t.id,
      key: t.key,
      title: t.title,
      status: t.status,
      autoNote: t.autoNote,
      assignee: t.assignee?.name ?? null,
      linkedCommits: t.events.filter((e) => e.type === "PUSH").length,
      openPr: t.events.find((e) => e.type === "PULL_REQUEST" && e.prState === "open")?.prNumber ?? null,
      events: t.events,
    })),
  });
}

/** Creates a card. The key is generated so it always matches the TS-<n> form commits reference. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { title, status, repo: repoInput } = await req.json();
  const gate = await repoFor(session.sub, session.role, typeof repoInput === "string" ? repoInput : null);
  if (!gate.repo) return NextResponse.json({ error: gate.error }, { status: gate.status });

  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "A task title is required." }, { status: 400 });
  }
  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Unknown status." }, { status: 400 });
  }

  // Next key by highest existing number rather than by count, so deleting a card
  // never causes a key to be reused — commit messages referencing the old one
  // would otherwise start hitting a different task. Keys are global rather than
  // per-repo because a commit message carries only "TS-11", with no repo to
  // disambiguate it.
  const existing = await prisma.kanbanTask.findMany({ select: { key: true } });
  const highest = existing.reduce((max, t) => {
    const n = Number(t.key.split("-")[1]);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);

  const task = await prisma.kanbanTask.create({
    data: {
      key: `TS-${highest + 1}`,
      title: title.trim().slice(0, 200),
      status: status ?? TaskStatus.BACKLOG,
      repo: gate.repo,
      assigneeId: session.sub,
    },
  });

  return NextResponse.json({ success: true, task });
}

/** Manual column move. Clears autoNote, since the card's position is no longer git's doing. */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { taskId, status } = await req.json();
  if (!taskId || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "taskId and a valid status are required." }, { status: 400 });
  }

  const existing = await prisma.kanbanTask.findUnique({ where: { id: taskId } });
  // Access is checked against the task's own repo, not one supplied by the
  // caller — otherwise naming a repo you *do* have access to would let you move
  // a card belonging to one you don't.
  if (!existing || !(await requireRepoAccess(session.sub, existing.repo))) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  const task = await prisma.kanbanTask.update({
    where: { id: taskId },
    data: { status, autoNote: `moved by ${session.name}` },
  });

  return NextResponse.json({ success: true, task });
}
