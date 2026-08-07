import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { ResearchClient } from "@/components/research/ResearchClient";

export default async function ResearchPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.role !== "STUDENT") {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
        The Research Landscape & Trend Analyzer is available to student accounts.
      </div>
    );
  }

  const history = await prisma.researchQuery.findMany({
    where: { userId: session.sub },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return (
    <ResearchClient
      userName={session.name}
      initialHistory={history.map((h) => ({
        id: h.id,
        topic: h.topic,
        fieldStatus: h.fieldStatus as "growing" | "active" | "saturating",
        createdAt: h.createdAt.toISOString(),
      }))}
    />
  );
}
