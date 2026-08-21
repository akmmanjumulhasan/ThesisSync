import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { ProposalEvent, ProposalStatus, RequestStatus } from "@prisma/client";
import { RepositoryClient } from "@/components/repository/RepositoryClient";

/**
 * University Thesis Repository (Module 3, Member 1): a searchable archive of
 * every thesis proposal that has reached APPROVED — the only "completed"
 * gate that exists today. Open to any signed-in student or supervisor.
 */
export default async function RepositoryPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const approved = await prisma.thesisProposal.findMany({
    where: { status: ProposalStatus.APPROVED },
    include: {
      student: { select: { id: true, name: true, department: true } },
      history: { where: { event: ProposalEvent.APPROVED }, orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });

  const studentIds = approved.map((p) => p.student.id);
  const acceptedLinks = await prisma.matchRequest.findMany({
    where: { studentId: { in: studentIds }, status: RequestStatus.ACCEPTED },
    include: { supervisor: { include: { user: { select: { name: true } } } } },
  });
  const supervisorByStudent = new Map(acceptedLinks.map((link) => [link.studentId, link.supervisor.user.name]));

  return (
    <RepositoryClient
      initialEntries={approved.map((p) => ({
        id: p.id,
        title: p.title,
        abstract: p.abstract,
        authorName: p.student.name,
        department: p.student.department,
        year: (p.history[0]?.createdAt ?? p.updatedAt).getFullYear(),
        supervisorName: supervisorByStudent.get(p.student.id) ?? null,
      }))}
    />
  );
}
