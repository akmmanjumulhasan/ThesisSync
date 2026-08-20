"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { TfIdfIndex, rankAgainstCorpus, type Document } from "@/lib/similarity";

export interface RepositoryEntry {
  id: string;
  title: string;
  abstract: string;
  authorName: string;
  department: string | null;
  year: number;
  supervisorName: string | null;
}

interface InsightData {
  query: string;
  archiveSize: number;
  paperCount: number;
  fieldStatus: "growing" | "active" | "saturating";
  heavilyCoveredExternally: string[];
  understudiedExternally: string[];
  gap: { understudied: string[]; alreadyCovered: string[] };
  warnings: string[];
}

const ALL = "All";
const FIELD_STATUS_TONE = { growing: "success", active: "neutral", saturating: "warning" } as const;
const FIELD_STATUS_LABEL = { growing: "Growing field", active: "Active field", saturating: "Saturating field" } as const;

export function RepositoryClient({ initialEntries }: { initialEntries: RepositoryEntry[] }) {
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState(ALL);
  const [year, setYear] = useState(ALL);
  const [supervisor, setSupervisor] = useState(ALL);

  const [insight, setInsight] = useState<InsightData | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);

  const departments = useMemo(
    () => [ALL, ...new Set(initialEntries.map((e) => e.department).filter((d): d is string => Boolean(d)))],
    [initialEntries]
  );
  const years = useMemo(
    () => [ALL, ...new Set(initialEntries.map((e) => String(e.year)))].sort((a, b) => (a === ALL ? -1 : b === ALL ? 1 : Number(b) - Number(a))),
    [initialEntries]
  );
  const supervisors = useMemo(
    () => [ALL, ...new Set(initialEntries.map((e) => e.supervisorName).filter((s): s is string => Boolean(s)))],
    [initialEntries]
  );

  // Built once over the full archive so IDF weights reflect the whole
  // repository, not just whatever the department/year/supervisor filters
  // currently leave visible. Pure TS, no network — runs fine in the browser.
  const index = useMemo(
    () => new TfIdfIndex(initialEntries.map((e): Document => ({ id: e.id, text: `${e.title} ${e.abstract}` }))),
    [initialEntries]
  );

  const filtered = useMemo(() => {
    return initialEntries.filter((e) => {
      if (department !== ALL && e.department !== department) return false;
      if (year !== ALL && String(e.year) !== year) return false;
      if (supervisor !== ALL && e.supervisorName !== supervisor) return false;
      return true;
    });
  }, [initialEntries, department, year, supervisor]);

  // With no query, the dropdown filters alone decide what's shown, in the
  // server's original (most-recently-approved-first) order. With a query,
  // rank the filtered set by TF-IDF relevance instead of a literal substring
  // check — "federated learning" now also surfaces an abstract that says
  // "federated training", not just an exact phrase match.
  const results = useMemo(() => {
    const needle = q.trim();
    if (!needle) return filtered.map((e) => ({ ...e, score: null as number | null, sharedTerms: [] as string[] }));

    const ranked = rankAgainstCorpus(
      index,
      needle,
      filtered.map((e): Document => ({ id: e.id, text: `${e.title} ${e.abstract}` })),
      filtered.length
    );
    const byId = new Map(ranked.map((m) => [m.id, m]));
    return filtered
      .filter((e) => byId.has(e.id))
      .map((e) => ({ ...e, score: byId.get(e.id)!.score, sharedTerms: byId.get(e.id)!.sharedTerms }))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [filtered, q, index]);

  async function runInsight() {
    const query = q.trim();
    if (!query) return;
    setInsightLoading(true);
    setInsightError(null);
    try {
      const res = await fetch("/api/repository/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't check this topic right now.");
      setInsight(body as InsightData);
    } catch (err) {
      setInsightError(err instanceof Error ? err.message : "Couldn't check this topic right now.");
    } finally {
      setInsightLoading(false);
    }
  }

  const coveredTags = insight ? [...new Set([...insight.gap.alreadyCovered, ...insight.heavilyCoveredExternally])] : [];
  const gapTags = insight ? [...new Set([...insight.gap.understudied, ...insight.understudiedExternally])] : [];

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-bold text-foreground">University Thesis Repository</h1>
        <p className="mt-1 text-xs text-muted">Module 3 · Member 1</p>
      </div>

      <div className="space-y-5 bg-background p-6">
        {/* Search & filters */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <label className="mb-2 block text-sm font-medium text-muted">Search by keyword</label>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setInsight(null);
              setInsightError(null);
            }}
            placeholder="Search titles and abstracts, or paste a topic idea…"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <FilterSelect label="Department" value={department} options={departments} onChange={setDepartment} />
            <FilterSelect label="Year" value={year} options={years} onChange={setYear} />
            <FilterSelect label="Supervisor" value={supervisor} options={supervisors} onChange={setSupervisor} />
          </div>

          {q.trim().length >= 3 && (
            <div className="mt-3 border-t border-border pt-3">
              <button
                type="button"
                onClick={runInsight}
                disabled={insightLoading}
                className="text-xs font-medium text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                {insightLoading ? "Checking the published literature…" : `Explore "${q.trim()}" as a topic →`}
              </button>
              {insightError && <p className="mt-1.5 text-xs text-danger-foreground">{insightError}</p>}
            </div>
          )}
        </div>

        {/* Topic insight */}
        {insight && insight.query === q.trim() && (
          <div className="space-y-3 rounded-lg border border-border bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">Topic insight: &ldquo;{insight.query}&rdquo;</h2>
              <Badge tone={FIELD_STATUS_TONE[insight.fieldStatus]}>{FIELD_STATUS_LABEL[insight.fieldStatus]}</Badge>
            </div>
            <p className="text-xs text-muted">
              Checked against {insight.archiveSize} approved thesis{insight.archiveSize === 1 ? "" : "es"} in this
              repository and {insight.paperCount} recent published paper{insight.paperCount === 1 ? "" : "s"}.
            </p>
            {insight.warnings.length > 0 && (
              <ul className="space-y-0.5 text-xs text-warning-foreground">
                {insight.warnings.map((w) => (
                  <li key={w}>⚠ {w}</li>
                ))}
              </ul>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Already well covered</p>
                {coveredTags.length === 0 ? (
                  <p className="text-xs text-muted">Nothing dominant found — a promising sign.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {coveredTags.map((t) => (
                      <Badge key={t} tone="neutral">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Where the gap looks open</p>
                {gapTags.length === 0 ? (
                  <p className="text-xs text-muted">No clear opening surfaced — try narrowing the topic.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {gapTags.map((t) => (
                      <Badge key={t} tone="success">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        <div className="space-y-3">
          <p className="text-xs text-muted">
            {results.length} thesis{results.length === 1 ? "" : "es"} found
          </p>
          {results.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
              {initialEntries.length === 0
                ? "No approved theses in the archive yet."
                : "No theses match these filters."}
            </p>
          ) : (
            results.map((e) => (
              <div key={e.id} className="rounded-lg border border-border bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h3 className="font-semibold text-foreground">{e.title}</h3>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    {e.score !== null && <Badge tone="brand">{e.score}% match</Badge>}
                    {e.department && <Badge tone="neutral">{e.department}</Badge>}
                    <Badge tone="neutral">{e.year}</Badge>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {e.authorName}
                  {e.supervisorName ? ` · Supervised by ${e.supervisorName}` : ""}
                </p>
                <p className="mt-2.5 line-clamp-3 text-sm text-foreground">{e.abstract}</p>
                {e.sharedTerms.length > 0 && (
                  <p className="mt-2 text-xs text-muted">Matched on: {e.sharedTerms.join(", ")}</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
