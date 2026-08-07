import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { GitHubService } from "@/services/github.service";

/**
 * Verifies a student's GitHub account and pulls a verified badge (top languages,
 * commit activity, repositories) onto their profile. Required before they can
 * appear in the Teammate-mode match pool.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { githubUsername } = await req.json();
  if (!githubUsername || typeof githubUsername !== "string") {
    return NextResponse.json({ error: "githubUsername is required." }, { status: 400 });
  }

  const username = githubUsername.trim();

  try {
    const result = await GitHubService.verify(username);

    const profile = await prisma.developerProfile.upsert({
      where: { userId: session.sub },
      update: {
        githubUsername: username,
        isVerified: true,
        topLanguages: result.topLanguages,
        topRepositories: result.topRepositories,
        totalCommits: result.totalCommits,
      },
      create: {
        userId: session.sub,
        githubUsername: username,
        isVerified: true,
        topLanguages: result.topLanguages,
        topRepositories: result.topRepositories,
        totalCommits: result.totalCommits,
      },
    });

    return NextResponse.json({ success: true, badge: "VERIFIED", profile });
  } catch (error: unknown) {
    console.error("GitHub verification error:", error);
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json(
        { error: "That GitHub username is already linked to another account." },
        { status: 409 }
      );
    }
    const message = error instanceof Error ? error.message : "Failed to verify GitHub profile.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
