import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  parseEvaluationCsv,
  buildConfusionMatrix,
  computeClassMetrics,
  computeOverallMetrics,
  pickPositiveClass,
  computeRocCurve,
} from "@/lib/evaluation";

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB — plenty for a results CSV, keeps parsing instant

/**
 * Automated Evaluation & LaTeX Chart Generator: a student drops a raw
 * predicted/actual CSV, this parses it, builds the confusion matrix and
 * standard metrics, and saves the run (summary only — the raw CSV itself
 * isn't persisted) to their history.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A CSV file is required." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File is too large — keep it under 2MB." }, { status: 400 });
  }

  const text = await file.text();
  const { rows, error } = parseEvaluationCsv(text);
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const confusionMatrix = buildConfusionMatrix(rows);
  const perClass = computeClassMetrics(confusionMatrix);
  const overall = computeOverallMetrics(confusionMatrix, perClass);
  const binary = pickPositiveClass(perClass);
  const roc = binary ? computeRocCurve(rows, binary.positiveLabel) : undefined;

  const metrics = { ...overall, perClass, binary, roc };

  const run = await prisma.evaluationRun.create({
    data: {
      userId: session.sub,
      datasetName: file.name || "results.csv",
      rowCount: rows.length,
      kind: confusionMatrix.labels.length === 2 ? "BINARY" : "MULTICLASS",
      labels: confusionMatrix.labels,
      confusionMatrix: confusionMatrix as unknown as Prisma.InputJsonValue,
      metrics: metrics as unknown as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({
    runId: run.id,
    datasetName: run.datasetName,
    rowCount: run.rowCount,
    kind: run.kind,
    confusionMatrix,
    metrics,
  });
}

/** Recent runs for the signed-in student, most recent first. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const history = await prisma.evaluationRun.findMany({
    where: { userId: session.sub },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return NextResponse.json({ history });
}
