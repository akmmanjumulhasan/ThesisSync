"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export interface PendingRequestRow {
  id: string;
  studentName: string;
  researchKeywords: string;
  matchPercent: number;
}

export function PendingRequestsTable({ requests }: { requests: PendingRequestRow[] }) {
  const router = useRouter();
  const [items, setItems] = useState(requests);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function respond(id: string, action: "ACCEPT" | "DECLINE") {
    setLoadingId(id);
    setError(null);
    try {
      const res = await fetch("/api/match/request", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: id, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to respond to request.");
        return;
      }
      setItems((prev) => prev.filter((r) => r.id !== id));
      router.refresh();
    } finally {
      setLoadingId(null);
    }
  }

  if (items.length === 0) {
    return <p className="px-6 py-8 text-center text-sm text-muted">No pending requests right now.</p>;
  }

  return (
    <div>
      {error && <p className="px-6 pt-4 text-sm text-danger-foreground">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-6 py-3">Student</th>
              <th className="px-6 py-3">Research Keywords</th>
              <th className="px-6 py-3">Keyword Match</th>
              <th className="px-6 py-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((r) => (
              <tr key={r.id}>
                <td className="px-6 py-4 font-medium text-foreground">{r.studentName}</td>
                <td className="max-w-xs truncate px-6 py-4 text-muted">{r.researchKeywords || "N/A"}</td>
                <td className="px-6 py-4">
                  <Badge tone="success">{r.matchPercent}% fit</Badge>
                </td>
                <td className="px-6 py-4">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={loadingId === r.id}
                      onClick={() => respond(r.id, "DECLINE")}
                    >
                      Decline
                    </Button>
                    <Button disabled={loadingId === r.id} onClick={() => respond(r.id, "ACCEPT")}>
                      Accept
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
