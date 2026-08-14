import "server-only";
import type { RepoAccessRole } from "@prisma/client";
import prisma from "@/lib/prisma";
import { GitHubService } from "@/services/github.service";

/**
 * Module 2 (Member 2): who may see a repository's contribution analytics.
 *
 * The rule: you connect a repo only if GitHub says you own it, collaborate on
 * it, or have contributed to it. Searching for a stranger's repository turns up
 * nothing — the analytics are somebody's work record, not public browsing.
 *
 * Identity comes from the *verified* GitHub account on the user's developer
 * profile, never from a name they type. Without that verification there is no
 * way to know the person asking is the login they claim, so the check refuses
 * rather than guesses.
 */

/** "owner/name", the only shape GitHub accepts. Also strips a pasted URL. */
export function normalizeRepoName(input: string): string | null {
  const trimmed = input.trim().replace(/\s+/g, "");
  if (!trimmed) return null;

  // Accept a full URL, an SSH remote, or a bare owner/name.
  const cleaned = trimmed
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");

  const parts = cleaned.split("/");
  if (parts.length !== 2) return null;

  const [owner, name] = parts;
  const valid = /^[A-Za-z0-9._-]+$/;
  if (!valid.test(owner) || !valid.test(name)) return null;

  return `${owner}/${name}`;
}

export type AccessOutcome =
  | { ok: true; fullName: string; role: RepoAccessRole; isPrivate: boolean; githubLogin: string }
  | { ok: false; reason: string; status: number };

/**
 * Resolves what standing `userId` has on `repoInput`, consulting GitHub live.
 *
 * Ordered cheapest-and-strongest first: ownership is decided by the repo record
 * itself, collaboration by the collaborators endpoint, and contribution by the
 * public contributor list. The contributor fallback exists because the server's
 * token is read-only — it cannot read the collaborator list of a repo it has no
 * push access to, and that "unknown" must not silently become "denied" for a
 * legitimate collaborator.
 */
export async function resolveRepoAccess(userId: string, repoInput: string): Promise<AccessOutcome> {
  const fullName = normalizeRepoName(repoInput);
  if (!fullName) {
    return { ok: false, reason: "Enter a repository as owner/name, e.g. akmmanjumulhasan/ThesisSync.", status: 400 };
  }

  const developer = await prisma.developerProfile.findUnique({ where: { userId } });
  if (!developer?.isVerified) {
    return {
      ok: false,
      reason: "Verify your GitHub account on your Profile first — that's how we confirm the repository is yours.",
      status: 403,
    };
  }

  const login = developer.githubUsername;
  const repo = await GitHubService.fetchRepo(fullName);
  if (!repo) {
    return {
      ok: false,
      reason: `"${fullName}" was not found, or it's private and this app can't see it.`,
      status: 404,
    };
  }

  // GitHub logins are case-insensitive; the API echoes canonical casing.
  const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  if (sameLogin(repo.owner.login, login)) {
    return { ok: true, fullName: repo.full_name, role: "OWNER", isPrivate: repo.private, githubLogin: login };
  }

  const collaborator = await GitHubService.checkCollaborator(repo.full_name, login);
  if (collaborator === "yes") {
    return {
      ok: true,
      fullName: repo.full_name,
      role: "COLLABORATOR",
      isPrivate: repo.private,
      githubLogin: login,
    };
  }

  const contributors = await GitHubService.fetchContributorLogins(repo.full_name);
  if (contributors.some((c) => sameLogin(c, login))) {
    return {
      ok: true,
      fullName: repo.full_name,
      role: "CONTRIBUTOR",
      isPrivate: repo.private,
      githubLogin: login,
    };
  }

  return {
    ok: false,
    reason: `Your verified GitHub account (@${login}) doesn't own, collaborate on, or contribute to ${repo.full_name}.`,
    status: 403,
  };
}

/**
 * The gate every read and write goes through. Returns the stored access row, or
 * null when this user has not connected — and proven access to — this repo.
 *
 * Deliberately a database lookup, not another GitHub call: the proof was
 * recorded at connect time, and re-hitting the API on every page render would be
 * both slow and a rate-limit hazard.
 */
export async function requireRepoAccess(userId: string, fullName: string) {
  return prisma.repositoryAccess.findUnique({
    where: { userId_fullName: { userId, fullName } },
  });
}

/** Every repo this user has connected, newest first. */
export async function listAccessibleRepos(userId: string) {
  return prisma.repositoryAccess.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}
