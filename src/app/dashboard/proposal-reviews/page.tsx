import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { ProposalStatus, RequestStatus } from "@prisma/client";
import { ProposalReviewActions } from "@/components/proposal/ProposalReviewActions";

/**
 * Structured Thesis Proposal Builder (Module 1, Member 3), supervisor side:
 * every submitted proposal from a student this supervisor has accepted,
 * waiting on an approve-or-return decision.
 */
export default async function ProposalReviewsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.role !== "SUPERVISOR") {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
        Only supervisor accounts can review thesis proposals.
      </div>
    );
  }

  const supervisorProfile = await prisma.supervisorProfile.findUnique({ where: { userId: session.sub } });
  if (!supervisorProfile) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
        Your supervisor profile could not be found.
      </div>
    );
  }

  const acceptedStudentIds = (
    await prisma.matchRequest.findMany({
      where: { supervisorId: supervisorProfile.id, status: RequestStatus.ACCEPTED },
      select: { studentId: true },
    })
  ).map((r) => r.studentId);

  const proposals = await prisma.thesisProposal.findMany({
    where: { studentId: { in: acceptedStudentIds }, status: ProposalStatus.SUBMITTED },
    include: { student: { select: { name: true, email: true } }, references: true },
    orderBy: { submittedAt: "asc" },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground">Proposals to review</h1>
      <p className="mt-1 text-sm text-muted">Submitted by your accepted students, awaiting your decision.</p>

      <div className="mt-6 space-y-4">
        {proposals.length === 0 && (
          <p className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
            Nothing awaiting review right now.
          </p>
        )}
        {proposals.map((p) => {
          const unresolvedCount = p.references.filter((r) => r.status === "NOT_FOUND").length;
          return (
            <div key={p.id} className="rounded-lg border border-border bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-foreground">
                    {p.student.name} <span className="text-xs font-normal text-muted">· v{p.version}</span>
                  </p>
                  <p className="text-sm text-muted">{p.student.email}</p>
                  {p.title && <p className="mt-1.5 font-serif text-base text-foreground">{p.title}</p>}
                </div>
              </div>

              {p.abstract && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Abstract</p>
                  <p className="mt-1 text-sm text-foreground">{p.abstract}</p>
                </div>
              )}

              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Problem statement</dt>
                  <dd className="mt-1 text-sm text-foreground">{p.problemStatement}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Methodology outline</dt>
                  <dd className="mt-1 text-sm text-foreground">{p.methodologyOutline}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Research objectives</dt>
                  <dd className="mt-1 text-sm text-foreground">{p.researchObjectives}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Expected contribution</dt>
                  <dd className="mt-1 text-sm text-foreground">{p.expectedContribution}</dd>
                </div>
              </dl>

              {p.references.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Initial references (DOIs)
                  </p>
                  <div className="mt-2 overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-border bg-content-bg text-xs uppercase tracking-wider text-muted">
                          <th className="px-3 py-2 font-semibold">DOI</th>
                          <th className="px-3 py-2 font-semibold">Resolved metadata</th>
                          <th className="px-3 py-2 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {p.references.map((r) => (
                          <tr key={r.id}>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-foreground">{r.doi}</td>
                            <td className="px-3 py-2 text-muted">
                              {r.status === "VALIDATED"
                                ? [r.resolvedTitle, [r.resolvedVenue, r.resolvedYear].filter(Boolean).join(" ")]
                                    .filter(Boolean)
                                    .join(" — ")
                                : "— could not resolve —"}
                            </td>
                            <td className="px-3 py-2">
                              {r.status === "VALIDATED" ? (
                                <span className="inline-flex items-center rounded-full bg-success-bg px-2.5 py-0.5 text-xs font-semibold text-success-foreground">
                                  Validated
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-danger-bg px-2.5 py-0.5 text-xs font-semibold text-danger-foreground">
                                  Not found
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {unresolvedCount > 0 && (
                    <p className="mt-1.5 text-xs text-danger-foreground">
                      {unresolvedCount} reference{unresolvedCount === 1 ? "" : "s"} could not be resolved.
                    </p>
                  )}
                </div>
              )}

              <ProposalReviewActions proposalId={p.id} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
