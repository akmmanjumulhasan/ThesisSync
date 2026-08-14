"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

/**
 * Module 1 (Member 2): the supervisor's side of teammate removal.
 *
 * A student can't drop a teammate on their own — the request lands here, and the
 * team only changes when the supervisor approves.
 */

export interface RemovalRequestRow {
  id: string;
  requesterName: string;
  requesterEmail: string;
  targetName: string;
  targetEmail: string;
  reason: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED";
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export function RemovalDecisions({ initialRequests }: { initialRequests: RemovalRequestRow[] }) {
  const router = useRouter();
  const [requests, setRequests] = useState(initialRequests);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(requestId: string, action: "APPROVE" | "DECLINE") {
    setBusyId(requestId);
    setError(null);
    try {
      const res = await fetch("/api/match/team/remove", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action, note: notes[requestId] ?? "" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not record your decision.");
        return;
      }
      setRequests((prev) =>
        prev.map((r) =>
          r.id === requestId
            ? {
                ...r,
                status: action === "APPROVE" ? "ACCEPTED" : "DECLINED",
                decisionNote: notes[requestId]?.trim() || null,
                decidedAt: new Date().toISOString(),
              }
            : r
        )
      );
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  const pending = requests.filter((r) => r.status === "PENDING");
  const decided = requests.filter((r) => r.status !== "PENDING");

  return (
    <div>
      {error && <p className="mb-3 text-sm text-danger-foreground">{error}</p>}

      {requests.length === 0 && (
        <p className="text-sm text-muted">
          No teammate removal requests. They appear here when one of your students asks to drop a teammate.
        </p>
      )}

      <div className="space-y-3">
        {pending.map((r) => (
          <div key={r.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm text-foreground">
                <strong className="font-semibold">{r.requesterName}</strong> wants to remove{" "}
                <strong className="font-semibold">{r.targetName}</strong>
              </p>
              <Badge tone="warning">Awaiting your decision</Badge>
            </div>
            <p className="mt-1 text-xs text-muted">
              {r.requesterEmail} · about {r.targetEmail}
            </p>

            <p className="mt-3 rounded-md bg-background px-3 py-2 text-sm text-foreground">
              &quot;{r.reason}&quot;
            </p>

            <input
              value={notes[r.id] ?? ""}
              onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
              placeholder="Optional note back to the student"
              className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
            />

            <div className="mt-3 flex gap-2">
              <Button
                variant="outline"
                onClick={() => decide(r.id, "DECLINE")}
                disabled={busyId === r.id}
                className="flex-1"
              >
                Decline
              </Button>
              <Button onClick={() => decide(r.id, "APPROVE")} disabled={busyId === r.id} className="flex-1">
                {busyId === r.id ? "Saving…" : "Approve removal"}
              </Button>
            </div>
          </div>
        ))}

        {decided.map((r) => (
          <div key={r.id} className="rounded-lg border border-border bg-surface p-4 opacity-75">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm text-foreground">
                {r.requesterName} → remove {r.targetName}
              </p>
              <Badge tone={r.status === "ACCEPTED" ? "success" : "danger"}>
                {r.status === "ACCEPTED" ? "Removed" : "Declined"}
              </Badge>
            </div>
            {r.decisionNote && <p className="mt-1 text-xs italic text-muted">&quot;{r.decisionNote}&quot;</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
