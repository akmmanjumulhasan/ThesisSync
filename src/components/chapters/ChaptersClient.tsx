"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LockIcon } from "@/components/ui/icons";
import { ChapterPipeline } from "@/components/chapters/ChapterPipeline";
import { ChapterAuditTrail } from "@/components/chapters/ChapterAuditTrail";
import {
  MAX_CHAPTERS,
  STANDARD_CHAPTERS,
  STATUS_META,
  availableActions,
  isDeletable,
  isEditable,
  thesisProgress,
  type ChapterAction,
  type ChapterView,
} from "@/lib/chapters";

interface GateView {
  open: boolean;
  hasSupervisor: boolean;
  supervisorName: string | null;
  reason: string | null;
}

/**
 * Module 3 (Member 3): Chapter Approval Workflow, student side.
 *
 * The student's only pipeline action is submitting. Every button past that
 * belongs to the supervisor, so this component never renders one — the action
 * list comes from `availableActions(status, "STUDENT")`, which returns a submit
 * and nothing else. What the student gets instead is visibility: where each
 * chapter stands, and the full record of who moved it there.
 */
export function ChaptersClient({
  userName,
  gate,
  initialChapters,
}: {
  userName: string;
  gate: GateView;
  initialChapters: ChapterView[];
}) {
  const router = useRouter();
  const [chapters, setChapters] = useState(initialChapters);
  const [openId, setOpenId] = useState<string | null>(initialChapters[0]?.id ?? null);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const progress = thesisProgress(chapters.map((c) => c.status));
  const lockedCount = chapters.filter((c) => c.status === "LOCKED").length;

  /** Every write goes through here so the refreshed list and errors land in one place. */
  async function call(
    method: "POST" | "PATCH" | "DELETE",
    body: Record<string, unknown>,
    key: string,
    url = "/api/chapters"
  ): Promise<boolean> {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return false;
      }
      if (data.chapters) setChapters(data.chapters);
      return true;
    } catch {
      setError("Network error — check your connection and try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function addChapter(title: string) {
    if (!title.trim()) return;
    if (await call("POST", { title }, `add:${title}`)) setNewTitle("");
  }

  async function addScaffold() {
    setBusy("scaffold");
    setError(null);
    // Sequential on purpose: chapter numbers are assigned from the current
    // maximum, so firing these in parallel would race for the same number.
    for (const title of STANDARD_CHAPTERS) {
      const res = await fetch("/api/chapters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create the standard chapters.");
        break;
      }
      setChapters(data.chapters);
    }
    setBusy(null);
  }

  /**
   * Run any pipeline action the student owns. The transition endpoint returns
   * only success, so the list is re-read afterwards to pick up the new status,
   * version and audit rows.
   */
  async function act(chapterId: string, action: ChapterAction) {
    if (await call("POST", { chapterId, action }, `${action}:${chapterId}`, "/api/chapters/transition")) {
      const res = await fetch("/api/chapters");
      const data = await res.json();
      if (res.ok) setChapters(data.chapters);
      router.refresh();
    }
  }

  if (!gate.open) {
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
        <Header userName={userName} />
        <div className="space-y-4 bg-background p-6">
          <div className="rounded-lg border border-border bg-surface p-6">
            <h2 className="font-semibold text-foreground">Chapter work isn&apos;t open yet</h2>
            <p className="mt-1.5 text-sm text-muted">{gate.reason}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {!gate.hasSupervisor && (
                <Link href="/dashboard/matchmaking">
                  <Button variant="outline">Find a supervisor</Button>
                </Link>
              )}
              <Link href="/dashboard/proposal">
                <Button>Go to proposal builder</Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <Header userName={userName} />

      <div className="space-y-5 bg-background p-6">
        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger-foreground">{error}</p>}

        {/* Thesis-wide progress */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">Thesis progression</h2>
              <p className="mt-0.5 text-sm text-muted">
                {chapters.length === 0
                  ? "No chapters yet."
                  : `${lockedCount} of ${chapters.length} chapter${chapters.length === 1 ? "" : "s"} locked.`}
                {gate.supervisorName && ` Approvals go through ${gate.supervisorName}.`}
              </p>
            </div>
            <span className="font-serif text-2xl font-semibold tabular-nums text-foreground">{progress}%</span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Chapters */}
        {chapters.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-6 text-center">
            <p className="text-sm text-muted">
              Start with the standard structure, or add chapters one at a time below.
            </p>
            <Button className="mt-4" disabled={busy !== null} onClick={addScaffold}>
              {busy === "scaffold" ? "Creating…" : "Add the standard five chapters"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {chapters.map((chapter) => (
              <ChapterCard
                key={chapter.id}
                chapter={chapter}
                open={openId === chapter.id}
                busy={busy}
                onToggle={() => setOpenId(openId === chapter.id ? null : chapter.id)}
                onSave={(title, content) => call("PATCH", { chapterId: chapter.id, title, content }, `save:${chapter.id}`)}
                onAct={(action) => act(chapter.id, action)}
                onDelete={() => call("DELETE", { chapterId: chapter.id }, `del:${chapter.id}`)}
              />
            ))}
          </div>
        )}

        {/* Add another */}
        {chapters.length > 0 && chapters.length < MAX_CHAPTERS && (
          <div className="flex flex-wrap gap-2">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addChapter(newTitle);
              }}
              placeholder="New chapter title"
              className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
            />
            <Button variant="outline" disabled={busy !== null || !newTitle.trim()} onClick={() => addChapter(newTitle)}>
              Add chapter
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Header({ userName }: { userName: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-lg font-bold text-foreground">Chapter Approval Workflow</h1>
          <Badge tone="warning">Supervisor-gated · every stage</Badge>
        </div>
        <p className="mt-1 text-xs text-muted">Module 3 · Member 3</p>
      </div>
      <Link href="/dashboard" className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-background">
        <span className="text-sm text-foreground">{userName}</span>
        <Avatar name={userName} size={32} />
      </Link>
    </div>
  );
}

function ChapterCard({
  chapter,
  open,
  busy,
  onToggle,
  onSave,
  onAct,
  onDelete,
}: {
  chapter: ChapterView;
  open: boolean;
  busy: string | null;
  onToggle: () => void;
  onSave: (title: string, content: string) => Promise<boolean>;
  onAct: (action: ChapterAction) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(chapter.title);
  const [content, setContent] = useState(chapter.content);
  const [saved, setSaved] = useState(false);

  const editable = isEditable(chapter.status);
  const meta = STATUS_META[chapter.status];
  // Drawn from the same table the server enforces, so the student is never
  // shown a move that would be rejected.
  const studentActions = availableActions(chapter.status, "STUDENT");
  const canSubmit = studentActions.some((t) => t.action === "SUBMIT");
  const reopen = studentActions.find((t) => t.action === "REOPEN");
  const dirty = title !== chapter.title || content !== chapter.content;
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;

  async function save() {
    if (await onSave(title, content)) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left hover:bg-background"
      >
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <span className="text-xs tabular-nums text-muted">
              {String(chapter.number).padStart(2, "0")}
            </span>
            {chapter.title}
            {chapter.status === "LOCKED" && <LockIcon className="h-3.5 w-3.5 text-muted" />}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {words.toLocaleString()} word{words === 1 ? "" : "s"}
            {chapter.version > 1 && ` · revision ${chapter.version}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <span className="text-xs text-muted">{open ? "Hide" : "Open"}</span>
        </div>
      </button>

      {open && (
        <div className="space-y-4 border-t border-border bg-background px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ChapterPipeline status={chapter.status} />
          </div>
          <p className="text-xs text-muted">{meta.blurb}</p>

          {editable ? (
            <>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-accent"
              />
              <textarea
                rows={10}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write this chapter here."
                className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-accent"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" disabled={busy !== null || !dirty} onClick={save}>
                  {busy === `save:${chapter.id}` ? "Saving…" : saved ? "Saved" : "Save draft"}
                </Button>
                {canSubmit && (
                  <Button disabled={busy !== null || dirty || !content.trim()} onClick={() => onAct("SUBMIT")}>
                    {busy === `SUBMIT:${chapter.id}` ? "Submitting…" : "Submit for approval"}
                  </Button>
                )}
                {isDeletable(chapter.status, chapter.submittedAt) && (
                  <button
                    type="button"
                    onClick={onDelete}
                    disabled={busy !== null}
                    className="ml-auto text-xs font-medium text-muted hover:text-danger-foreground disabled:opacity-40"
                  >
                    Remove chapter
                  </button>
                )}
              </div>
              {dirty && canSubmit && (
                <p className="text-xs text-muted">Save your draft before submitting it.</p>
              )}
              {!content.trim() && canSubmit && !dirty && (
                <p className="text-xs text-muted">Write something before submitting for approval.</p>
              )}
            </>
          ) : (
            <>
              <div className="rounded-md border border-border bg-surface p-4">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {chapter.content || <span className="text-muted">This chapter is empty.</span>}
                </p>
              </div>
              {reopen && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => onAct("REOPEN")}
                    title={reopen.hint}
                  >
                    {busy === `REOPEN:${chapter.id}` ? "Reopening…" : reopen.label}
                  </Button>
                  <p className="text-xs text-muted">{reopen.hint}</p>
                </div>
              )}
              {chapter.status === "LOCKED" && (
                <p className="text-xs text-muted">
                  Locked chapters have no further actions. This one is part of the final thesis.
                </p>
              )}
            </>
          )}

          <div className="rounded-lg border border-border bg-surface p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Audit trail</h4>
            <div className="mt-2">
              <ChapterAuditTrail audit={chapter.audit} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
