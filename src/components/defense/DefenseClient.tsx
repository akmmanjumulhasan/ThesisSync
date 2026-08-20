"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FOCUS_LABEL, splitEvaluation } from "@/lib/defense";

export interface DefenseQuestionView {
  id: string;
  position: number;
  focus: string | null;
  question: string;
  answer: string | null;
  evaluation: string | null;
  score: number | null;
  referenceAnswer: string | null;
}

export interface DefenseSessionView {
  id: string;
  createdAt: string;
  isActive: boolean;
  overallScore: number | null;
  analysis: { summary: string; findings: { focus: string; weakness: string; evidence: string }[] } | null;
  questions: DefenseQuestionView[];
}

export interface DefenseState {
  ready: boolean;
  blocker: string | null;
  thesisTitle: string | null;
  session: DefenseSessionView | null;
}

function scoreTone(score: number): "success" | "warning" | "danger" {
  if (score >= 7) return "success";
  if (score >= 4) return "warning";
  return "danger";
}

export function DefenseClient({
  userName,
  initialState,
}: {
  userName: string;
  initialState: DefenseState;
}) {
  const [state, setState] = useState<DefenseState>(initialState);
  const [depth, setDepth] = useState<"focused" | "thorough">("focused");
  const [starting, setStarting] = useState(false);
  const [answer, setAnswer] = useState("");
  const [live, setLive] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const session = state.session;
  const questions = session?.questions ?? [];
  // The first question that has not been answered is the one being asked.
  const currentIndex = questions.findIndex((q) => !q.answer);
  const current = currentIndex === -1 ? null : questions[currentIndex];
  const answered = questions.filter((q) => q.answer).length;

  const transcriptEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [answered, live]);

  async function refresh() {
    const res = await fetch("/api/defense");
    if (res.ok) setState(await res.json());
  }

  async function begin() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/defense", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depth }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "The examiner could not be convened.");
        return;
      }
      setState((prev) => ({ ...prev, session: data }));
      setAnswer("");
    } catch {
      setError("The examiner could not be convened.");
    } finally {
      setStarting(false);
    }
  }

  /**
   * Submits an answer and renders the examiner's reply as it arrives.
   *
   * The stream is read directly rather than waited on, because the whole point
   * of a rehearsal is that the response comes back the way it would in a room.
   */
  async function submit() {
    if (!current || !answer.trim()) return;
    setSubmitting(true);
    setError(null);
    setLive("");

    try {
      const res = await fetch("/api/defense/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interactionId: current.id, answer }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "The examiner did not respond.");
        setLive(null);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setLive(full);
      }

      setAnswer("");
      setLive(null);
      // The stored record carries the mark and unlocks the reference answer.
      await refresh();
    } catch {
      setError("The examiner did not respond.");
      setLive(null);
    } finally {
      setSubmitting(false);
    }
  }

  const liveSplit = live === null ? null : splitEvaluation(live);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="font-serif text-xl font-bold text-foreground">AI Mock Defense Simulator</h1>
          <p className="mt-0.5 text-xs text-muted">Module 3 · Member 2</p>
        </div>
        <Link href="/dashboard" className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-background">
          <span className="text-sm text-foreground">{userName}</span>
          <Avatar name={userName} size={32} />
        </Link>
      </div>

      <div className="space-y-5 bg-background p-6">
        {error && (
          <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-foreground">{error}</p>
        )}

        {!state.ready && (
          <div className="rounded-lg border border-border bg-surface p-5">
            <Badge tone="warning">Not ready</Badge>
            <p className="mt-3 text-sm text-muted">{state.blocker}</p>
            <Link
              href="/dashboard/proposal"
              className="mt-3 inline-block text-sm font-medium text-accent hover:underline"
            >
              Open the proposal builder →
            </Link>
          </div>
        )}

        {state.ready && !session && (
          <div className="rounded-lg border border-border bg-surface p-6">
            <h2 className="font-serif text-lg font-semibold text-foreground">
              Face an external examiner
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted">
              Your thesis is read first, then questioned. The examiner covers research limitations,
              data validation, ethical concerns and methodology gaps — one question at a time, each
              drawn from something your own text actually says.
            </p>
            {state.thesisTitle && (
              <p className="mt-3 text-sm text-foreground">
                <span className="text-muted">Defending: </span>
                <span className="font-medium">{state.thesisTitle}</span>
              </p>
            )}

            <div className="mt-4 inline-flex overflow-hidden rounded-md border border-border">
              {(
                [
                  ["focused", "Focused · 4 questions"],
                  ["thorough", "Thorough · 8 questions"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setDepth(value)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    depth === value
                      ? "bg-brand text-brand-foreground"
                      : "bg-surface text-foreground hover:bg-background"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-4">
              <Button onClick={begin} disabled={starting}>
                {starting ? "The examiner is reading your thesis…" : "Begin mock defense"}
              </Button>
              {starting && (
                <p className="mt-2 text-xs text-muted">
                  Two passes: a full read of your thesis, then the questions. This takes a moment.
                </p>
              )}
            </div>
          </div>
        )}

        {session && (
          <>
            {/* Progress */}
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-5 py-3">
              <span className="text-sm text-foreground">
                <strong>{answered}</strong>
                <span className="text-muted"> of {questions.length} answered</span>
              </span>
              {session.overallScore !== null && (
                <Badge tone={scoreTone(session.overallScore)}>
                  Running mark {session.overallScore}/10
                </Badge>
              )}
              <div className="ml-auto">
                <Button variant="outline" onClick={begin} disabled={starting || submitting}>
                  {starting ? "Convening…" : "New session"}
                </Button>
              </div>
            </div>

            {/* The examiner's reading, kept collapsed so it does not pre-empt the questions */}
            {session.analysis?.summary && (
              <details className="rounded-lg border border-border bg-surface p-5">
                <summary className="cursor-pointer font-serif text-base font-semibold text-foreground">
                  What the examiner noted while reading
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted">{session.analysis.summary}</p>
                <ul className="mt-3 space-y-2">
                  {session.analysis.findings.map((f) => (
                    <li key={f.focus} className="text-sm">
                      <span className="font-semibold text-foreground">
                        {FOCUS_LABEL[f.focus] ?? f.focus}:{" "}
                      </span>
                      <span className="text-muted">{f.weakness}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {/* Transcript */}
            <div className="space-y-4">
              {questions.map((q, i) => {
                if (i > currentIndex && currentIndex !== -1) return null;
                return (
                  <div key={q.id} className="space-y-3">
                    <div className="rounded-lg border border-border bg-surface p-5">
                      <div className="flex items-center gap-2">
                        <Badge tone="brand">Question {i + 1}</Badge>
                        {q.focus && <span className="text-xs text-muted">{FOCUS_LABEL[q.focus] ?? q.focus}</span>}
                      </div>
                      <p className="mt-3 font-serif text-base leading-relaxed text-foreground">
                        {q.question}
                      </p>
                    </div>

                    {q.answer && (
                      <div className="ml-8 rounded-lg border border-border bg-background p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                          Your answer
                        </p>
                        <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground">{q.answer}</p>
                      </div>
                    )}

                    {q.evaluation && (
                      <div className="rounded-lg border border-border bg-surface p-5">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                            Examiner
                          </p>
                          {q.score !== null && (
                            <Badge tone={scoreTone(q.score)}>{q.score}/10</Badge>
                          )}
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                          {q.evaluation}
                        </p>

                        {q.referenceAnswer && (
                          <details className="mt-3 border-t border-border pt-3">
                            <summary className="cursor-pointer text-sm font-medium text-accent">
                              What your thesis supports
                            </summary>
                            <p className="mt-2 text-sm leading-relaxed text-muted">
                              {q.referenceAnswer}
                            </p>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* The reply currently arriving */}
              {liveSplit && (
                <div className="rounded-lg border border-accent/40 bg-surface p-5">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Examiner</p>
                    {liveSplit.score !== null && (
                      <Badge tone={scoreTone(liveSplit.score)}>{liveSplit.score}/10</Badge>
                    )}
                    <span className="text-xs text-muted">responding…</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {liveSplit.text}
                    <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent align-text-bottom" />
                  </p>
                </div>
              )}

              <div ref={transcriptEnd} />
            </div>

            {/* Answer box, or the closing summary */}
            {current ? (
              <div className="rounded-lg border border-border bg-surface p-5">
                <label className="block text-sm font-medium text-foreground">Your answer</label>
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  rows={5}
                  disabled={submitting}
                  placeholder="Answer as you would in the room — the examiner marks what you say, not what you meant."
                  className="mt-1.5 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
                />
                <div className="mt-3 flex items-center gap-3">
                  <Button onClick={submit} disabled={submitting || !answer.trim()}>
                    {submitting ? "Examiner is responding…" : "Submit answer"}
                  </Button>
                  <span className="text-xs text-muted">
                    {answer.trim().split(/\s+/).filter(Boolean).length} words
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-surface p-5">
                <h2 className="font-serif text-base font-semibold text-foreground">
                  Defence complete
                </h2>
                <p className="mt-2 text-sm text-muted">
                  You answered every question.
                  {session.overallScore !== null && (
                    <>
                      {" "}
                      The panel would mark this{" "}
                      <strong className="text-foreground">{session.overallScore}/10</strong> overall.
                    </>
                  )}{" "}
                  Open &ldquo;What your thesis supports&rdquo; under any answer to see what your own
                  text could have given you.
                </p>
                <Button onClick={begin} disabled={starting} className="mt-3">
                  {starting ? "Convening…" : "Run another session"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
