"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { BOARD_COLUMNS } from "@/lib/git-analytics";
import type { HeatmapDay } from "@/lib/git-analytics";

type Status = "BACKLOG" | "IN_PROGRESS" | "IN_REVIEW" | "DONE";

interface BoardTask {
  id: string;
  key: string;
  title: string;
  status: Status;
  autoNote: string | null;
  assignee: string | null;
  linkedCommits: number;
  openPr: number | null;
}

interface Member {
  login: string;
  name: string;
  commits: number;
  pullRequests: number;
  tasksMoved: number;
}

interface ActivityItem {
  id: string;
  type: "PUSH" | "PULL_REQUEST";
  actorName: string;
  message: string;
  sha: string | null;
  prNumber: number | null;
  prState: string | null;
  branch: string | null;
  url: string | null;
  occurredAt: string;
  taskKey: string | null;
  movedTaskTo: Status | null;
}

/**
 * Sequential ramp for the heatmap: one hue, light to dark, matching the app's
 * emerald accent. Index is the 0–4 level from buildHeatmap; level 0 is a
 * neutral surface rather than a pale green, so "no commits" never reads as "a
 * few commits".
 */
const HEAT_RAMP = ["#eceef1", "#d1fae5", "#6ee7b7", "#10b981", "#047857"];

/**
 * Categorical slots for the per-member chart, assigned in fixed order and never
 * cycled — a member keeps their colour as the roster grows. Validated for
 * colourblind separation; every bar is also directly labelled, so identity
 * never rests on colour alone.
 */
const MEMBER_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7"];

function timeAgoShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface ConnectedRepo {
  fullName: string;
  role: "OWNER" | "COLLABORATOR" | "CONTRIBUTOR";
  isPrivate: boolean;
}

const ROLE_LABEL: Record<ConnectedRepo["role"], string> = {
  OWNER: "You own this",
  COLLABORATOR: "You collaborate here",
  CONTRIBUTOR: "You've contributed here",
};

export function ContributionClient({
  userName,
  repo,
  repos,
  githubLogin,
  initialTasks,
  initialHeatmap,
  initialMembers,
  initialActivity,
}: {
  userName: string;
  repo: string | null;
  repos: ConnectedRepo[];
  githubLogin: string | null;
  initialTasks: BoardTask[];
  initialHeatmap: HeatmapDay[];
  initialMembers: Member[];
  initialActivity: ActivityItem[];
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [heatmap, setHeatmap] = useState(initialHeatmap);
  const [members, setMembers] = useState(initialMembers);
  const [activity, setActivity] = useState(initialActivity);
  const [newTitle, setNewTitle] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repoQuery, setRepoQuery] = useState("");
  const [connecting, setConnecting] = useState(false);
  const router = useRouter();

  const refresh = useCallback(async () => {
    if (!repo) return;
    const q = `?repo=${encodeURIComponent(repo)}`;
    const [boardRes, analyticsRes] = await Promise.all([
      fetch(`/api/tasks${q}`),
      fetch(`/api/git/activity${q}`),
    ]);
    if (boardRes.ok) setTasks((await boardRes.json()).tasks);
    if (analyticsRes.ok) {
      const data = await analyticsRes.json();
      setHeatmap(data.heatmap);
      setMembers(data.members);
      setActivity(data.activity);
    }
  }, [repo]);

  /**
   * Connects a repository after GitHub confirms the user owns, collaborates on,
   * or has contributed to it. A stranger's repo is refused here, not hidden
   * later — nothing about it is ever fetched into the board.
   */
  async function connectRepo() {
    const query = repoQuery.trim();
    if (!query) return;
    setConnecting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/git/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: query }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not connect that repository.");
        return;
      }
      setRepoQuery("");
      // Pull its history immediately, so the board isn't blank on arrival.
      await fetch("/api/git/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: data.repo.fullName }),
      });
      router.push(`/dashboard/contribution?repo=${encodeURIComponent(data.repo.fullName)}`);
      router.refresh();
    } finally {
      setConnecting(false);
    }
  }

  function selectRepo(fullName: string) {
    router.push(`/dashboard/contribution?repo=${encodeURIComponent(fullName)}`);
    router.refresh();
  }

  async function disconnectRepo() {
    if (!repo) return;
    setError(null);
    await fetch("/api/git/repos", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: repo }),
    });
    router.push("/dashboard/contribution");
    router.refresh();
  }

  async function syncFromGitHub() {
    if (!repo) return;
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/git/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Sync failed.");
        return;
      }
      const moved = data.movedTasks?.length ?? 0;
      setNotice(
        `Synced ${repo}: ${data.recorded} new event${data.recorded === 1 ? "" : "s"}, ${data.skipped} already known` +
          (moved > 0 ? `, ${moved} task${moved === 1 ? "" : "s"} moved automatically.` : ".")
      );
      await refresh();
    } finally {
      setSyncing(false);
    }
  }

  async function createTask() {
    if (!newTitle.trim() || !repo) return;
    setError(null);
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle, repo }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not create the task.");
      return;
    }
    setNewTitle("");
    await refresh();
  }

  async function moveTask(taskId: string, status: Status) {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status, autoNote: "moving…" } : t)));
    const res = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, status }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Could not move the task.");
    }
    await refresh();
  }

  const totalCommits = members.reduce((sum, m) => sum + m.commits, 0);
  const totalPrs = members.reduce((sum, m) => sum + m.pullRequests, 0);
  const autoMoved = members.reduce((sum, m) => sum + m.tasksMoved, 0);
  const maxCommits = Math.max(1, ...members.map((m) => m.commits));
  const doneCount = tasks.filter((t) => t.status === "DONE").length;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-lg font-bold text-foreground">Git-to-Task Contribution Analytics</h1>
        <Link href="/dashboard" className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-background">
          <span className="text-sm text-foreground">{userName}</span>
          <Avatar name={userName} size={32} />
        </Link>
      </div>

      <div className="space-y-5 bg-background p-6">
        {/* Connect a repository: the search box is the only way in, and access
            is proven against GitHub before anything is fetched. */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0 flex-1">
              <label className="text-sm font-medium text-foreground">Connect a repository</label>
              <p className="mt-0.5 text-xs text-muted">
                {githubLogin ? (
                  <>
                    Checked against your verified GitHub account{" "}
                    <span className="font-medium text-foreground">@{githubLogin}</span>. You can only
                    connect repositories you own, collaborate on, or have contributed to.
                  </>
                ) : (
                  <>
                    Verify your GitHub account on your{" "}
                    <Link href="/dashboard/profile" className="text-accent hover:underline">
                      Profile
                    </Link>{" "}
                    first — that&apos;s how ownership is confirmed.
                  </>
                )}
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  value={repoQuery}
                  onChange={(e) => setRepoQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && connectRepo()}
                  placeholder="owner/repository — or paste a GitHub URL"
                  disabled={!githubLogin}
                  className="w-full max-w-md rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                />
                <Button onClick={connectRepo} disabled={connecting || !repoQuery.trim() || !githubLogin}>
                  {connecting ? "Checking…" : "Search & connect"}
                </Button>
              </div>
            </div>
          </div>

          {repos.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <span className="text-xs text-muted">Your repositories:</span>
              {repos.map((r) => (
                <button
                  key={r.fullName}
                  onClick={() => selectRepo(r.fullName)}
                  title={ROLE_LABEL[r.role]}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                    r.fullName === repo
                      ? "border-accent bg-accent text-accent-foreground"
                      : "border-border bg-surface text-foreground hover:bg-background"
                  }`}
                >
                  {r.fullName}
                  {r.isPrivate && " · private"}
                </button>
              ))}
            </div>
          )}
        </div>

        {notice && <p className="text-sm text-success-foreground">{notice}</p>}
        {error && <p className="text-sm text-danger-foreground">{error}</p>}

        {!repo ? (
          <div className="rounded-lg border border-border bg-surface p-10 text-center">
            <p className="text-sm font-medium text-foreground">No repository connected yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">
              Search for one above to see its kanban board, contribution heatmap, per-member commit chart,
              and activity feed.
            </p>
          </div>
        ) : (
          <>
        {/* Selected repo + sync */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-5">
          <div>
            <p className="text-sm font-medium text-foreground">
              Tracking{" "}
              <a
                href={`https://github.com/${repo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                {repo}
              </a>
              {repos.find((r) => r.fullName === repo) && (
                <span className="ml-2 text-xs font-normal text-muted">
                  {ROLE_LABEL[repos.find((r) => r.fullName === repo)!.role]}
                </span>
              )}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              Webhooks keep this live. Sync pulls the last 30 days from the GitHub API for history that
              predates the webhook.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={disconnectRepo}
              className="rounded-md px-2 text-xs font-medium text-muted hover:text-danger-foreground"
            >
              Disconnect
            </button>
            <Button onClick={syncFromGitHub} disabled={syncing} variant="outline">
              {syncing ? "Syncing…" : "Sync from GitHub"}
            </Button>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryTile value={totalCommits} label="Commits · 21 days" />
          <SummaryTile value={totalPrs} label="Pull requests" />
          <SummaryTile value={autoMoved} label="Auto-moved by git" />
          <SummaryTile value={`${doneCount}/${tasks.length}`} label="Tasks done" />
        </div>

        {/* Board */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">Team board — {repo.split("/")[1]}</h2>
            <div className="flex gap-2">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createTask()}
                placeholder="New task title"
                className="w-56 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              />
              <Button onClick={createTask} disabled={!newTitle.trim()}>
                Add task
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {BOARD_COLUMNS.map((col) => {
              const columnTasks = tasks.filter((t) => t.status === col.status);
              return (
                <div key={col.status} className="rounded-md bg-background p-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{col.label}</h3>
                    <span className="text-xs text-muted">{columnTasks.length}</span>
                  </div>

                  <div className="mt-3 space-y-2">
                    {columnTasks.map((task) => (
                      <TaskCard key={task.id} task={task} onMove={moveTask} />
                    ))}
                    {columnTasks.length === 0 && (
                      <p className="py-3 text-center text-xs text-muted">Nothing here</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-4 text-xs text-muted">
            Pushing a commit whose message says{" "}
            <code className="rounded bg-background px-1 py-0.5 font-mono text-[11px] text-foreground">
              fixes TS-11
            </code>{" "}
            moves that task straight to Done. <span className="text-foreground">closes</span>,{" "}
            <span className="text-foreground">resolves</span> and{" "}
            <span className="text-foreground">completes</span> work too;{" "}
            <span className="text-foreground">started</span> and <span className="text-foreground">wip</span>{" "}
            move it to In Progress.
          </p>
        </div>

        {/* Heatmap + per-member chart */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Heatmap days={heatmap} />
          <MemberChart members={members} max={maxCommits} />
        </div>

        {/* Activity feed */}
        <ActivityFeed items={activity} />
          </>
        )}
      </div>
    </div>
  );
}

function SummaryTile({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="font-serif text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}

function TaskCard({ task, onMove }: { task: BoardTask; onMove: (id: string, status: Status) => void }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <p className="text-xs font-semibold text-muted">{task.key}</p>
      <p className="mt-0.5 text-sm text-foreground">{task.title}</p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {task.linkedCommits > 0 && (
          <span className="rounded bg-background px-1.5 py-0.5 text-[11px] text-muted">
            {task.linkedCommits} commit{task.linkedCommits === 1 ? "" : "s"} linked
          </span>
        )}
        {task.openPr && (
          <span className="rounded bg-background px-1.5 py-0.5 text-[11px] text-muted">
            PR #{task.openPr} open
          </span>
        )}
      </div>

      {task.autoNote && <p className="mt-1.5 text-[11px] italic text-muted">{task.autoNote}</p>}

      <div className="mt-2 flex items-center justify-between gap-2">
        {task.assignee ? (
          <span className="truncate text-[11px] text-muted">{task.assignee}</span>
        ) : (
          <span />
        )}
        <select
          value={task.status}
          onChange={(e) => onMove(task.id, e.target.value as Status)}
          aria-label={`Move ${task.key}`}
          className="rounded border border-border bg-surface px-1 py-0.5 text-[11px] text-muted outline-none focus:ring-2 focus:ring-accent"
        >
          {BOARD_COLUMNS.map((c) => (
            <option key={c.status} value={c.status}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Heatmap({ days }: { days: HeatmapDay[] }) {
  const total = days.reduce((sum, d) => sum + d.count, 0);
  const busiest = days.reduce((best, d) => (d.count > best.count ? d : best), days[0]);

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-foreground">Contribution heatmap</h2>
        <span className="text-xs text-muted">{total} commits · 21 days</span>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1.5" role="img" aria-label="Daily commit activity, last 21 days">
        {days.map((day) => (
          <div
            key={day.date}
            title={`${day.date}: ${day.count} commit${day.count === 1 ? "" : "s"}`}
            className="aspect-square rounded"
            style={{ backgroundColor: HEAT_RAMP[day.level] }}
          />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-muted">
          {busiest && busiest.count > 0 ? `Busiest day: ${busiest.date} (${busiest.count})` : "No commits yet"}
        </p>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted">Less</span>
          {HEAT_RAMP.map((color) => (
            <span key={color} className="h-3 w-3 rounded" style={{ backgroundColor: color }} />
          ))}
          <span className="text-[11px] text-muted">More</span>
        </div>
      </div>
    </div>
  );
}

function MemberChart({ members, max }: { members: Member[]; max: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-foreground">Commits per member</h2>
        <span className="text-xs text-muted">Last 21 days</span>
      </div>

      {members.length === 0 ? (
        <p className="mt-6 text-sm text-muted">
          No contributors yet. Run a sync, or push a commit to the tracked repository.
        </p>
      ) : (
        <div className="mt-4 flex items-end justify-around gap-3">
          {members.slice(0, 6).map((member, i) => (
            <div key={member.login} className="flex min-w-0 flex-1 flex-col items-center">
              <span className="mb-1 text-xs font-semibold text-foreground">{member.commits}</span>
              {/* The bar scales inside its own fixed-height track, so a
                  full-height bar can never push the value label out of view. */}
              <div className="flex h-36 w-full items-end">
                <div
                  title={`${member.name}: ${member.commits} commits, ${member.pullRequests} PRs`}
                  className="w-full rounded-t"
                  style={{
                    height: `${Math.max(2, (member.commits / max) * 100)}%`,
                    backgroundColor: MEMBER_COLORS[i % MEMBER_COLORS.length],
                  }}
                />
              </div>
              <span className="mt-2 w-full truncate text-center text-[11px] text-muted" title={member.name}>
                {member.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-foreground">Activity</h2>
        <span className="text-xs text-muted">Newest first</span>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          Nothing yet. Pushes and pull requests appear here as soon as they reach the webhook.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm text-foreground">
                  <span className="font-medium">{item.actorName}</span>{" "}
                  {item.type === "PUSH" ? "pushed" : `${item.prState ?? "updated"} PR #${item.prNumber}`}
                  {item.branch ? ` on ${item.branch}` : ""}
                </p>
                <p className="truncate text-xs text-muted">{item.message}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {item.taskKey && <Badge tone="neutral">{item.taskKey}</Badge>}
                  {item.movedTaskTo && (
                    <Badge tone="success">→ {item.movedTaskTo.replace("_", " ").toLowerCase()}</Badge>
                  )}
                  {item.sha && (
                    <code className="font-mono text-[11px] text-muted">{item.sha.slice(0, 7)}</code>
                  )}
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-medium text-accent hover:underline"
                    >
                      view
                    </a>
                  )}
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted">{timeAgoShort(item.occurredAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
