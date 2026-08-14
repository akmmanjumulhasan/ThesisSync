/**
 * Module 1 (Member 2): GitHub API integration.
 *
 * Used by /api/github/verify to confirm a student really owns the GitHub account
 * they declare, and to pull real signal (top languages, commit activity) onto
 * their profile before they're allowed into the Teammate-mode match pool.
 *
 * Self-contained: no imports from outside this project.
 */

const GITHUB_API = "https://api.github.com";

function authHeaders(): HeadersInit {
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  return {
    Accept: "application/vnd.github.v3+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export interface GitHubRepo {
  name: string;
  language: string | null;
  fork: boolean;
  stargazers_count: number;
  pushed_at: string;
}

export interface GitHubVerificationResult {
  topLanguages: string[];
  topRepositories: string[];
  totalCommits: number;
}

/** Module 2 (Member 2): the subset of GitHub's commit shape the analytics read. */
export interface GitHubCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string | null; email: string | null; date: string } | null;
  };
  /** Null when the commit author has no linked GitHub account. */
  author: { login: string } | null;
}

/** Module 2 (Member 2): the subset of GitHub's repository shape access checks read. */
export interface GitHubRepoDetail {
  full_name: string;
  private: boolean;
  owner: { login: string; type: string };
  /** Present only when the token is authenticated as someone with access. */
  permissions?: { admin: boolean; maintain?: boolean; push: boolean; triage?: boolean; pull: boolean };
}

/** Module 2 (Member 2): the subset of GitHub's pull-request shape the analytics read. */
export interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  user: { login: string } | null;
  head: { ref: string } | null;
}

export class GitHubService {
  static async fetchProfile(username: string): Promise<{ login: string }> {
    const res = await fetch(`${GITHUB_API}/users/${encodeURIComponent(username)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`GitHub user "${username}" was not found (status ${res.status})`);
    }
    return res.json();
  }

  static async fetchRepos(username: string): Promise<GitHubRepo[]> {
    const res = await fetch(
      `${GITHUB_API}/users/${encodeURIComponent(username)}/repos?sort=pushed&per_page=10`,
      { headers: authHeaders() }
    );
    if (!res.ok) {
      throw new Error(`Failed to fetch GitHub repositories for "${username}" (status ${res.status})`);
    }
    return res.json();
  }

  /** Ranks languages by how many of the user's recent, non-fork repos use them as the primary language. */
  static computeTopLanguages(repos: GitHubRepo[], limit = 3): string[] {
    const counts = new Map<string, number>();
    for (const repo of repos) {
      if (!repo.language || repo.fork) continue;
      counts.set(repo.language, (counts.get(repo.language) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([lang]) => lang);
  }

  /**
   * Approximates recent commit activity by summing commits authored by `username`
   * across their most recently-pushed non-fork repos. Bounded to a small sample so
   * verification stays fast and stays comfortably inside GitHub's rate limits.
   */
  static async estimateCommitActivity(
    username: string,
    repos: GitHubRepo[],
    repoSampleSize = 5
  ): Promise<number> {
    const sample = repos.filter((r) => !r.fork).slice(0, repoSampleSize);

    const counts = await Promise.all(
      sample.map(async (repo) => {
        try {
          const res = await fetch(
            `${GITHUB_API}/repos/${encodeURIComponent(username)}/${encodeURIComponent(
              repo.name
            )}/commits?author=${encodeURIComponent(username)}&per_page=100`,
            { headers: authHeaders() }
          );
          if (!res.ok) return 0;
          const commits = await res.json();
          return Array.isArray(commits) ? commits.length : 0;
        } catch {
          return 0;
        }
      })
    );

    return counts.reduce((sum, c) => sum + c, 0);
  }

  /**
   * Module 2 (Member 2): a single repository, or null when it doesn't exist or
   * isn't visible to this token. Null is deliberately indistinguishable between
   * "no such repo" and "private repo we can't see" — GitHub itself 404s private
   * repos for the same reason, and echoing that avoids confirming a private
   * repo's existence to someone who can't read it.
   */
  static async fetchRepo(fullName: string): Promise<GitHubRepoDetail | null> {
    const res = await fetch(`${GITHUB_API}/repos/${fullName}`, { headers: authHeaders() });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Failed to look up "${fullName}" (status ${res.status})`);
    }
    return res.json();
  }

  /**
   * Module 2 (Member 2): is `username` a collaborator on `fullName`?
   *
   * GitHub answers 204 yes / 404 no, but only for a token that itself has push
   * access to the repo. With a read-only token this returns 403, which is
   * genuinely "unknown", not "no" — hence three states rather than a boolean, so
   * the caller can fall back to the public contributor list instead of wrongly
   * denying access.
   */
  static async checkCollaborator(
    fullName: string,
    username: string
  ): Promise<"yes" | "no" | "unknown"> {
    const res = await fetch(
      `${GITHUB_API}/repos/${fullName}/collaborators/${encodeURIComponent(username)}`,
      { headers: authHeaders() }
    );
    if (res.status === 204) return "yes";
    if (res.status === 404) return "no";
    return "unknown";
  }

  /** Module 2 (Member 2): public contributor logins for a repo. */
  static async fetchContributorLogins(fullName: string, perPage = 100): Promise<string[]> {
    const res = await fetch(`${GITHUB_API}/repos/${fullName}/contributors?per_page=${perPage}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data)
      ? data.map((c: { login?: string }) => c.login).filter((l): l is string => Boolean(l))
      : [];
  }

  /**
   * Module 2 (Member 2): recent commits on a repo, used to backfill the
   * contribution analytics so the board has real history before any webhook has
   * ever fired. `since` keeps the payload to the heatmap window rather than the
   * repo's entire life.
   */
  static async fetchRepoCommits(repo: string, since: Date, perPage = 100): Promise<GitHubCommit[]> {
    const res = await fetch(
      `${GITHUB_API}/repos/${repo}/commits?since=${since.toISOString()}&per_page=${perPage}`,
      { headers: authHeaders() }
    );
    if (!res.ok) {
      throw new Error(`Failed to fetch commits for "${repo}" (status ${res.status})`);
    }
    return res.json();
  }

  /** Module 2 (Member 2): recent pull requests, any state, newest first. */
  static async fetchRepoPullRequests(repo: string, perPage = 30): Promise<GitHubPullRequest[]> {
    const res = await fetch(
      `${GITHUB_API}/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=${perPage}`,
      { headers: authHeaders() }
    );
    if (!res.ok) {
      throw new Error(`Failed to fetch pull requests for "${repo}" (status ${res.status})`);
    }
    return res.json();
  }

  /** Full verification pipeline used by POST /api/github/verify. Throws if the username doesn't exist. */
  static async verify(username: string): Promise<GitHubVerificationResult> {
    await this.fetchProfile(username);
    const repos = await this.fetchRepos(username);

    const topLanguages = this.computeTopLanguages(repos);
    const topRepositories = repos
      .filter((r) => !r.fork)
      .slice(0, 5)
      .map((r) => r.name);
    const totalCommits = await this.estimateCommitActivity(username, repos);

    return { topLanguages, topRepositories, totalCommits };
  }
}
