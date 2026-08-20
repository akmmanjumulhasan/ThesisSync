"use client";

import { useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

interface CommentRow {
  id: string;
  authorName: string;
  authorRole: "STUDENT" | "SUPERVISOR" | "ADMIN";
  startOffset: number;
  endOffset: number;
  quotedText: string;
  body: string;
  resolved: boolean;
  createdAt: string;
}

interface VersionRow {
  id: string;
  versionNumber: number;
  content: string;
  wordCount: number;
  createdAt: string;
  comments: CommentRow[];
}

interface ChapterRow {
  id: string;
  title: string;
  studentName: string;
  studentEmail: string;
  versionCount: number;
  latestVersion: { versionNumber: number; wordCount: number; createdAt: string } | null;
}

/** Walks a container's text nodes to turn the current window selection into character offsets relative to its full text content. Returns null if the selection is empty or outside the container. */
function getSelectionOffsets(container: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  const preStart = document.createRange();
  preStart.selectNodeContents(container);
  preStart.setEnd(range.startContainer, range.startOffset);
  const start = preStart.toString().length;

  const preEnd = document.createRange();
  preEnd.selectNodeContents(container);
  preEnd.setEnd(range.endContainer, range.endOffset);
  const end = preEnd.toString().length;

  return end > start ? { start, end } : null;
}

export function DraftReviewsClient({ chapters }: { chapters: ChapterRow[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chapterTitle, setChapterTitle] = useState<string>("");
  const [studentName, setStudentName] = useState<string>("");
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string>("");
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number; text: string } | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [posting, setPosting] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  async function openChapter(chapter: ChapterRow) {
    setSelectedId(chapter.id);
    setChapterTitle(chapter.title);
    setStudentName(chapter.studentName);
    setLoadingDetail(true);
    setError(null);
    setPendingSelection(null);
    try {
      const res = await fetch(`/api/thesis-drafts?chapterId=${chapter.id}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load this chapter.");
        setVersions(null);
        return;
      }
      setVersions(data.versions);
      setActiveVersionId(data.versions[0]?.id ?? "");
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setLoadingDetail(false);
    }
  }

  function handleMouseUp() {
    if (!contentRef.current) return;
    const offsets = getSelectionOffsets(contentRef.current);
    if (!offsets) {
      setPendingSelection(null);
      return;
    }
    const content = activeVersion?.content ?? "";
    setPendingSelection({ ...offsets, text: content.slice(offsets.start, offsets.end) });
  }

  async function submitComment() {
    if (!activeVersionId || !pendingSelection || !commentBody.trim()) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch("/api/thesis-drafts/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionId: activeVersionId,
          startOffset: pendingSelection.start,
          endOffset: pendingSelection.end,
          quotedText: pendingSelection.text,
          body: commentBody,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to add comment.");
        return;
      }
      setVersions((prev) =>
        prev ? prev.map((v) => (v.id === activeVersionId ? { ...v, comments: [...v.comments, data.comment] } : v)) : prev
      );
      setCommentBody("");
      setPendingSelection(null);
      window.getSelection()?.removeAllRanges();
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setPosting(false);
    }
  }

  async function resolveComment(commentId: string, resolved: boolean) {
    try {
      const res = await fetch("/api/thesis-drafts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentId, resolved }),
      });
      if (!res.ok) return;
      setVersions((prev) =>
        prev
          ? prev.map((v) => ({ ...v, comments: v.comments.map((c) => (c.id === commentId ? { ...c, resolved } : c)) }))
          : prev
      );
    } catch {
      // best-effort — leave the toggle as-is on failure
    }
  }

  const activeVersion = versions?.find((v) => v.id === activeVersionId) ?? null;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-bold text-foreground">Drafts to review</h1>
        <p className="mt-1 text-sm text-muted">Chapters from your accepted students. Select text to leave an inline comment.</p>
      </div>

      <div className="grid gap-5 bg-background p-6 lg:grid-cols-[280px_1fr]">
        <div className="rounded-lg border border-border bg-surface p-2">
          {chapters.length === 0 && <p className="p-3 text-sm text-muted">Nothing to review yet.</p>}
          <ul className="space-y-1">
            {chapters.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => openChapter(c)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    selectedId === c.id ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-background"
                  }`}
                >
                  <p className="font-medium">{c.title}</p>
                  <p className={`text-xs ${selectedId === c.id ? "opacity-80" : "text-muted"}`}>{c.studentName}</p>
                  <p className={`text-xs ${selectedId === c.id ? "opacity-80" : "text-muted"}`}>
                    {c.versionCount} version{c.versionCount === 1 ? "" : "s"}
                    {c.latestVersion ? ` · v${c.latestVersion.versionNumber}` : ""}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-5">
          {error && <p className="text-sm text-danger-foreground">{error}</p>}
          {!selectedId && <p className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">Select a chapter to review.</p>}
          {selectedId && loadingDetail && <p className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">Loading…</p>}

          {selectedId && !loadingDetail && versions && versions.length > 0 && (
            <>
              <div className="rounded-lg border border-border bg-surface p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-foreground">{chapterTitle}</h3>
                    <p className="text-xs text-muted">{studentName}</p>
                  </div>
                  <select
                    value={activeVersionId}
                    onChange={(e) => {
                      setActiveVersionId(e.target.value);
                      setPendingSelection(null);
                    }}
                    className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
                  >
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        v{v.versionNumber} · {v.wordCount} words
                      </option>
                    ))}
                  </select>
                </div>

                {activeVersion && (
                  <div
                    ref={contentRef}
                    onMouseUp={handleMouseUp}
                    className="mt-4 max-h-[28rem] overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-background p-4 text-sm leading-relaxed text-foreground"
                  >
                    {activeVersion.content}
                  </div>
                )}

                {pendingSelection && (
                  <div className="mt-3 rounded-md border border-accent bg-surface p-3">
                    <p className="text-xs italic text-muted">&ldquo;{pendingSelection.text}&rdquo;</p>
                    <textarea
                      rows={2}
                      value={commentBody}
                      onChange={(e) => setCommentBody(e.target.value)}
                      placeholder="Leave a comment on this selection…"
                      className="mt-2 w-full resize-none rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
                    />
                    <div className="mt-2 flex gap-2">
                      <Button disabled={posting || !commentBody.trim()} onClick={submitComment}>
                        {posting ? "Posting…" : "Add comment"}
                      </Button>
                      <Button variant="outline" onClick={() => setPendingSelection(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {activeVersion && (
                <div className="rounded-lg border border-border bg-surface p-5">
                  <h3 className="font-semibold text-foreground">Comments — v{activeVersion.versionNumber}</h3>
                  {activeVersion.comments.length === 0 ? (
                    <p className="mt-3 text-sm text-muted">No comments on this version yet. Select text above to add one.</p>
                  ) : (
                    <ul className="mt-3 space-y-2.5">
                      {activeVersion.comments.map((c) => (
                        <li key={c.id} className="rounded-md border border-border bg-background p-3 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-medium text-foreground">{c.authorName}</p>
                            <Badge tone={c.resolved ? "success" : "neutral"}>{c.resolved ? "Resolved" : "Open"}</Badge>
                          </div>
                          {c.quotedText && <p className="mt-1 border-l-2 border-border pl-2 text-xs italic text-muted">&ldquo;{c.quotedText}&rdquo;</p>}
                          <p className="mt-1.5 text-foreground">{c.body}</p>
                          <button
                            type="button"
                            onClick={() => resolveComment(c.id, !c.resolved)}
                            className="mt-1.5 text-xs font-medium text-accent hover:underline"
                          >
                            Mark as {c.resolved ? "open" : "resolved"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
