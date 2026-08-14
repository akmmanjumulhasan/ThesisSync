import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { NoveltyClient } from "@/components/novelty/NoveltyClient";

/**
 * Module 2 (Member 3): Topic Novelty & Similarity Checker.
 *
 * Server-renders the corpus size so the page can state what a score was
 * measured against before the student runs anything.
 */
export default async function NoveltyPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.role !== "STUDENT") {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
        The Topic Novelty &amp; Similarity Checker is available to student accounts.
      </div>
    );
  }

  const [archiveSize, proposal, recent] = await Promise.all([
    prisma.archivedThesis.count(),
    // Prefills from the proposal builder, so a student is not retyping a title
    // and abstract the platform already holds.
    prisma.thesisProposal.findUnique({
      where: { studentId: session.sub },
      select: { title: true, abstract: true },
    }),
    prisma.noveltyCheck.findMany({
      where: { userId: session.sub },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        kind: true,
        title: true,
        sourceName: true,
        noveltyScore: true,
        topSimilarity: true,
        risk: true,
        createdAt: true,
      },
    }),
  ]);

  return (
    <NoveltyClient
      userName={session.name}
      archiveSize={archiveSize}
      initialTitle={proposal?.title ?? ""}
      initialAbstract={proposal?.abstract ?? ""}
      initialHistory={recent.map((c) => ({
        id: c.id,
        kind: c.kind,
        label: c.title ?? c.sourceName ?? "Untitled",
        noveltyScore: c.noveltyScore,
        topSimilarity: c.topSimilarity,
        risk: c.risk,
        createdAt: c.createdAt.toISOString(),
      }))}
    />
  );
}
