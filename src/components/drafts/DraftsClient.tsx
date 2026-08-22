"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { computeWordDiff, type DiffToken } from "@/lib/diff";

interface WritingIssue {
  message: string;
  shortMessage: string;
  offset: number;
  length: number;
  ruleId: string;
  category: string;
  replacements: string[];
}

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
  writingCheck: { issues: WritingIssue[] } | null;
  createdAt: string;
  comments: CommentRow[];
}

interface ChapterSummary {
  id: string;
  title: string;
  versionCount: number;
  latestVersion: { versionNumber: number; wordCount: number; createdAt: string } | null;
  updatedAt: string;
}

export function DraftsClient({ initialChapters }: { initialChapters: ChapterSummary[] }) {
  const [chapters, setChapters] = useState<ChapterSummary[]>(initialChapters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [chapterTitle, setChapterTitle] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [editorContent, setEditorContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [diffA, setDiffA] = useState<string>("");
  const [diffB, setDiffB] = useState<string>("");
  const [activeVersionId, setActiveVersionId] = useState<string>("");

  async function openChapter(id: string) {
    setSelectedId(id);
    setLoadingDetail(true);
    setError(null);
    try {
      const res = await fetch(`/api/thesis-drafts?chapterId=${id}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load this chapter.");
        setVersions(null);
        return;
      }
      setChapterTitle(data.chapter.title);
      setVersions(data.versions);
      setEditorContent(data.versions[0]?.content ?? "");
      setActiveVersionId(data.versions[0]?.id ?? "");
      if (data.versions.length >= 2) {
        setDiffA(data.versions[1].id);
        setDiffB(data.versions[0].id);
      } else {
        setDiffA("");
        setDiffB("");
      }
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function createChapter() {
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/thesis-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-chapter", title }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create the chapter.");
        return;
      }
      setChapters((prev) => [
        { id: data.chapter.id, title: data.chapter.title, versionCount: 0, latestVersion: null, updatedAt: data.chapter.updatedAt },
        ...prev,
      ]);
      setNewTitle("");
      openChapter(data.chapter.id);
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setCreating(false);
    }
  }

  async function saveVersion() {
    if (!selectedId || !editorContent.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/thesis-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-version", chapterId: selectedId, content: editorContent }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save this version.");
        return;
      }
      await openChapter(selectedId);
      setChapters((prev) =>
        prev
          .map((c) =>
            c.id === selectedId
              ? {
                  ...c,
                  versionCount: c.versionCount + 1,
                  latestVersion: { versionNumber: data.version.versionNumber, wordCount: data.version.wordCount, createdAt: data.version.createdAt },
                  updatedAt: data.version.createdAt,
                }
              : c
          )
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      );
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setSaving(false);
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
  const diffTokens: DiffToken[] | null =
    versions && diffA && diffB
      ? computeWordDiff(
          versions.find((v) => v.id === diffA)?.content ?? "",
          versions.find((v) => v.id === diffB)?.content ?? ""
        )
      : null;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-lg font-bold text-foreground">Version Control & Inline Annotation</h1>
          </div>
          <p className="mt-1 text-xs text-muted">Module 3 · Member 1 · LanguageTool</p>
        </div>
      </div>

      <div className="grid gap-5 bg-background p-6 lg:grid-cols-[280px_1fr]">
        {/* Chapter list */}
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-surface p-4">
            <label className="mb-2 block text-sm font-medium text-muted">New chapter</label>
            <div className="flex gap-2">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Chapter 1: Introduction"
                className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <Button variant="outline" className="mt-2 w-full" disabled={creating || !newTitle.trim()} onClick={createChapter}>
              {creating ? "Creating…" : "+ Add chapter"}
            </Button>
          </div>

          <div className="rounded-lg border border-border bg-surface p-2">
            {chapters.length === 0 && <p className="p-3 text-sm text-muted">No chapters yet — add one above.</p>}
            <ul className="space-y-1">
              {chapters.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => openChapter(c.id)}
                    className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      selectedId === c.id ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-background"
                    }`}
                  >
                    <p className="font-medium">{c.title}</p>
                    <p className={`text-xs ${selectedId === c.id ? "opacity-80" : "text-muted"}`}>
                      {c.versionCount} version{c.versionCount === 1 ? "" : "s"}
                      {c.latestVersion ? ` · v${c.latestVersion.versionNumber} · ${c.latestVersion.wordCount} words` : ""}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Detail */}
        <div className="space-y-5">
          {error && <p className="text-sm text-danger-foreground">{error}</p>}

          {!selectedId && <p className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">Select or create a chapter to start writing.</p>}

          {selectedId && loadingDetail && <p className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">Loading…</p>}

          {selectedId && !loadingDetail && versions && (
            <>
              <div className="rounded-lg border border-border bg-surface p-5">
                <h3 className="font-semibold text-foreground">{chapterTitle}</h3>
                <label className="mb-2 mt-3 block text-sm font-medium text-muted">Write or paste this version&apos;s text</label>
                <textarea
                  rows={12}
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                  className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
                />
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-xs text-muted">{editorContent.trim().match(/\S+/g)?.length ?? 0} words</p>
                  <Button disabled={saving || !editorContent.trim()} onClick={saveVersion}>
                    {saving ? "Saving…" : "Save as new version"}
                  </Button>
                </div>
              </div>

              {/* Version history */}
              <div className="rounded-lg border border-border bg-surface p-5">
                <h3 className="font-semibold text-foreground">Version history</h3>
                {versions.length === 0 ? (
                  <p className="mt-3 text-sm text-muted">No versions saved yet.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-border">
                    {versions.map((v) => (
                      <li key={v.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                        <button
                          type="button"
                          onClick={() => setActiveVersionId(v.id)}
                          className={`text-left font-medium ${activeVersionId === v.id ? "text-accent" : "text-foreground hover:underline"}`}
                        >
                          v{v.versionNumber} · {v.wordCount} words
                        </button>
                        <span className="shrink-0 text-xs text-muted">
                          {new Date(v.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Diff view */}
              {versions.length >= 2 && (
                <div className="rounded-lg border border-border bg-surface p-5">
                  <h3 className="font-semibold text-foreground">Compare versions</h3>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                    <VersionSelect versions={versions} value={diffA} onChange={setDiffA} />
                    <span className="text-muted">→</span>
                    <VersionSelect versions={versions} value={diffB} onChange={setDiffB} />
                  </div>
                  {diffTokens && (
                    <p className="mt-3 whitespace-pre-wrap rounded-md border border-border bg-background p-3 text-sm leading-relaxed">
                      {diffTokens.map((t, i) => (
                        <span
                          key={i}
                          className={
                            t.type === "add"
                              ? "bg-success-bg text-success-foreground"
                              : t.type === "remove"
                                ? "bg-danger-bg text-danger-foreground line-through"
                                : "text-foreground"
                          }
                        >
                          {t.value}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              )}

              {/* Writing quality */}
              {activeVersion && (
                <div className="rounded-lg border border-border bg-surface p-5">
                  <h3 className="font-semibold text-foreground">Writing quality — v{activeVersion.versionNumber}</h3>
                  {activeVersion.writingCheck === null ? (
                    <p className="mt-3 text-sm text-muted">Writing check unavailable for this version.</p>
                  ) : activeVersion.writingCheck.issues.length === 0 ? (
                    <p className="mt-3 text-sm text-muted">No issues found.</p>
                  ) : (
                    <ul className="mt-3 space-y-2.5">
                      {activeVersion.writingCheck.issues.map((issue, i) => (
                        <li key={i} className="rounded-md border border-border bg-background p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone="warning">{issue.category}</Badge>
                            <span className="text-xs text-muted">{issue.ruleId}</span>
                          </div>
                          <p className="mt-1.5 text-foreground">{issue.message}</p>
                          {issue.replacements.length > 0 && (
                            <p className="mt-1 text-xs text-muted">Suggestions: {issue.replacements.join(", ")}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Comments */}
              {activeVersion && (
                <div className="rounded-lg border border-border bg-surface p-5">
                  <h3 className="font-semibold text-foreground">Supervisor comments — v{activeVersion.versionNumber}</h3>
                  {activeVersion.comments.length === 0 ? (
                    <p className="mt-3 text-sm text-muted">No comments on this version yet.</p>
                  ) : (
                    <ul className="mt-3 space-y-2.5">
                      {activeVersion.comments.map((c) => (
                        <li key={c.id} className="rounded-md border border-border bg-background p-3 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-medium text-foreground">{c.authorName}</p>
                            <button
                              type="button"
                              onClick={() => resolveComment(c.id, !c.resolved)}
                              title={c.resolved ? "Click to mark as open" : "Click to mark as resolved"}
                            >
                              <Badge tone={c.resolved ? "success" : "neutral"}>{c.resolved ? "Resolved" : "Open"}</Badge>
                            </button>
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

function VersionSelect({
  versions,
  value,
  onChange,
}: {
  versions: VersionRow[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
    >
      {versions.map((v) => (
        <option key={v.id} value={v.id}>
          v{v.versionNumber}
        </option>
      ))}
    </select>
  );
}
