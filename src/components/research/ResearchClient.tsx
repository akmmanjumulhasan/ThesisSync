"use client";

import { useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

interface MonthBucket {
  month: string;
  count: number;
}

interface RecentPaper {
  title: string;
  venue: string;
  year: number | string;
  url: string;
}

type FieldStatus = "growing" | "active" | "saturating";

interface LandscapeResult {
  queryId: string;
  topic: string;
  heavilyCovered: string[];
  understudiedGaps: string[];
  monthlyCoverage: MonthBucket[];
  fieldStatus: FieldStatus;
  recentPapers: RecentPaper[];
  paperCount: number;
  warnings: string[];
}

export interface HistoryEntry {
  id: string;
  topic: string;
  fieldStatus: FieldStatus;
  createdAt: string;
}

const STATUS_COPY: Record<FieldStatus, { label: string; tone: "success" | "neutral" | "warning" }> = {
  growing: { label: "Growing", tone: "success" },
  active: { label: "Active", tone: "neutral" },
  saturating: { label: "Saturating", tone: "warning" },
};

const EXAMPLE_TOPIC = "Using citation graphs to detect under-explored research gaps in low-resource NLP";

export function ResearchClient({
  userName,
  initialHistory,
}: {
  userName: string;
  initialHistory: HistoryEntry[];
}) {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LandscapeResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(initialHistory);

  async function mapLandscape(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) {
      setError("Enter a topic or abstract to map.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to map the landscape.");
        return;
      }
      setResult(data);
      setHistory((prev) =>
        [{ id: data.queryId, topic: data.topic, fieldStatus: data.fieldStatus, createdAt: new Date().toISOString() }, ...prev].slice(0, 10)
      );
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const maxCoverage = Math.max(1, ...(result?.monthlyCoverage.map((m) => m.count) ?? [1]));

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-bold text-foreground">Research Landscape & Trend Analyzer</h1>
          <p className="text-xs text-muted">Module 1 · Member 1 · Semantic Scholar + OpenAlex</p>
        </div>
        <Link href="/dashboard" className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-background">
          <span className="text-sm text-foreground">{userName}</span>
          <Avatar name={userName} size={32} />
        </Link>
      </div>

      <div className="space-y-5 bg-background p-6">
        {/* Search card */}
        <form onSubmit={mapLandscape} className="rounded-lg border border-border bg-surface p-5">
          <label className="mb-2 block text-sm font-medium text-muted">What are you curious about?</label>
          <textarea
            rows={3}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={EXAMPLE_TOPIC}
            className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
          />
          <Button type="submit" disabled={loading} className="mt-3">
            {loading ? "Mapping…" : "Map the landscape"}
          </Button>
        </form>

        {error && <p className="text-sm text-danger-foreground">{error}</p>}
        {result?.warnings.map((w) => (
          <p key={w} className="text-sm text-warning-foreground">
            {w}
          </p>
        ))}

        {result && (
          <>
            {/* Status + coverage chart */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-foreground">Field momentum</h3>
                  <Badge tone={STATUS_COPY[result.fieldStatus].tone}>{STATUS_COPY[result.fieldStatus].label}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted">
                  Based on {result.paperCount} recent paper{result.paperCount === 1 ? "" : "s"} and OpenAlex's
                  year-over-year publication counts for &quot;{result.topic}&quot;.
                </p>
              </div>

              <div className="rounded-lg border border-border bg-surface p-5">
                <h3 className="font-semibold text-foreground">Coverage over the last 12 months</h3>
                <div className="mt-4 flex h-28 items-end gap-1.5">
                  {result.monthlyCoverage.map((m, i) => (
                    <div key={i} className="flex h-full flex-1 flex-col justify-end">
                      <div
                        title={`${m.month}: ${m.count}`}
                        className="w-full rounded-sm bg-accent transition-all"
                        style={{ height: `${Math.max(4, (m.count / maxCoverage) * 100)}%` }}
                      />
                      <span className="mt-1.5 text-center text-[9px] text-muted">{m.month}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Tags */}
            <div className="grid gap-4 sm:grid-cols-2">
              <TagPanel title="Heavily covered" tone="neutral" tags={result.heavilyCovered} />
              <TagPanel title="Understudied gaps" tone="success" tags={result.understudiedGaps} />
            </div>

            {/* Recent papers */}
            <div className="rounded-lg border border-border bg-surface p-5">
              <h3 className="font-semibold text-foreground">Recent papers in this space</h3>
              {result.recentPapers.length === 0 ? (
                <p className="mt-3 text-sm text-muted">No papers came back for this topic — try broader terms.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-wider text-muted">
                        <th className="py-2 pr-3 font-semibold">Title</th>
                        <th className="py-2 pr-3 font-semibold">Venue</th>
                        <th className="py-2 pr-3 font-semibold">Year</th>
                        <th className="py-2 font-semibold">Link</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {result.recentPapers.map((p, i) => (
                        <tr key={i} className="hover:bg-background">
                          <td className="py-2.5 pr-3 font-medium text-foreground">{p.title}</td>
                          <td className="py-2.5 pr-3 text-muted">{p.venue}</td>
                          <td className="py-2.5 pr-3 text-muted">{p.year}</td>
                          <td className="py-2.5">
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-accent hover:underline"
                            >
                              View →
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* History */}
        {history.length > 0 && (
          <div className="rounded-lg border border-border bg-surface p-5">
            <h3 className="font-semibold text-foreground">Recent searches</h3>
            <ul className="mt-3 divide-y divide-border">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate text-foreground">{h.topic}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone={STATUS_COPY[h.fieldStatus].tone}>{STATUS_COPY[h.fieldStatus].label}</Badge>
                    <span className="text-xs text-muted">{new Date(h.createdAt).toLocaleDateString()}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function TagPanel({ title, tone, tags }: { title: string; tone: "neutral" | "success"; tags: string[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <h3 className="font-semibold text-foreground">{title}</h3>
      {tags.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Not enough tagged results to tell yet.</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <a
              key={tag}
              href={`https://www.semanticscholar.org/search?q=${encodeURIComponent(tag)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Badge tone={tone}>{tag}</Badge>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
