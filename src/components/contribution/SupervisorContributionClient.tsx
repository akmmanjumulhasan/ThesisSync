"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import {
  ActivityFeed,
  Heatmap,
  MemberChart,
  SummaryTile,
  timeAgoShort,
  type ActivityItem,
  type HeatmapDay,
  type Member,
} from "@/components/contribution/analytics";

/**
 * Module 2 (Member 2): the supervisor's view of contribution analytics.
 *
 * The spec asks for an objective, real-time view of who is contributing what,
 * for supervisors as well as teammates. A supervisor's question is different
 * from a student's though: not "how is my board doing" but "which of my
 * students has stopped working, and is the load spread evenly across a team".
 * So this leads with a roster comparison and lets them drill into one board,
 * rather than showing a single board with no context.
 *
 * Read-only by construction. Supervisors observe contribution; they do not move
 * a team's cards or trigger syncs on a repository that is not theirs.
 */

interface StudentRow {
  userId: string;
  name: string;
  email: string;
  repos: { fullName: string; role: string }[];
  commits: number;
  pullRequests: number;
  tasksDone: number;
  tasksTotal: number;
  lastActiveAt: string | null;
}

interface BoardTask {
  id: string;
  key: string;
  title: string;
  status: "BACKLOG" | "IN_PROGRESS" | "IN_REVIEW" | "DONE";
  autoNote: string | null;
  assignee: string | null;
  linkedCommits: number;
  openPr: number | null;
}

/** Days without a commit before a supervisor should probably ask a question. */
const STALE_AFTER_DAYS = 7;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function SupervisorContributionClient({
  userName,
  students,
  selectedRepo,
  heatmap,
  members,
  activity,
  tasks,
}: {
  userName: string;
  students: StudentRow[];
  selectedRepo: string | null;
  heatmap: HeatmapDay[];
  members: Member[];
  activity: ActivityItem[];
  tasks: BoardTask[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  function openRepo(fullName: string) {
    setBusy(fullName);
    router.push(`/dashboard/contribution?repo=${encodeURIComponent(fullName)}`);
    router.refresh();
  }

  const maxCommits = Math.max(1, ...members.map((m) => m.commits));
  const totalCommits = members.reduce((sum, m) => sum + m.commits, 0);
  const totalPrs = members.reduce((sum, m) => sum + m.pullRequests, 0);
  const doneCount = tasks.filter((t) => t.status === "DONE").length;

  // Surfaced first because it is the one thing a supervisor cannot see by
  // asking: a student who has quietly stopped committing.
  const stalled = students.filter((s) => {
    const days = daysSince(s.lastActiveAt);
    return s.repos.length > 0 && (days === null || days >= STALE_AFTER_DAYS);
  });

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-bold text-foreground">Contribution Analytics</h1>
          <p className="mt-0.5 text-xs text-muted">Supervisor view · your students&apos; repositories</p>
        </div>
        <Link href="/dashboard" className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-background">
          <span className="text-sm text-foreground">{userName}</span>
          <Avatar name={userName} size={32} />
        </Link>
      </div>

      <div className="space-y-5 bg-background p-6">
        {students.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-10 text-center">
            <p className="text-sm font-medium text-foreground">No students yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">
              Accept a supervision request and your students&apos; contribution analytics appear here.
            </p>
          </div>
        ) : (
          <>
            {stalled.length > 0 && (
              <div className="rounded-lg border border-border bg-warning-bg p-4">
                <p className="text-sm font-medium text-warning-foreground">
                  {stalled.length} student{stalled.length === 1 ? "" : "s"} with no commits in the last{" "}
                  {STALE_AFTER_DAYS} days
                </p>
                <p className="mt-0.5 text-xs text-warning-foreground">
                  {stalled.map((s) => s.name).join(", ")}
                </p>
              </div>
            )}

            {/* Roster: the comparison a supervisor actually needs. */}
            <div className="rounded-lg border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold text-foreground">Your students</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      {["Student", "Repository", "Commits · 21d", "PRs", "Tasks done", "Last active"].map(
                        (h, i) => (
                          <th
                            key={h}
                            className={`pb-2 text-xs font-semibold uppercase tracking-wider text-muted ${
                              i > 1 ? "text-right" : ""
                            }`}
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => {
                      const days = daysSince(s.lastActiveAt);
                      const isStale = s.repos.length > 0 && (days === null || days >= STALE_AFTER_DAYS);
                      return (
                        <tr key={s.userId} className="border-b border-border last:border-0">
                          <td className="py-3 pr-4">
                            <p className="font-medium text-foreground">{s.name}</p>
                            <p className="text-xs text-muted">{s.email}</p>
                          </td>
                          <td className="py-3 pr-4">
                            {s.repos.length === 0 ? (
                              <span className="text-xs italic text-muted">no repository connected</span>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {s.repos.map((r) => (
                                  <button
                                    key={r.fullName}
                                    onClick={() => openRepo(r.fullName)}
                                    disabled={busy === r.fullName}
                                    className={`rounded-md border px-2 py-0.5 text-xs font-medium transition-colors ${
                                      r.fullName === selectedRepo
                                        ? "border-accent bg-accent text-accent-foreground"
                                        : "border-border bg-surface text-foreground hover:bg-background"
                                    }`}
                                  >
                                    {r.fullName}
                                  </button>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="py-3 text-right font-medium text-foreground">{s.commits}</td>
                          <td className="py-3 text-right text-muted">{s.pullRequests}</td>
                          <td className="py-3 text-right text-muted">
                            {s.tasksTotal > 0 ? `${s.tasksDone}/${s.tasksTotal}` : "—"}
                          </td>
                          <td className="py-3 text-right">
                            {s.lastActiveAt ? (
                              <span className={isStale ? "text-danger-foreground" : "text-muted"}>
                                {timeAgoShort(s.lastActiveAt)}
                              </span>
                            ) : (
                              <span className="text-xs italic text-muted">never</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-muted">
                Commit counts come from the repository itself, not from anyone&apos;s status update.
              </p>
            </div>

            {selectedRepo ? (
              <>
                <div className="rounded-lg border border-border bg-surface p-5">
                  <p className="text-sm font-medium text-foreground">
                    Viewing{" "}
                    <a
                      href={`https://github.com/${selectedRepo}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      {selectedRepo}
                    </a>
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    Read-only. Cards are moved by the team and by their own commits.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <SummaryTile value={totalCommits} label="Commits · 21 days" />
                  <SummaryTile value={totalPrs} label="Pull requests" />
                  <SummaryTile value={members.length} label="Contributors" />
                  <SummaryTile value={`${doneCount}/${tasks.length}`} label="Tasks done" />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Heatmap days={heatmap} />
                  <MemberChart members={members} max={maxCommits} />
                </div>

                {/* Who is carrying the work, stated plainly rather than left to
                    be read off the chart. */}
                {members.length > 1 && (
                  <div className="rounded-lg border border-border bg-surface p-5">
                    <h2 className="text-sm font-semibold text-foreground">Share of commits</h2>
                    <div className="mt-3 space-y-2">
                      {members.map((m) => {
                        const share = totalCommits > 0 ? Math.round((m.commits / totalCommits) * 100) : 0;
                        return (
                          <div key={m.login} className="flex items-center gap-3">
                            <span className="w-40 shrink-0 truncate text-sm text-foreground">{m.name}</span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-background">
                              <div
                                className="h-full rounded-full bg-accent"
                                style={{ width: `${share}%` }}
                              />
                            </div>
                            <span className="w-20 shrink-0 text-right text-xs text-muted">
                              {share}% · {m.commits}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-xs text-muted">
                      An even split is not the goal — writing and analysis leave no commits. Treat a lopsided
                      split as a question to ask, not a verdict.
                    </p>
                  </div>
                )}

                <div className="rounded-lg border border-border bg-surface p-5">
                  <h2 className="text-sm font-semibold text-foreground">Board</h2>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {(
                      [
                        ["BACKLOG", "Backlog"],
                        ["IN_PROGRESS", "In Progress"],
                        ["IN_REVIEW", "In Review"],
                        ["DONE", "Done"],
                      ] as const
                    ).map(([status, label]) => {
                      const column = tasks.filter((t) => t.status === status);
                      return (
                        <div key={status} className="rounded-md bg-background p-3">
                          <div className="flex items-center justify-between">
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                              {label}
                            </h3>
                            <span className="text-xs text-muted">{column.length}</span>
                          </div>
                          <div className="mt-2 space-y-2">
                            {column.map((task) => (
                              <div key={task.id} className="rounded-md border border-border bg-surface p-2.5">
                                <p className="text-xs font-semibold text-muted">{task.key}</p>
                                <p className="mt-0.5 text-sm text-foreground">{task.title}</p>
                                {task.autoNote && (
                                  <p className="mt-1 text-[11px] italic text-muted">{task.autoNote}</p>
                                )}
                              </div>
                            ))}
                            {column.length === 0 && (
                              <p className="py-2 text-center text-xs text-muted">Nothing here</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <ActivityFeed items={activity} />
              </>
            ) : (
              <div className="rounded-lg border border-border bg-surface p-10 text-center">
                <p className="text-sm font-medium text-foreground">Pick a repository above</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                  Selecting one shows its heatmap, per-member commit chart, board, and activity feed.
                </p>
              </div>
            )}
          </>
        )}

        <p className="text-xs text-muted">
          You can see a repository only while one of your students has it connected. Nothing here is
          editable from this view.
        </p>
      </div>
    </div>
  );
}

/** Kept for the roster's badge rendering when a repo role needs showing. */
export function RepoRoleBadge({ role }: { role: string }) {
  return <Badge tone="neutral">{role.toLowerCase()}</Badge>;
}
