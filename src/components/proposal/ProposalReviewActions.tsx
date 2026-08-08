"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function ProposalReviewActions({ proposalId }: { proposalId: string }) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState<"approve" | "return" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "APPROVE" | "RETURN") {
    if (action === "RETURN" && !comment.trim()) {
      setError("Add a comment explaining what needs revision.");
      return;
    }
    setLoading(action === "APPROVE" ? "approve" : "return");
    setError(null);
    try {
      const res = await fetch("/api/proposal/review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId, action, comment }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to submit your decision.");
        return;
      }
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      {error && <p className="text-xs text-danger-foreground">{error}</p>}
      <textarea
        rows={2}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Comments (required to return for revision)"
        className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
      />
      <div className="flex gap-2">
        <Button variant="outline" disabled={loading !== null} onClick={() => decide("RETURN")}>
          {loading === "return" ? "Returning…" : "Return with comments"}
        </Button>
        <Button disabled={loading !== null} onClick={() => decide("APPROVE")}>
          {loading === "approve" ? "Approving…" : "Approve"}
        </Button>
      </div>
    </div>
  );
}
