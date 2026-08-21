import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { RequestStatus } from "@prisma/client";
import { ProposalBuilderClient } from "@/components/proposal/ProposalBuilderClient";

export default async function ProposalPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.role !== "STUDENT") {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
        The Structured Thesis Proposal Builder is available to student accounts.
      </div>
    );
  }

  const [proposal, acceptedSupervisor] = await Promise.all([
    prisma.thesisProposal.findUnique({
      where: { studentId: session.sub },
      include: {
        references: { orderBy: { createdAt: "asc" } },
        history: { orderBy: [{ version: "desc" }, { createdAt: "desc" }], include: { actor: { select: { name: true } } } },
      },
    }),
    prisma.matchRequest.findFirst({
      where: { studentId: session.sub, status: RequestStatus.ACCEPTED },
      include: { supervisor: { include: { user: { select: { name: true } } } } },
    }),
  ]);

  return (
    <ProposalBuilderClient
      userName={session.name}
      hasSupervisor={Boolean(acceptedSupervisor)}
      supervisorName={acceptedSupervisor?.supervisor.user.name ?? null}
      initialProposal={
        proposal
          ? {
              id: proposal.id,
              title: proposal.title,
              abstract: proposal.abstract,
              problemStatement: proposal.problemStatement,
              researchObjectives: proposal.researchObjectives,
              methodologyOutline: proposal.methodologyOutline,
              expectedContribution: proposal.expectedContribution,
              status: proposal.status,
              version: proposal.version,
              references: proposal.references.map((r) => ({
                doi: r.doi,
                resolvedTitle: r.resolvedTitle,
                resolvedVenue: r.resolvedVenue,
                resolvedYear: r.resolvedYear,
                status: r.status,
              })),
              history: proposal.history.map((h) => ({
                version: h.version,
                event: h.event,
                comment: h.comment,
                actorName: h.actor?.name ?? null,
                createdAt: h.createdAt.toISOString(),
              })),
            }
          : null
      }
    />
  );
}
