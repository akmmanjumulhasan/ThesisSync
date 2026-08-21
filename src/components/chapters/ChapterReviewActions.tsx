"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { availableActions, type ChapterAction, type ChapterStatus } from "@/lib/chapters";

/**
 * The supervisor's controls for one chapter.
 *
 * The buttons are generated from the pipeline table, not hard-coded, so a
 * supervisor is only ever offered a move the server will accept from the state
 * the chapter is actually in — and every move offered here is one the
 * requirement says must be an explicit supervisor action.
 *
 * "Return for revision" reveals its comment box and refuses to fire without
 * one, matching the same rule the route handler enforces.
 */
export function ChapterReviewActions({ chapterId, status }: { chapterId: string; status: ChapterStatus }) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState<ChapterAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actions = availableActions(status, "SUPERVISOR");
  // Any action here may demand a reason, so the box is driven by the table
  // rather than by one action's name.
  const needsComment = actions.some((a) => a.requiresComment);

  async function run(action: ChapterAction, requiresComment: boolean) {
    if (requiresComment && !comment.trim()) {
      setError("Add a comment explaining what needs revision.");
      return;
    }
    setPending(action);
    setError(null);
    try {
      const res = await fetch("/api/chapters/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId, action, comment }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to record your decision.");
        return;
      }
      setComment("");
      router.refresh();
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  if (actions.length === 0) return null;

  return (
    <div className="mt-4 space-y-2 border-t border-border pt-4">
      {error && <p className="text-xs text-danger-foreground">{error}</p>}

      {needsComment && (
        <textarea
          rows={2}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={`Comments (required to ${actions.find((a) => a.requiresComment)!.label.toLowerCase()})`}
          className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
        />
      )}

      <div className="flex flex-wrap gap-2">
        {actions.map((t) => (
          <Button
            key={t.action}
            variant={t.to === "DRAFT" ? "outline" : "primary"}
            disabled={pending !== null}
            title={t.hint}
            onClick={() => run(t.action, t.requiresComment)}
          >
            {pending === t.action ? "Working…" : t.label}
          </Button>
        ))}
      </div>

      <p className="text-xs text-muted">{actions.map((t) => t.hint).join(" ")}</p>
    </div>
  );
}
