import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { EvaluationClient } from "@/components/evaluation/EvaluationClient";

export default async function EvaluationPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.role !== "STUDENT") {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
        The Automated Evaluation & LaTeX Chart Generator is available to student accounts.
      </div>
    );
  }

  const history = await prisma.evaluationRun.findMany({
    where: { userId: session.sub },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return (
    <EvaluationClient
      userName={session.name}
      initialHistory={history.map((h) => {
        const metrics = h.metrics as { accuracy?: number } | null;
        return {
          id: h.id,
          datasetName: h.datasetName,
          rowCount: h.rowCount,
          accuracy: metrics?.accuracy ?? 0,
          createdAt: h.createdAt.toISOString(),
        };
      })}
    />
  );
}
