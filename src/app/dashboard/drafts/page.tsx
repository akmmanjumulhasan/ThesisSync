import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { DraftsClient } from "@/components/drafts/DraftsClient";

/** Version Control & Inline Annotation (Module 3, Member 1), student side. */
export default async function DraftsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.role !== "STUDENT") {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
        Version Control & Inline Annotation is available to student accounts.
      </div>
    );
  }

  const chapters = await prisma.thesisChapter.findMany({
    where: { studentId: session.sub },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 }, _count: { select: { versions: true } } },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <DraftsClient
      initialChapters={chapters.map((c) => ({
        id: c.id,
        title: c.title,
        versionCount: c._count.versions,
        latestVersion: c.versions[0]
          ? {
              versionNumber: c.versions[0].versionNumber,
              wordCount: c.versions[0].wordCount,
              createdAt: c.versions[0].createdAt.toISOString(),
            }
          : null,
        updatedAt: c.updatedAt.toISOString(),
      }))}
    />
  );
}
