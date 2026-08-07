"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type Mode = "SUPERVISOR" | "TEAMMATE" | "INVITES";
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

export function MatchmakingClient({
  userName,
  initialKeywords,
  initialSkills,
  initialPendingInviteCount,
}: {
  userName: string;
  initialKeywords: string;
  initialSkills: string;
  initialPendingInviteCount: number;
}) {
  const [mode, setMode] = useState<Mode>("SUPERVISOR");
  const [keywordsInput, setKeywordsInput] = useState(initialKeywords);
  const [skillsInput, setSkillsInput] = useState(initialSkills);

  const [supervisorMatches, setSupervisorMatches] = useState<SupervisorMatch[]>([]);
  const [teammateMatches, setTeammateMatches] = useState<TeammateMatch[]>([]);
  const [receivedInvites, setReceivedInvites] = useState<ReceivedInvite[]>([]);
  const [pendingInviteCount, setPendingInviteCount] = useState(initialPendingInviteCount);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  // Auto-run once per mode switch so the panel isn't empty on first load. Silently,
  // so an unfilled field doesn't greet the user with a validation error.
  useEffect(() => {
    setHasSearched(false);
    setError(null);
    if (mode === "SUPERVISOR") void runSupervisorMatch({ silent: true });
    else if (mode === "TEAMMATE") void runTeammateMatch({ silent: true });
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

    const res = await fetch("/api/match/invite", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteId, action }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Failed to respond to invite.");
      void loadReceivedInvites();
    }
  }

  const emptyMessage =
    mode === "SUPERVISOR"
      ? "No supervisors match those keywords yet. Try broader terms."
      : mode === "TEAMMATE"
        ? "No GitHub-verified teammates match those skills yet."
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
        </div>

        {/* Search card: Invites mode has nothing to search, just a refresh */}
        {mode === "INVITES" ? (
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-5">
            <div>
              <p className="text-sm font-medium text-foreground">Invites sent to you</p>
              <p className="mt-0.5 text-xs text-muted">Accept to team up, or decline if it's not a fit.</p>
            </div>
            <Button onClick={() => loadReceivedInvites()} disabled={loading} variant="outline">
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
        </div>

        {hasSearched &&
          !loading &&
          ((mode === "SUPERVISOR" && supervisorMatches.length === 0) ||
            (mode === "TEAMMATE" && teammateMatches.length === 0) ||
            (mode === "INVITES" && receivedInvites.length === 0)) && (
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
