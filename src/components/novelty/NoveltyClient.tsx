"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type Mode = "TITLE" | "DRAFT";
type Risk = "LOW" | "MODERATE" | "HIGH";

interface ArchiveMatch {
  thesisId: string;
  title: string;
  department: string;
  year: number;
  score: number;
  sharedTerms: string[];
}

interface CheckResult {
  noveltyScore: number | null;
  topSimilarity: number;
  risk: Risk;
  understudied: string[];
  alreadyCovered: string[];
  matches: ArchiveMatch[];
  archiveSize: number;
  externalSize: number;
  wordCount: number;
  externalNote: string | null;
  sourceName?: string;
}

interface HistoryEntry {
  id: string;
  kind: "TITLE_ABSTRACT" | "CHAPTER_DRAFT";
  label: string;
  noveltyScore: number | null;
  topSimilarity: number;
  risk: Risk;
  createdAt: string;
}

/** The spec's rule: passages above this go to the supervisor before submission. */
const ATTENTION_THRESHOLD = 30;

const RISK_TONE: Record<Risk, "success" | "warning" | "danger"> = {
  LOW: "success",
  MODERATE: "warning",
  HIGH: "danger",
};

const RISK_LABEL: Record<Risk, string> = {
  LOW: "low risk",
  MODERATE: "moderate",
  HIGH: "needs review",
};

export function NoveltyClient({
  userName,
  archiveSize,
  initialTitle,
  initialAbstract,
  initialHistory,
}: {
  userName: string;
  archiveSize: number;
  initialTitle: string;
  initialAbstract: string;
  initialHistory: HistoryEntry[];
}) {
  const [mode, setMode] = useState<Mode>("TITLE");
  const [title, setTitle] = useState(initialTitle);
  const [abstract, setAbstract] = useState(initialAbstract);
  const [pasted, setPasted] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [titleResult, setTitleResult] = useState<CheckResult | null>(null);
  const [draftResult, setDraftResult] = useState<CheckResult | null>(null);
  const [history, setHistory] = useState(initialHistory);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);

  function remember(entry: HistoryEntry) {
    setHistory((prev) => [entry, ...prev].slice(0, 5));
  }

  async function runNoveltyCheck() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/novelty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, abstract }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not run the novelty check.");
        return;
      }
      setTitleResult(data);
      remember({
        id: crypto.randomUUID(),
        kind: "TITLE_ABSTRACT",
        label: title,
        noveltyScore: data.noveltyScore,
        topSimilarity: data.topSimilarity,
        risk: data.risk,
        createdAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }

  async function submitDraft(file?: File) {
    setError(null);
    setLoading(true);
    try {
      const form = new FormData();
      if (file) form.append("file", file);
      else form.append("text", pasted);

      const res = await fetch("/api/novelty/draft", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not check that draft.");
        return;
      }
      setDraftResult(data);
      setFileName(data.sourceName ?? null);
      remember({
        id: crypto.randomUUID(),
        kind: "CHAPTER_DRAFT",
        label: data.sourceName ?? "Pasted text",
        noveltyScore: null,
        topSimilarity: data.topSimilarity,
        risk: data.risk,
        createdAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="font-serif text-xl font-bold text-foreground">
            Topic Novelty &amp; Similarity Checker
          </h1>
          <p className="mt-0.5 text-xs text-muted">Module 2 · Member 3</p>
        </div>
        <Link href="/dashboard" className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-background">
          <span className="text-sm text-foreground">{userName}</span>
          <Avatar name={userName} size={32} />
        </Link>
      </div>

      <div className="space-y-5 bg-background p-6">
        {/* Tabs */}
        <div className="inline-flex overflow-hidden rounded-md border border-border">
          {(
            [
              ["TITLE", "Title & abstract"],
              ["DRAFT", "Chapter draft"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => {
                setMode(value);
                setError(null);
              }}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                mode === value
                  ? "bg-brand text-brand-foreground"
                  : "bg-surface text-foreground hover:bg-background"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-foreground">{error}</p>
        )}

        {mode === "TITLE" ? (
          <>
            <div className="rounded-lg border border-border bg-surface p-5">
              <label className="block text-sm font-medium text-foreground">Proposed title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Detecting Novel Research Gaps with Citation Graphs"
                className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              />

              <label className="mt-4 block text-sm font-medium text-foreground">Abstract</label>
              <textarea
                value={abstract}
                onChange={(e) => setAbstract(e.target.value)}
                rows={4}
                placeholder="We propose a graph-embedding approach to identify under-explored intersections in low-resource NLP research using citation network structure."
                className="mt-1.5 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              />

              <Button onClick={runNoveltyCheck} disabled={loading || !title.trim()} className="mt-3">
                {loading ? "Checking…" : "Run novelty check"}
              </Button>
            </div>

            {titleResult && <NoveltyResult result={titleResult} />}
          </>
        ) : (
          <>
            {/* Drop zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void submitDraft(file);
              }}
              className={`rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
                dragging ? "border-accent bg-surface" : "border-border bg-surface"
              }`}
            >
              <p className="font-serif text-lg font-semibold text-foreground">
                Upload chapter draft (.docx / .pdf / .txt)
              </p>
              <p className="mt-1 text-xs text-muted">
                Drag a file here, or {fileName ? <span className="text-foreground">{fileName}</span> : "choose one"}
              </p>

              <input
                ref={fileInput}
                type="file"
                accept=".docx,.pdf,.txt,.md"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void submitDraft(file);
                }}
              />

              <div className="mt-4 flex items-center justify-center gap-2">
                <Button onClick={() => fileInput.current?.click()} disabled={loading}>
                  {loading ? "Checking…" : "Upload file"}
                </Button>
                <button
                  onClick={() => setShowPaste((s) => !s)}
                  className="text-xs font-medium text-muted hover:text-foreground"
                >
                  or paste text
                </button>
              </div>

              {showPaste && (
                <div className="mt-4 text-left">
                  <textarea
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    rows={5}
                    placeholder="Paste your chapter text here — useful when a PDF is scanned and its text cannot be read."
                    className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
                  />
                  <Button
                    onClick={() => submitDraft()}
                    disabled={loading || pasted.trim().length < 100}
                    className="mt-2"
                  >
                    Check pasted text
                  </Button>
                </div>
              )}
            </div>

            {draftResult && <SimilarityReport result={draftResult} />}
          </>
        )}

        {history.length > 0 && <History entries={history} />}

        <p className="text-xs text-muted">
          Scored against {archiveSize} archived {archiveSize === 1 ? "thesis" : "theses"} in the university
          repository.
        </p>
      </div>
    </div>
  );
}

function NoveltyResult({ result }: { result: CheckResult }) {
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-5">
          <p className="font-serif text-4xl font-semibold text-foreground">{result.noveltyScore}%</p>
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted">Novelty score</p>
          <p className="mt-3 text-sm text-muted">
            Higher is better. Scored against {result.archiveSize} archived{" "}
            {result.archiveSize === 1 ? "thesis" : "theses"}
            {result.externalSize > 0 ? ` and ${result.externalSize} recent external papers` : ""}.
          </p>
          {result.externalNote && <p className="mt-2 text-xs italic text-muted">{result.externalNote}</p>}
        </div>

        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="font-serif text-lg font-semibold text-foreground">Breakdown</h2>

          <p className="mt-3 text-sm text-muted">
            Understudied angle:{" "}
            {result.understudied.length > 0 ? (
              <span className="font-semibold text-foreground">{result.understudied.join(", ")}</span>
            ) : (
              <span className="italic">nothing in your abstract is unusual for this archive.</span>
            )}
          </p>

          <p className="mt-2 text-sm text-muted">
            Already covered:{" "}
            {result.alreadyCovered.length > 0 ? (
              <>
                <span className="font-semibold text-foreground">{result.alreadyCovered.join(", ")}</span>
                {result.matches.length > 0 && ` (${result.matches.length} similar theses found)`}
              </>
            ) : (
              <span className="italic">nothing in the archive covers this closely.</span>
            )}
          </p>
        </div>
      </div>

      {result.matches.length > 0 && <MatchTable result={result} title="Closest archived theses" />}
    </>
  );
}

function SimilarityReport({ result }: { result: CheckResult }) {
  return (
    <>
      <MatchTable result={result} title="TF-IDF cosine similarity" showBadge />
      <p className="text-xs text-muted">
        {result.wordCount.toLocaleString()} words scored
        {result.sourceName ? ` from ${result.sourceName}` : ""}.
      </p>
    </>
  );
}

function MatchTable({
  result,
  title,
  showBadge = false,
}: {
  result: CheckResult;
  title: string;
  showBadge?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-lg font-semibold text-foreground">{title}</h2>
        {showBadge && (
          <Badge tone={RISK_TONE[result.risk]}>
            {result.topSimilarity}% — {RISK_LABEL[result.risk]}
          </Badge>
        )}
      </div>

      {result.matches.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          Nothing in the archive overlaps meaningfully with this text.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                  Matched archive thesis
                </th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wider text-muted">
                  Similarity
                </th>
              </tr>
            </thead>
            <tbody>
              {result.matches.map((m) => (
                <tr key={m.thesisId} className="border-b border-border last:border-0">
                  <td className="py-3 pr-4">
                    <p className="text-foreground">
                      &quot;{m.title}&quot; — {m.department}, {m.year}
                    </p>
                    {m.sharedTerms.length > 0 && (
                      <p className="mt-0.5 text-xs text-muted">shared: {m.sharedTerms.join(", ")}</p>
                    )}
                  </td>
                  <td className="py-3 text-right align-top">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                        m.score >= ATTENTION_THRESHOLD
                          ? "bg-danger-bg text-danger-foreground"
                          : m.score >= 15
                            ? "bg-warning-bg text-warning-foreground"
                            : "bg-background text-muted"
                      }`}
                    >
                      {m.score}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-muted">
        Flags passages above {ATTENTION_THRESHOLD}% similarity for supervisor attention before final
        submission.
      </p>
    </div>
  );
}

function History({ entries }: { entries: HistoryEntry[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-foreground">Recent checks</h2>
      <ul className="mt-3 divide-y divide-border">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate text-foreground">{e.label}</span>
            <span className="shrink-0 text-xs text-muted">
              {e.kind === "TITLE_ABSTRACT" ? `${e.noveltyScore}% novel` : `${e.topSimilarity}% similar`}
            </span>
            <span className="shrink-0">
              <Badge tone={RISK_TONE[e.risk]}>{RISK_LABEL[e.risk]}</Badge>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
