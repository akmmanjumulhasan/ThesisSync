"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export interface PaperBlocker {
  code: string;
  message: string;
}

export interface PaperOutlineSection {
  heading: string;
  words: number;
  subsections: string[];
}

export type AuthorRelation = "you" | "teammate" | "supervisor";

export interface PaperCandidate {
  id: string;
  name: string;
  affiliation: string;
  relation: AuthorRelation;
}

export interface PaperOutline {
  title: string;
  authors: { name: string; affiliation: string }[];
  abstractWords: number;
  sections: PaperOutlineSection[];
  referenceCount: number;
  pageCount?: number;
}

export interface PaperSectionField {
  field: string;
  heading: string;
}

export interface PaperStatus {
  ready: boolean;
  blockers: PaperBlocker[];
  proposalStatus: string | null;
  outline: PaperOutline | null;
  candidates: PaperCandidate[];
  sectionFields: PaperSectionField[];
}

export interface IeeeSpec {
  pageSize: string;
  columns: number;
  columnWidthIn: number;
  columnGapIn: number;
  marginTopIn: number;
  marginBottomIn: number;
  marginSideIn: number;
  bodyFont: string;
}

const RELATION_LABEL: Record<AuthorRelation, string> = {
  you: "You",
  teammate: "Teammate",
  supervisor: "Supervisor",
};

const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth"];

function ordinal(i: number): string {
  return ORDINALS[i] ? `${ORDINALS[i]} author` : `Author ${i + 1}`;
}

function inches(n: number): string {
  return `${n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}in`;
}

export function PaperClient({
  userName,
  initialStatus,
  spec,
}: {
  userName: string;
  initialStatus: PaperStatus;
  spec: IeeeSpec;
}) {
  const [status, setStatus] = useState<PaperStatus>(initialStatus);
  const [affiliation, setAffiliation] = useState("");
  const [runningHeader, setRunningHeader] = useState("");
  const [title, setTitle] = useState("");
  const [abstract, setAbstract] = useState("");
  const [references, setReferences] = useState("");
  const [indexTerms, setIndexTerms] = useState("");
  const [sections, setSections] = useState<Record<string, string>>({});

  // The byline starts as just the student. Anyone else is a decision about
  // credit, so it is made explicitly rather than defaulted into.
  const [authorIds, setAuthorIds] = useState<string[]>(() =>
    initialStatus.candidates.filter((c) => c.relation === "you").map((c) => c.id)
  );

  const [generating, setGenerating] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; fileName: string; pages: number } | null>(null);

  // A blob URL outlives the component unless it is explicitly released, and a
  // student regenerating a dozen times would otherwise pin every old PDF in
  // memory for the life of the tab.
  const previewRef = useRef<string | null>(null);
  useEffect(() => {
    previewRef.current = preview?.url ?? null;
  }, [preview]);
  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  /** Exactly what a generate would send, so preview and download cannot diverge. */
  function payload() {
    return {
      affiliation: affiliation.trim() || undefined,
      runningHeader: runningHeader.trim() || undefined,
      title: title.trim() || undefined,
      abstract: abstract.trim() || undefined,
      references: references.trim() || undefined,
      indexTerms: indexTerms.trim() || undefined,
      authorIds,
      sections,
    };
  }

  // The outline depends on every option, so it is refreshed as they change.
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/paper/outline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload()),
        });
        if (!res.ok) return;
        setStatus(await res.json());
      } catch {
        // Leaving the previous outline on screen is better than blanking it
        // because a keystroke raced a network hiccup.
      }
    }, 400);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [affiliation, runningHeader, title, abstract, references, indexTerms, authorIds, sections]);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "The paper could not be generated.");
        return;
      }

      const disposition = res.headers.get("Content-Disposition") ?? "";
      const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "ieee-paper.pdf";
      const pages = Number(res.headers.get("X-Page-Count") ?? "0");

      const blob = await res.blob();
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      setPreview({ url: URL.createObjectURL(blob), fileName, pages });
    } catch {
      setError("The paper could not be generated.");
    } finally {
      setGenerating(false);
    }
  }

  /**
   * Pulls the title and abstract from the proposal.
   *
   * Those two only — the proposal's other prose is a plan for work not yet
   * done, and the body comes from locked chapters instead.
   *
   * Only ever on click: the page starts empty so nothing is carried in that the
   * student did not choose to put there.
   */
  async function loadFromProposal() {
    setLoadingDraft(true);
    setError(null);
    try {
      const res = await fetch("/api/paper/draft");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Your proposal could not be loaded.");
        return;
      }

      if (!data.title && !data.abstract) {
        setError("Your proposal has no title or abstract to load yet.");
        return;
      }

      if (data.title) setTitle(data.title);
      if (data.abstract) setAbstract(data.abstract);
    } catch {
      setError("Your proposal could not be loaded.");
    } finally {
      setLoadingDraft(false);
    }
  }

  /** Fills each section box with the text of the locked chapter it belongs to. */
  async function loadFromChapters() {
    setLoadingChapters(true);
    setError(null);
    try {
      const res = await fetch("/api/paper/chapters");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Your chapters could not be loaded.");
        return;
      }

      if (Object.keys(data.sections ?? {}).length === 0) {
        setError("Your locked chapters have no text in them yet.");
        return;
      }

      setSections((prev) => ({ ...prev, ...data.sections }));
    } catch {
      setError("Your chapters could not be loaded.");
    } finally {
      setLoadingChapters(false);
    }
  }

  function move(index: number, delta: number) {
    setAuthorIds((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const outline = status.outline;
  const byId = new Map(status.candidates.map((c) => [c.id, c]));
  const selected = authorIds.map((id) => byId.get(id)).filter((c): c is PaperCandidate => Boolean(c));
  const available = status.candidates.filter((c) => !authorIds.includes(c.id));

  const referenceCount = references.split("\n").filter((l) => l.trim()).length;
  const needsProposal = status.blockers.some(
    (b) => b.code === "NO_PROPOSAL" || b.code === "NOT_APPROVED"
  );
  const needsChapters = status.blockers.some((b) => b.code === "NO_LOCKED_CHAPTERS");

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="font-serif text-xl font-bold text-foreground">
            IEEE Conference Paper Transpiler
          </h1>
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

        {!status.ready && (
          <div className="rounded-lg border border-border bg-surface p-5">
            <div className="flex items-center gap-2">
              <Badge tone="warning">Not ready</Badge>
              {status.proposalStatus && (
                <span className="text-xs text-muted">
                  Proposal status: <strong className="text-foreground">{status.proposalStatus}</strong>
                </span>
              )}
            </div>
            <ul className="mt-3 space-y-1.5">
              {status.blockers.map((b) => (
                <li key={b.code} className="text-sm text-muted">
                  · {b.message}
                </li>
              ))}
            </ul>
            {/*
              Each blocker has exactly one useful action. A missing or unapproved
              proposal is fixed in the proposal builder; no locked chapters is
              fixed in the chapter workflow, not here. Only once both gates have
              passed are the remaining blockers just empty boxes, and then the
              useful action is filling them.
            */}
            {needsProposal ? (
              <Link
                href="/dashboard/proposal"
                className="mt-3 inline-block text-sm font-medium text-accent hover:underline"
              >
                Open the proposal builder →
              </Link>
            ) : needsChapters ? (
              <Link
                href="/dashboard/chapters"
                className="mt-3 inline-block text-sm font-medium text-accent hover:underline"
              >
                Open the chapter workflow →
              </Link>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={loadFromChapters}
                  disabled={loadingChapters}
                  className="px-3 py-1.5 text-xs"
                >
                  {loadingChapters ? "Loading…" : "Load body from my chapters"}
                </Button>
                <Button
                  variant="outline"
                  onClick={loadFromProposal}
                  disabled={loadingDraft}
                  className="px-3 py-1.5 text-xs"
                >
                  {loadingDraft ? "Loading…" : "Load title & abstract from my proposal"}
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            {/* Outline */}
            <div className="rounded-lg border border-border bg-surface p-5">
              <h2 className="font-serif text-base font-semibold text-foreground">What will be typeset</h2>

              {!outline ? (
                <p className="mt-3 text-sm text-muted">
                  Nothing yet — a paper needs an approved proposal and at least one locked chapter.
                </p>
              ) : (
                <>
                  <p className="mt-3 font-serif text-lg font-semibold leading-snug text-foreground">
                    {outline.title || "Untitled"}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {outline.authors.map((a) => a.name).join(", ") || "No author"}
                  </p>

                  <table className="mt-4 w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                        <th className="pb-1.5 font-semibold">Section</th>
                        <th className="pb-1.5 text-right font-semibold">Words</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-border/60">
                        <td className="py-1.5 text-foreground">Abstract</td>
                        <td className="py-1.5 text-right tabular-nums text-muted">{outline.abstractWords}</td>
                      </tr>
                      {/*
                        Every section is listed, empty ones included, so the
                        table does not reshuffle as boxes are filled. The
                        numeral is the one the paper will actually print, which
                        is the position among the *non-empty* sections.
                      */}
                      {status.sectionFields.map((field) => {
                        const typeset = outline.sections.findIndex((s) => s.heading === field.heading);
                        const section = typeset === -1 ? null : outline.sections[typeset];
                        return (
                          <tr key={field.field} className="border-b border-border/60">
                            <td className={`py-1.5 ${section ? "text-foreground" : "text-muted"}`}>
                              {section ? `${roman(typeset + 1)}. ` : ""}
                              {field.heading}
                              {section && section.subsections.length > 0 && (
                                <span className="ml-1 text-xs text-muted">
                                  ({section.subsections.join(", ")})
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-muted">
                              {section?.words ?? 0}
                            </td>
                          </tr>
                        );
                      })}
                      <tr>
                        <td className="py-1.5 text-foreground">References</td>
                        <td className="py-1.5 text-right tabular-nums text-muted">{outline.referenceCount}</td>
                      </tr>
                    </tbody>
                  </table>

                  {outline.pageCount !== undefined && (
                    <p className="mt-3 text-sm text-muted">
                      Typesets to{" "}
                      <strong className="text-foreground">
                        {outline.pageCount} page{outline.pageCount === 1 ? "" : "s"}
                      </strong>{" "}
                      in the IEEE two-column format.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Section bodies */}
            <div className="rounded-lg border border-border bg-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-serif text-base font-semibold text-foreground">Sections</h2>
                {status.sectionFields.length > 0 && (
                  <Button
                    variant="outline"
                    onClick={loadFromChapters}
                    disabled={loadingChapters}
                    className="px-3 py-1.5 text-xs"
                  >
                    {loadingChapters ? "Loading…" : "Load from my chapters"}
                  </Button>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">
                One section per locked chapter, in thesis order, under the chapter&apos;s own title.
                Numbered I, II, III…; empty sections are skipped entirely. Blank lines start a new
                paragraph, a line beginning with{" "}
                <code className="rounded bg-background px-1">-</code> becomes a bullet, and{" "}
                <code className="rounded bg-background px-1">## </code> opens a lettered subsection.
              </p>

              {status.sectionFields.length === 0 && (
                <p className="mt-3 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted">
                  No chapters are locked yet, so there is nothing to typeset. A paper reports
                  finished work, so its sections come from chapters your supervisor has locked.{" "}
                  <Link href="/dashboard/chapters" className="font-medium text-accent hover:underline">
                    Open the chapter workflow
                  </Link>
                  .
                </p>
              )}

              <div className="mt-4 space-y-4">
                {status.sectionFields.map((section, i) => (
                  <div key={section.field}>
                    <label className="text-sm font-medium text-foreground">
                      <span className="mr-1.5 text-xs text-muted">{roman(i + 1)}.</span>
                      {section.heading}
                    </label>
                    <textarea
                      value={sections[section.field] ?? ""}
                      onChange={(e) =>
                        setSections((prev) => ({ ...prev, [section.field]: e.target.value }))
                      }
                      rows={4}
                      className="mt-1.5 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* References */}
            <div className="rounded-lg border border-border bg-surface p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-base font-semibold text-foreground">References</h2>
                <span className="text-xs text-muted">
                  {referenceCount} entr{referenceCount === 1 ? "y" : "ies"}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">
                One reference per line, in citation order. They are numbered [1], [2], … for you — leave
                the numbers out.
              </p>
              <textarea
                value={references}
                onChange={(e) => setReferences(e.target.value)}
                rows={7}
                spellCheck={false}
                placeholder={
                  'A. Vaswani et al., "Attention is all you need," in Proc. NeurIPS, 2017, pp. 5998-6008.\n' +
                  'J. Devlin, M.-W. Chang, K. Lee, and K. Toutanova, "BERT: Pre-training of deep bidirectional transformers for language understanding," in Proc. NAACL-HLT, 2019, pp. 4171-4186.'
                }
                className="mt-2 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          {/* Options */}
          <div className="space-y-5">
            <div className="rounded-lg border border-border bg-surface p-5">
              <h2 className="font-serif text-base font-semibold text-foreground">Authors</h2>
              <p className="mt-1 text-xs text-muted">Order is the byline order.</p>

              <ol className="mt-3 space-y-2">
                {selected.map((author, i) => (
                  <li
                    key={author.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{author.name}</p>
                      <p className="text-[11px] text-muted">
                        {ordinal(i)} · {RELATION_LABEL[author.relation]}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        aria-label={`Move ${author.name} up`}
                        className="rounded px-1.5 py-0.5 text-sm text-muted hover:bg-surface disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => move(i, 1)}
                        disabled={i === selected.length - 1}
                        aria-label={`Move ${author.name} down`}
                        className="rounded px-1.5 py-0.5 text-sm text-muted hover:bg-surface disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => setAuthorIds((prev) => prev.filter((id) => id !== author.id))}
                        aria-label={`Remove ${author.name}`}
                        className="rounded px-1.5 py-0.5 text-sm text-muted hover:bg-surface hover:text-danger-foreground"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ol>

              {selected.length === 0 && (
                <p className="mt-2 text-xs text-muted">
                  No one selected — the paper will be credited to you alone.
                </p>
              )}

              {available.length > 0 && (
                <div className="mt-3 border-t border-border pt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Add</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {available.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setAuthorIds((prev) => [...prev, c.id])}
                        className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground hover:bg-background"
                      >
                        + {c.name}
                        <span className="ml-1 text-muted">{RELATION_LABEL[c.relation]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border bg-surface p-5">
              <h2 className="font-serif text-base font-semibold text-foreground">Paper details</h2>

              <label className="mt-3 block text-sm font-medium text-foreground">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              />

              <label className="mt-4 block text-sm font-medium text-foreground">Abstract</label>
              <textarea
                value={abstract}
                onChange={(e) => setAbstract(e.target.value)}
                rows={4}
                className="mt-1.5 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              />

              <label className="mt-4 block text-sm font-medium text-foreground">Index terms</label>
              <input
                value={indexTerms}
                onChange={(e) => setIndexTerms(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              />
              <p className="mt-1 text-xs text-muted">Optional. Comma separated, printed under the abstract.</p>

              <label className="mt-4 block text-sm font-medium text-foreground">Affiliation</label>
              <input
                value={affiliation}
                onChange={(e) => setAffiliation(e.target.value)}
                placeholder="Dept. of Computer Science and Engineering"
                className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              />
              <p className="mt-1 text-xs text-muted">
                Optional. Applies to every author; otherwise each uses their own department.
              </p>

              <label className="mt-4 block text-sm font-medium text-foreground">Running header</label>
              <input
                value={runningHeader}
                onChange={(e) => setRunningHeader(e.target.value)}
                placeholder="2026 International Conference on…"
                className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              />
              <p className="mt-1 text-xs text-muted">Optional. Repeated at the top of every page.</p>

              <Button onClick={generate} disabled={generating || !status.ready} className="mt-4 w-full">
                {generating ? "Compiling…" : "Generate IEEE PDF"}
              </Button>

              {preview && (
                <a
                  href={preview.url}
                  download={preview.fileName}
                  className="mt-2 block w-full rounded-md border border-border bg-surface px-4 py-2 text-center text-sm font-medium text-foreground hover:bg-background"
                >
                  Download {preview.fileName}
                </a>
              )}

              <p className="mt-3 text-xs text-muted">
                Start a line with <code className="rounded bg-background px-1">## </code> in a section
                box to open a lettered IEEE subsection.
              </p>
            </div>

            <div className="rounded-lg border border-border bg-surface p-5">
              <h2 className="font-serif text-base font-semibold text-foreground">Format applied</h2>
              <dl className="mt-3 space-y-1.5 text-xs">
                {[
                  ["Page", spec.pageSize],
                  ["Columns", `${spec.columns} × ${inches(spec.columnWidthIn)}, ${inches(spec.columnGapIn)} gutter`],
                  [
                    "Margins",
                    `${inches(spec.marginTopIn)} top, ${inches(spec.marginBottomIn)} bottom, ${inches(spec.marginSideIn)} sides`,
                  ],
                  ["Body", spec.bodyFont],
                  ["Headings", "Roman numerals, small caps; subsections lettered italic"],
                  ["References", "8pt, hanging indent, IEEE numbering"],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="shrink-0 text-muted">{label}</dt>
                    <dd className="text-right text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>

        {preview && (
          <div className="rounded-lg border border-border bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-base font-semibold text-foreground">Print preview</h2>
              <Badge tone="success">
                {preview.pages} page{preview.pages === 1 ? "" : "s"}
              </Badge>
            </div>
            <iframe
              src={preview.url}
              title="IEEE paper preview"
              className="mt-3 h-[820px] w-full rounded-md border border-border bg-white"
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Mirrors the engine's section numbering so the outline reads like the paper. */
function roman(n: number): string {
  const table: [number, string][] = [
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  let rest = n;
  for (const [value, numeral] of table) {
    while (rest >= value) {
      out += numeral;
      rest -= value;
    }
  }
  return out;
}
