"use client";

/**
 * Module 2 (Member 2): the analytics visuals, shared between the student's own
 * board and a supervisor's view of a student's work.
 *
 * Extracted so both read the same charts. A supervisor comparing students
 * against a differently-scaled heatmap than the one the student sees would be
 * comparing two different claims about the same commits.
 */

export type Status = "BACKLOG" | "IN_PROGRESS" | "IN_REVIEW" | "DONE";

export interface HeatmapDay {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface Member {
  login: string;
  name: string;
  commits: number;
  pullRequests: number;
  tasksMoved: number;
}

export interface ActivityItem {
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
 * emerald accent. Index is the 0-4 level from buildHeatmap; level 0 is a
 * neutral surface rather than a pale green, so "no commits" cannot be misread
 * as "a few commits".
 */
export const HEAT_RAMP = ["#eceef1", "#d1fae5", "#6ee7b7", "#10b981", "#047857"];

/**
 * Categorical slots for the per-member chart, assigned in fixed order and never
 * cycled — a member keeps their colour as the roster grows. Validated for
 * colourblind separation; every bar is also directly labelled, so identity
 * never rests on colour alone.
 */
export const MEMBER_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7"];

export function timeAgoShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function SummaryTile({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="font-serif text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}

export function Heatmap({ days }: { days: HeatmapDay[] }) {
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

export function MemberChart({ members, max }: { members: Member[]; max: number }) {
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

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
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
                  {item.taskKey && (
                    <span className="rounded bg-background px-1.5 py-0.5 text-[11px] text-muted">
                      {item.taskKey}
                    </span>
                  )}
                  {item.movedTaskTo && (
                    <span className="rounded bg-success-bg px-1.5 py-0.5 text-[11px] text-success-foreground">
                      → {item.movedTaskTo.replace("_", " ").toLowerCase()}
                    </span>
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
