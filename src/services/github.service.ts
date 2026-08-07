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
