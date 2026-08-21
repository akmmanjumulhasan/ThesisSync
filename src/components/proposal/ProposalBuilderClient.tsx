"use client";

import { useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type ProposalStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "RETURNED";
type DoiStatus = "PENDING" | "VALIDATED" | "NOT_FOUND";
type ProposalEvent = "SUBMITTED" | "APPROVED" | "RETURNED";

interface ReferenceRow {
  doi: string;
  resolvedTitle: string | null;
  resolvedVenue: string | null;
  resolvedYear: number | null;
  status: DoiStatus | null; // null = not yet checked (never saved)
}

interface HistoryRow {
  version: number;
  event: ProposalEvent;
  comment: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface ProposalData {
  id: string;
  title: string;
  abstract: string;
  problemStatement: string;
  researchObjectives: string;
  methodologyOutline: string;
  expectedContribution: string;
  status: ProposalStatus;
  version: number;
  references: ReferenceRow[];
  history: HistoryRow[];
}

const STATUS_COPY: Record<ProposalStatus, { label: string; tone: "success" | "neutral" | "warning" | "danger" }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SUBMITTED: { label: "In review", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  RETURNED: { label: "Returned for revision", tone: "danger" },
};

function historyLine(h: HistoryRow, isLatest: boolean, proposalStatus: ProposalStatus): { label: string; note: string } {
  if (h.event === "RETURNED") {
    return { label: `v${h.version} — returned with comments`, note: h.comment ? `"${h.comment}"` : "" };
  }
  if (h.event === "APPROVED") {
    return { label: `v${h.version} — approved`, note: h.comment ? `"${h.comment}"` : "Proposal approved." };
  }
  if (isLatest && proposalStatus === "SUBMITTED") {
    return { label: `v${h.version} — currently in review`, note: "Awaiting decision" };
  }
  return { label: `v${h.version} — submitted for review`, note: "" };
}

export function ProposalBuilderClient({
  userName,
  hasSupervisor,
  supervisorName,
  initialProposal,
}: {
  userName: string;
  hasSupervisor: boolean;
  supervisorName: string | null;
  initialProposal: ProposalData | null;
}) {
  const [title, setTitle] = useState(initialProposal?.title ?? "");
  const [abstract, setAbstract] = useState(initialProposal?.abstract ?? "");
  const [problemStatement, setProblemStatement] = useState(initialProposal?.problemStatement ?? "");
  const [methodologyOutline, setMethodologyOutline] = useState(initialProposal?.methodologyOutline ?? "");
  const [researchObjectives, setResearchObjectives] = useState(initialProposal?.researchObjectives ?? "");
  const [expectedContribution, setExpectedContribution] = useState(initialProposal?.expectedContribution ?? "");
  const [refRows, setRefRows] = useState<ReferenceRow[]>(
    initialProposal?.references.length
      ? initialProposal.references
      : [{ doi: "", resolvedTitle: null, resolvedVenue: null, resolvedYear: null, status: null }]
  );
  const [status, setStatus] = useState<ProposalStatus>(initialProposal?.status ?? "DRAFT");
  const [version, setVersion] = useState(initialProposal?.version ?? 1);
  const [history, setHistory] = useState<HistoryRow[]>(initialProposal?.history ?? []);
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const locked = status === "APPROVED";
  const checkedRows = refRows.filter((r) => r.status === "VALIDATED" || r.status === "NOT_FOUND");
  const unresolvedCount = checkedRows.filter((r) => r.status === "NOT_FOUND").length;

  function updateDoi(index: number, doi: string) {
    setRefRows((prev) => prev.map((r, i) => (i === index ? { ...r, doi, status: null } : r)));
  }

  function addRow() {
    setRefRows((prev) => [...prev, { doi: "", resolvedTitle: null, resolvedVenue: null, resolvedYear: null, status: null }]);
  }

  function removeRow(index: number) {
    setRefRows((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function save(submit: boolean) {
    setSaving(submit ? "submit" : "draft");
    setError(null);
    try {
      const res = await fetch("/api/proposal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          abstract,
          problemStatement,
          researchObjectives,
          methodologyOutline,
          expectedContribution,
          dois: refRows.map((r) => r.doi).filter(Boolean),
          submit,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save your proposal.");
        return;
      }
      const p = data.proposal;
      setStatus(p.status);
      setVersion(p.version);
      setTitle(p.title ?? "");
      setAbstract(p.abstract ?? "");
      setRefRows(
        p.references.length
          ? p.references
          : [{ doi: "", resolvedTitle: null, resolvedVenue: null, resolvedYear: null, status: null }]
      );
      setHistory(
        p.history.map((h: { version: number; event: ProposalEvent; comment: string | null; actor: { name: string } | null; createdAt: string }) => ({
          version: h.version,
          event: h.event,
          comment: h.comment,
          actorName: h.actor?.name ?? null,
          createdAt: h.createdAt,
        }))
      );
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-lg font-bold text-foreground">Structured Thesis Proposal Builder</h1>
            <Badge tone="warning">Mandatory · gate before chapter writing</Badge>
            <Badge tone={STATUS_COPY[status].tone}>{STATUS_COPY[status].label}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted">Module 1 · Member 3 · CrossRef</p>
        </div>
        <Link href="/dashboard" className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-background">
          <span className="text-sm text-foreground">{userName}</span>
          <Avatar name={userName} size={32} />
        </Link>
      </div>

      <div className="space-y-5 bg-background p-6">
        {locked && (
          <p className="rounded-lg border border-success-bg bg-success-bg px-4 py-3 text-sm text-success-foreground">
            This proposal has been approved. Chapter writing can begin — the form below is now read-only.
          </p>
        )}
        {!hasSupervisor && !locked && (
          <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
            You&apos;ll need an accepted supervisor before you can submit for approval — you can still save a
            draft in the meantime.{" "}
            <Link href="/dashboard/matchmaking" className="font-medium text-accent hover:underline">
              Find a supervisor
            </Link>
            .
          </p>
        )}
        {supervisorName && !locked && (
          <p className="text-xs text-muted">Your proposal will be reviewed by {supervisorName}.</p>
        )}
        {error && <p className="text-sm text-danger-foreground">{error}</p>}

        {/*
          Title and abstract lead, because they are what the work is called
          rather than what it plans to do — and they are what every downstream
          module identifies this thesis by: the IEEE Paper Transpiler loads them
          as the paper's identity, the Mock Defense Simulator uses them as the
          examiner's context, and the University Thesis Repository (Module 3,
          Member 1) indexes on them once the proposal is approved.
        */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <label className="mb-2 block text-sm font-medium text-muted">Thesis title</label>
          <input
            value={title}
            disabled={locked}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={300}
            placeholder="The title this thesis will be known by."
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent disabled:opacity-70"
          />
        </div>

        <Field
          label="Abstract"
          value={abstract}
          onChange={setAbstract}
          disabled={locked}
          placeholder="A short summary of the whole thesis: the problem, the approach, and what it contributes."
        />

        {/* Problem statement + Methodology outline */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Problem statement"
            value={problemStatement}
            onChange={setProblemStatement}
            disabled={locked}
            placeholder="What gap or difficulty does this thesis address?"
          />
          <Field
            label="Methodology outline"
            value={methodologyOutline}
            onChange={setMethodologyOutline}
            disabled={locked}
            placeholder="How will you approach the problem — models, data, evaluation?"
          />
        </div>

        {/* Research objectives + Expected contribution */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Research objectives"
            value={researchObjectives}
            onChange={setResearchObjectives}
            disabled={locked}
            placeholder="List the specific objectives this thesis will accomplish."
          />
          <Field
            label="Expected contribution"
            value={expectedContribution}
            onChange={setExpectedContribution}
            disabled={locked}
            placeholder="What does this add that doesn't already exist?"
          />
        </div>

        {/* Initial references (DOIs) */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="font-semibold text-foreground">Initial references (DOIs)</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-muted">
                  <th className="py-2 pr-3 font-semibold">DOI</th>
                  <th className="py-2 pr-3 font-semibold">Resolved metadata</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  {!locked && <th className="py-2 font-semibold" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {refRows.map((r, i) => (
                  <tr key={i}>
                    <td className="py-2.5 pr-3">
                      {locked ? (
                        <span className="text-foreground">{r.doi}</span>
                      ) : (
                        <input
                          value={r.doi}
                          onChange={(e) => updateDoi(i, e.target.value)}
                          placeholder="10.xxxx/xxxxx"
                          className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
                        />
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-muted">
                      {r.status === "VALIDATED"
                        ? [r.resolvedTitle, [r.resolvedVenue, r.resolvedYear].filter(Boolean).join(" ")]
                            .filter(Boolean)
                            .join(" — ")
                        : r.status === "NOT_FOUND"
                          ? "— could not resolve —"
                          : "— not yet checked —"}
                    </td>
                    <td className="py-2.5 pr-3">
                      {r.status === "VALIDATED" && <Badge tone="success">Validated</Badge>}
                      {r.status === "NOT_FOUND" && <Badge tone="danger">Not found</Badge>}
                      {r.status === null && <Badge tone="neutral">Not yet checked</Badge>}
                    </td>
                    {!locked && (
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => removeRow(i)}
                          disabled={refRows.length === 1}
                          className="text-xs font-medium text-muted hover:text-danger-foreground disabled:opacity-40"
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!locked && (
            <button type="button" onClick={addRow} className="mt-3 text-sm font-medium text-accent hover:underline">
              + Add reference
            </button>
          )}
          {checkedRows.length > 0 && (
            <p className={`mt-3 text-xs ${unresolvedCount > 0 ? "text-danger-foreground" : "text-muted"}`}>
              {checkedRows.length - unresolvedCount} of {checkedRows.length} DOI{checkedRows.length === 1 ? "" : "s"}{" "}
              auto-resolved via CrossRef.
              {unresolvedCount > 0 && " Fix or remove the unresolved reference before submitting."}
            </p>
          )}
        </div>

        {/* Actions */}
        {!locked && (
          <div className="flex gap-3">
            <Button variant="outline" disabled={saving !== null} onClick={() => save(false)}>
              {saving === "draft" ? "Saving…" : "Save draft"}
            </Button>
            <Button disabled={saving !== null} onClick={() => save(true)}>
              {saving === "submit" ? "Submitting…" : "Submit for supervisor approval"}
            </Button>
          </div>
        )}

        {/* Supervisor feedback history */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="font-semibold text-foreground">Supervisor feedback history</h3>
          {history.length === 0 ? (
            <p className="mt-3 text-sm text-muted">
              No submissions yet. Your feedback history will appear here once you submit for approval.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {history.map((h, i) => {
                const { label, note } = historyLine(h, i === 0, status);
                return (
                  <li key={i} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                    <div>
                      <p className="font-medium text-foreground">{label}</p>
                      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
                    </div>
                    <span className="shrink-0 text-xs text-muted">
                      {new Date(h.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <label className="mb-2 block text-sm font-medium text-muted">{label}</label>
      <textarea
        rows={4}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent disabled:opacity-70"
      />
    </div>
  );
}
