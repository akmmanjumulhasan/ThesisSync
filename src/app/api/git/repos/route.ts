import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  listAccessibleRepos,
  normalizeRepoName,
  resolveRepoAccess,
} from "@/services/repo-access.service";

/**
 * Module 2 (Member 2): the repositories a user has connected to the analytics
 * board. Connecting is the moment access is proven; everything downstream just
 * checks for the row this creates.
 */

/** The caller's own connected repos. Never anyone else's. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const repos = await listAccessibleRepos(session.sub);
  return NextResponse.json({
    repos: repos.map((r) => ({
      fullName: r.fullName,
      role: r.role,
      isPrivate: r.isPrivate,
      githubLogin: r.githubLogin,
      verifiedAt: r.verifiedAt,
    })),
  });
}

/** Searches GitHub for the repo and connects it — only if the user has standing. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { fullName } = await req.json();
  if (typeof fullName !== "string") {
    return NextResponse.json({ error: "A repository name is required." }, { status: 400 });
  }

  let outcome;
  try {
    outcome = await resolveRepoAccess(session.sub, fullName);
  } catch (err) {
    const message = err instanceof Error ? err.message : "GitHub lookup failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.reason }, { status: outcome.status });
  }

  const access = await prisma.repositoryAccess.upsert({
    where: { userId_fullName: { userId: session.sub, fullName: outcome.fullName } },
    update: { role: outcome.role, isPrivate: outcome.isPrivate, githubLogin: outcome.githubLogin, verifiedAt: new Date() },
    create: {
      userId: session.sub,
      fullName: outcome.fullName,
      role: outcome.role,
      isPrivate: outcome.isPrivate,
      githubLogin: outcome.githubLogin,
    },
  });

  return NextResponse.json({
    success: true,
    repo: {
      fullName: access.fullName,
      role: access.role,
      isPrivate: access.isPrivate,
      githubLogin: access.githubLogin,
    },
  });
}

/**
 * Disconnects a repo from this user's board.
 *
 * Only the access row is deleted. The repo's tasks and git events stay, because
 * teammates who connected the same repository share that board — one person
 * disconnecting must not delete everyone else's history.
 */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { fullName } = await req.json();
  const normalized = typeof fullName === "string" ? normalizeRepoName(fullName) : null;
  if (!normalized) {
    return NextResponse.json({ error: "A repository name is required." }, { status: 400 });
  }

  await prisma.repositoryAccess.deleteMany({ where: { userId: session.sub, fullName: normalized } });
  return NextResponse.json({ success: true });
}
