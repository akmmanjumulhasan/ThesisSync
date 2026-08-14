"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type Mode = "SUPERVISOR" | "TEAMMATE" | "INVITES" | "TEAM";
type Status = "PENDING" | "ACCEPTED" | "DECLINED" | null;

interface SupervisorMatch {
  supervisorId: string;
  name: string;
  researchInterests: string[];
  fitScore: number;
  activeLoad: number;
  maxLoad: number;
  isAtCapacity: boolean;
  avgResponseDays: number;
  requestStatus: Status;
}

interface TeammateMatch {
  userId: string;
  name: string;
  githubUsername: string;
  topLanguages: string[];
  totalCommits: number;
  teamPost: string | null;
  inviteStatus: Status;
}

interface ReceivedInvite {
  id: string;
  fromUserId: string;
  fromName: string;
  githubUsername: string | null;
  isVerified: boolean;
  topLanguages: string[];
  totalCommits: number;
  declaredSkills: string[];
  teamPost: string | null;
  status: "PENDING" | "ACCEPTED" | "DECLINED";
}

interface Teammate {
  userId: string;
  name: string;
  email: string;
  department: string | null;
  githubUsername: string | null;
  isVerified: boolean;
  topLanguages: string[];
  totalCommits: number;
  declaredSkills: string[];
  teamPost: string | null;
  joinedAt: string;
  origin: "SENT" | "RECEIVED";
  removal: {
    status: "PENDING" | "ACCEPTED" | "DECLINED";
    supervisorName: string;
    decisionNote: string | null;
  } | null;
}

export function MatchmakingClient({
  userName,
  initialKeywords,
  initialSkills,
  initialPendingInviteCount,
  initialTeamCount,
}: {
  userName: string;
  initialKeywords: string;
  initialSkills: string;
  initialPendingInviteCount: number;
  initialTeamCount: number;
}) {
  const [mode, setMode] = useState<Mode>("SUPERVISOR");
  const [keywordsInput, setKeywordsInput] = useState(initialKeywords);
  const [skillsInput, setSkillsInput] = useState(initialSkills);

  const [supervisorMatches, setSupervisorMatches] = useState<SupervisorMatch[]>([]);
  const [teammateMatches, setTeammateMatches] = useState<TeammateMatch[]>([]);
  const [receivedInvites, setReceivedInvites] = useState<ReceivedInvite[]>([]);
  const [teammates, setTeammates] = useState<Teammate[]>([]);
  const [pendingInviteCount, setPendingInviteCount] = useState(initialPendingInviteCount);
  const [teamCount, setTeamCount] = useState(initialTeamCount);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const runSupervisorMatch = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!keywordsInput.trim()) {
        // Silent means "auto-run on load/mode-switch". An empty field there is the
        // normal first-impression state, not something to scold the user about.
        if (!opts?.silent) setError("Enter at least one research keyword.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/match/supervisors?keywords=${encodeURIComponent(keywordsInput)}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed to run match.");
          return;
        }
        setSupervisorMatches(data.matches);
        setHasSearched(true);
      } finally {
        setLoading(false);
      }
    },
    [keywordsInput]
  );

  const runTeammateMatch = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!skillsInput.trim()) {
        if (!opts?.silent) setError("Enter at least one skill.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/match/teammates?skills=${encodeURIComponent(skillsInput)}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed to run match.");
          return;
        }
        setTeammateMatches(data.matches);
        setHasSearched(true);
      } finally {
        setLoading(false);
      }
    },
    [skillsInput]
  );

  const loadReceivedInvites = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/match/invite");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load invites.");
        return;
      }
      setReceivedInvites(data.invites);
      setPendingInviteCount(data.invites.filter((i: ReceivedInvite) => i.status === "PENDING").length);
      setHasSearched(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTeam = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/match/team");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load your team.");
        return;
      }
      setTeammates(data.teammates);
      setTeamCount(data.count);
      setHasSearched(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-run once per mode switch so the panel isn't empty on first load. Silently,
  // so an unfilled field doesn't greet the user with a validation error.
  useEffect(() => {
    setHasSearched(false);
    setError(null);
    if (mode === "SUPERVISOR") void runSupervisorMatch({ silent: true });
    else if (mode === "TEAMMATE") void runTeammateMatch({ silent: true });
    else if (mode === "TEAM") void loadTeam();
    else void loadReceivedInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function sendSupervisionRequest(supervisorId: string) {
    setSupervisorMatches((prev) =>
      prev.map((m) => (m.supervisorId === supervisorId ? { ...m, requestStatus: "PENDING" } : m))
    );
    const res = await fetch("/api/match/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supervisorId }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Failed to send request.");
      void runSupervisorMatch();
    }
  }

  async function inviteTeammate(toUserId: string) {
    setTeammateMatches((prev) =>
      prev.map((m) => (m.userId === toUserId ? { ...m, inviteStatus: "PENDING" } : m))
    );
    const res = await fetch("/api/match/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toUserId }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Failed to send invite.");
      void runTeammateMatch();
    }
  }

  async function respondToInvite(inviteId: string, action: "ACCEPT" | "DECLINE") {
    const newStatus = action === "ACCEPT" ? "ACCEPTED" : "DECLINED";
    setReceivedInvites((prev) => prev.map((i) => (i.id === inviteId ? { ...i, status: newStatus } : i)));
    setPendingInviteCount((n) => Math.max(0, n - 1));
    // Accepting is exactly what puts someone on the team, so the My Team badge
    // should reflect it immediately rather than waiting for that tab to be opened.
    if (action === "ACCEPT") setTeamCount((n) => n + 1);

    const res = await fetch("/api/match/invite", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteId, action }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Failed to respond to invite.");
      void loadReceivedInvites();
      // The optimistic bump above assumed success; re-read the real roster size.
      if (action === "ACCEPT") void loadTeam();
    }
  }

  /**
   * Files a removal with the student's supervisor. Nothing about the team
   * changes here — the card only flips to "awaiting approval" until the
   * supervisor decides.
   */
  async function requestRemoval(targetUserId: string, reason: string) {
    setError(null);
    setNotice(null);
    const res = await fetch("/api/match/team/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId, reason }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not send the removal request.");
      return false;
    }
    setNotice(`Sent to ${data.supervisorName} for approval. Your teammate stays on the team until they decide.`);
    await loadTeam();
    return true;
  }

  const emptyMessage =
    mode === "SUPERVISOR"
      ? "No supervisors match those keywords yet. Try broader terms."
      : mode === "TEAMMATE"
        ? "No GitHub-verified teammates match those skills yet."
        : mode === "TEAM"
          ? "No teammates yet. Invite someone from Teammate Mode, or accept an invite from My Invites — whoever accepts shows up here."
          : "No invites yet. Invites other students send you will show up here.";

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-lg font-bold text-foreground">Unified Matchmaking Engine</h1>
        <Link href="/dashboard" className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-background">
          <span className="text-sm text-foreground">{userName}</span>
          <Avatar name={userName} size={32} />
        </Link>
      </div>

      {/* Working area */}
      <div className="space-y-5 bg-background p-6">
        {/* Tabs */}
        <div className="inline-flex overflow-hidden rounded-md border border-border">
          <button
            onClick={() => setMode("SUPERVISOR")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              mode === "SUPERVISOR"
                ? "bg-brand text-brand-foreground"
                : "bg-surface text-foreground hover:bg-background"
            }`}
          >
            Supervisor Mode
          </button>
          <button
            onClick={() => setMode("TEAMMATE")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              mode === "TEAMMATE"
                ? "bg-brand text-brand-foreground"
                : "bg-surface text-foreground hover:bg-background"
            }`}
          >
            Teammate Mode
          </button>
          <button
            onClick={() => setMode("INVITES")}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
              mode === "INVITES"
                ? "bg-brand text-brand-foreground"
                : "bg-surface text-foreground hover:bg-background"
            }`}
          >
            My Invites
            {pendingInviteCount > 0 && (
              <span
                className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-semibold ${
                  mode === "INVITES" ? "bg-white/20 text-brand-foreground" : "bg-accent text-accent-foreground"
                }`}
              >
                {pendingInviteCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setMode("TEAM")}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
              mode === "TEAM"
                ? "bg-brand text-brand-foreground"
                : "bg-surface text-foreground hover:bg-background"
            }`}
          >
            My Team
            {teamCount > 0 && (
              <span
                className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-semibold ${
                  mode === "TEAM" ? "bg-white/20 text-brand-foreground" : "bg-accent text-accent-foreground"
                }`}
              >
                {teamCount}
              </span>
            )}
          </button>
        </div>

        {/* Search card: Invites and Team modes have nothing to search, just a refresh */}
        {mode === "INVITES" || mode === "TEAM" ? (
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-5">
            <div>
              <p className="text-sm font-medium text-foreground">
                {mode === "INVITES" ? "Invites sent to you" : "Your team"}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {mode === "INVITES"
                  ? "Accept to team up, or decline if it's not a fit."
                  : teamCount > 0
                    ? `${teamCount} teammate${teamCount === 1 ? "" : "s"} — everyone whose invite was accepted, either way round.`
                    : "Teammates appear here once an invite is accepted."}
              </p>
            </div>
            <Button
              onClick={() => (mode === "INVITES" ? loadReceivedInvites() : loadTeam())}
              disabled={loading}
              variant="outline"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-surface p-5">
            <label className="mb-2 block text-sm font-medium text-muted">
              {mode === "SUPERVISOR" ? "Your research keywords" : "Your declared skills"}
            </label>
            <input
              value={mode === "SUPERVISOR" ? keywordsInput : skillsInput}
              onChange={(e) =>
                mode === "SUPERVISOR" ? setKeywordsInput(e.target.value) : setSkillsInput(e.target.value)
              }
              placeholder={
                mode === "SUPERVISOR"
                  ? "citation graphs, low-resource NLP, gap detection"
                  : "Python, PyTorch, Data pipelines"
              }
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
            />
            <Button
              onClick={() => (mode === "SUPERVISOR" ? runSupervisorMatch() : runTeammateMatch())}
              disabled={loading}
              className="mt-3"
            >
              {loading ? "Matching…" : "Re-run match"}
            </Button>
          </div>
        )}

        {notice && <p className="text-sm text-success-foreground">{notice}</p>}
        {error && <p className="text-sm text-danger-foreground">{error}</p>}

        {/* Results */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mode === "SUPERVISOR" &&
            supervisorMatches.map((m) => (
              <SupervisorCard
                key={m.supervisorId}
                match={m}
                onSend={() => sendSupervisionRequest(m.supervisorId)}
              />
            ))}
          {mode === "TEAMMATE" &&
            teammateMatches.map((m) => (
              <TeammateCard key={m.userId} match={m} onInvite={() => inviteTeammate(m.userId)} />
            ))}
          {mode === "INVITES" &&
            receivedInvites.map((i) => (
              <InviteCard
                key={i.id}
                invite={i}
                onAccept={() => respondToInvite(i.id, "ACCEPT")}
                onDecline={() => respondToInvite(i.id, "DECLINE")}
              />
            ))}
          {mode === "TEAM" &&
            teammates.map((t) => (
              <TeamMemberCard key={t.userId} teammate={t} onRequestRemoval={requestRemoval} />
            ))}
        </div>

        {hasSearched &&
          !loading &&
          ((mode === "SUPERVISOR" && supervisorMatches.length === 0) ||
            (mode === "TEAMMATE" && teammateMatches.length === 0) ||
            (mode === "INVITES" && receivedInvites.length === 0) ||
            (mode === "TEAM" && teammates.length === 0)) && (
            <p className="text-sm text-muted">{emptyMessage}</p>
          )}
      </div>
    </div>
  );
}

function SupervisorCard({ match, onSend }: { match: SupervisorMatch; onSend: () => void }) {
  return (
    <div className="flex flex-col justify-between rounded-lg border border-border bg-surface p-4">
      <div>
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-foreground">{match.name}</h3>
          <Badge tone="success">{match.fitScore}% fit</Badge>
        </div>
        <p className="mt-2 text-sm text-muted">
          {match.researchInterests.join(", ")} · {match.activeLoad}/{match.maxLoad} active students
        </p>
        <p className="mt-1 text-xs text-muted">Responds in ~{match.avgResponseDays}d</p>
      </div>
      <div className="mt-4">
        {match.isAtCapacity ? (
          <Badge tone="danger">At Capacity</Badge>
        ) : match.requestStatus === "PENDING" ? (
          <Button variant="outline" disabled className="w-full">
            Request Sent
          </Button>
        ) : match.requestStatus === "ACCEPTED" ? (
          <Badge tone="success">Accepted</Badge>
        ) : (
          <Button onClick={onSend} className="w-full">
            Send request
          </Button>
        )}
      </div>
    </div>
  );
}

function TeammateCard({ match, onInvite }: { match: TeammateMatch; onInvite: () => void }) {
  return (
    <div className="flex flex-col justify-between rounded-lg border border-border bg-surface p-4">
      <div>
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-foreground">{match.name}</h3>
          <Badge tone="neutral">GitHub verified</Badge>
        </div>
        <p className="mt-2 text-sm text-muted">
          Top languages: {match.topLanguages.join(", ") || "N/A"} · {match.totalCommits} commits/yr
        </p>
        <p className="mt-1 text-xs text-muted">
          {match.teamPost ? `Posted "${match.teamPost}"` : "Open to teaming"}
        </p>
      </div>
      <div className="mt-4">
        {match.inviteStatus === "PENDING" ? (
          <Button variant="outline" disabled className="w-full">
            Invited
          </Button>
        ) : match.inviteStatus === "ACCEPTED" ? (
          <Badge tone="success">Teamed up</Badge>
        ) : (
          <Button onClick={onInvite} className="w-full">
            Invite to Team
          </Button>
        )}
      </div>
    </div>
  );
}

function TeamMemberCard({
  teammate,
  onRequestRemoval,
}: {
  teammate: Teammate;
  onRequestRemoval: (targetUserId: string, reason: string) => Promise<boolean>;
}) {
  const skills = teammate.topLanguages.length > 0 ? teammate.topLanguages : teammate.declaredSkills;
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pending = teammate.removal?.status === "PENDING";

  async function submit() {
    setSubmitting(true);
    try {
      const ok = await onRequestRemoval(teammate.userId, reason);
      if (ok) {
        setShowForm(false);
        setReason("");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col justify-between rounded-lg border border-border bg-surface p-4">
      <div>
        <div className="flex items-start gap-3">
          <Avatar name={teammate.name} size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="truncate font-semibold text-foreground">{teammate.name}</h3>
              {teammate.isVerified && <Badge tone="neutral">GitHub verified</Badge>}
            </div>
            <p className="truncate text-xs text-muted">{teammate.email}</p>
          </div>
        </div>

        <p className="mt-3 text-sm text-muted">
          {skills.length > 0 ? skills.join(", ") : "No skills listed"}
          {teammate.totalCommits > 0 && ` · ${teammate.totalCommits} commits/yr`}
        </p>
        {teammate.department && <p className="mt-1 text-xs text-muted">{teammate.department}</p>}
        {teammate.teamPost && <p className="mt-1 text-xs text-muted">Posted &quot;{teammate.teamPost}&quot;</p>}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <Badge tone="success">On your team</Badge>
        <span className="text-xs text-muted">
          {teammate.origin === "SENT" ? "You invited" : "Invited you"} ·{" "}
          {new Date(teammate.joinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
      </div>

      {teammate.githubUsername && (
        <a
          href={`https://github.com/${teammate.githubUsername}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 text-xs font-medium text-accent hover:underline"
        >
          @{teammate.githubUsername}
        </a>
      )}

      {/* Removal: never immediate — it goes to the supervisor for a decision. */}
      <div className="mt-3 border-t border-border pt-3">
        {pending ? (
          <p className="text-xs text-muted">
            <span className="font-medium text-warning-foreground">Removal pending</span> — waiting on{" "}
            {teammate.removal?.supervisorName} to decide.
          </p>
        ) : teammate.removal?.status === "DECLINED" ? (
          <div>
            <p className="text-xs text-muted">
              <span className="font-medium text-danger-foreground">Removal declined</span> by{" "}
              {teammate.removal.supervisorName}.
            </p>
            {teammate.removal.decisionNote && (
              <p className="mt-0.5 text-[11px] italic text-muted">
                &quot;{teammate.removal.decisionNote}&quot;
              </p>
            )}
            <button
              onClick={() => setShowForm(true)}
              className="mt-1 text-xs font-medium text-muted hover:text-danger-foreground"
            >
              Ask again
            </button>
          </div>
        ) : !showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="text-xs font-medium text-muted hover:text-danger-foreground"
          >
            Request removal
          </button>
        ) : (
          <div>
            <label className="text-[11px] text-muted">
              Why should {teammate.name.split(" ")[0]} be removed? Your supervisor sees this.
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="At least 10 characters…"
              className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-accent"
            />
            <div className="mt-2 flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  setReason("");
                }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button onClick={submit} disabled={submitting || reason.trim().length < 10} className="flex-1">
                {submitting ? "Sending…" : "Send to supervisor"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InviteCard({
  invite,
  onAccept,
  onDecline,
}: {
  invite: ReceivedInvite;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="flex flex-col justify-between rounded-lg border border-border bg-surface p-4">
      <div>
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-foreground">{invite.fromName}</h3>
          {invite.isVerified && <Badge tone="neutral">GitHub verified</Badge>}
        </div>
        <p className="mt-2 text-sm text-muted">
          {invite.topLanguages.length > 0
            ? `Top languages: ${invite.topLanguages.join(", ")} · ${invite.totalCommits} commits/yr`
            : invite.declaredSkills.join(", ") || "No skills listed"}
        </p>
        {invite.teamPost && <p className="mt-1 text-xs text-muted">Posted &quot;{invite.teamPost}&quot;</p>}
      </div>
      <div className="mt-4">
        {invite.status === "ACCEPTED" ? (
          <Badge tone="success">Teamed up</Badge>
        ) : invite.status === "DECLINED" ? (
          <Badge tone="danger">Declined</Badge>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={onDecline} className="flex-1">
              Decline
            </Button>
            <Button onClick={onAccept} className="flex-1">
              Accept
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
