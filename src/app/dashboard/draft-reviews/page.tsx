import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { RequestStatus } from "@prisma/client";
import { DraftReviewsClient } from "@/components/drafts/DraftReviewsClient";

/**
 * Version Control & Inline Annotation (Module 3, Member 1), supervisor side:
 * every chapter belonging to a student this supervisor has accepted.
 */
export default async function DraftReviewsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.role !== "SUPERVISOR") {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
        Only supervisor accounts can review thesis drafts.
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

  const chapters = await prisma.thesisChapter.findMany({
    where: { studentId: { in: acceptedStudentIds } },
    include: {
      student: { select: { name: true, email: true } },
      versions: { orderBy: { versionNumber: "desc" }, take: 1 },
      _count: { select: { versions: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <DraftReviewsClient
      chapters={chapters.map((c) => ({
        id: c.id,
        title: c.title,
        studentName: c.student.name,
        studentEmail: c.student.email,
        versionCount: c._count.versions,
        latestVersion: c.versions[0]
          ? {
              versionNumber: c.versions[0].versionNumber,
              wordCount: c.versions[0].wordCount,
              createdAt: c.versions[0].createdAt.toISOString(),
            }
          : null,
      }))}
    />
  );
}
