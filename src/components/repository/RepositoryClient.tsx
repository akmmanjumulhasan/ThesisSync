"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";

export interface RepositoryEntry {
  id: string;
  title: string;
  abstract: string;
  authorName: string;
  department: string | null;
  year: number;
  supervisorName: string | null;
}

const ALL = "All";

export function RepositoryClient({ initialEntries }: { initialEntries: RepositoryEntry[] }) {
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState(ALL);
  const [year, setYear] = useState(ALL);
  const [supervisor, setSupervisor] = useState(ALL);

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

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return initialEntries.filter((e) => {
      if (needle && !`${e.title} ${e.abstract}`.toLowerCase().includes(needle)) return false;
      if (department !== ALL && e.department !== department) return false;
      if (year !== ALL && String(e.year) !== year) return false;
      if (supervisor !== ALL && e.supervisorName !== supervisor) return false;
      return true;
    });
  }, [initialEntries, q, department, year, supervisor]);

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
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search titles and abstracts…"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <FilterSelect label="Department" value={department} options={departments} onChange={setDepartment} />
            <FilterSelect label="Year" value={year} options={years} onChange={setYear} />
            <FilterSelect label="Supervisor" value={supervisor} options={supervisors} onChange={setSupervisor} />
          </div>
        </div>

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
                    {e.department && <Badge tone="neutral">{e.department}</Badge>}
                    <Badge tone="neutral">{e.year}</Badge>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {e.authorName}
                  {e.supervisorName ? ` · Supervised by ${e.supervisorName}` : ""}
                </p>
                <p className="mt-2.5 line-clamp-3 text-sm text-foreground">{e.abstract}</p>
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
