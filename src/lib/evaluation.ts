/**
 * Module 2 (Member 1) — Automated Evaluation & LaTeX Chart Generator
 *
 * Pure functions that turn a raw predicted/actual CSV into a confusion
 * matrix and the standard evaluation metrics derived from it. No external
 * API involved — everything here is local computation, kept separate from
 * the route handler (app/api/evaluation/route.ts) so it's testable on its
 * own, same split as lib/research.ts and lib/matching.ts.
 */

const MAX_ROWS = 5000;

const PREDICTED_ALIASES = ["predicted", "prediction", "pred", "y_pred", "ypred"];
const ACTUAL_ALIASES = ["actual", "actual_label", "label", "y_true", "ytrue", "true"];
const SCORE_ALIASES = ["score", "probability", "prob", "y_score", "yscore", "confidence", "proba"];

export interface ParsedRow {
  predicted: string;
  actual: string;
  /** Optional predicted probability/confidence for the positive class — powers the ROC curve. */
  score?: number;
}

export interface ParseResult {
  rows: ParsedRow[];
  error?: string;
}

/** Splits one CSV line on commas, trimming surrounding whitespace/quotes from each cell. */
function splitLine(line: string): string[] {
  return line.split(",").map((cell) => cell.trim().replace(/^"(.*)"$/, "$1"));
}

/**
 * Parses a raw CSV's text into predicted/actual label pairs. Looks for a
 * header row containing recognizable "predicted" and "actual" column names
 * (a few common aliases each, matched case-insensitively) — order doesn't
 * matter, extra columns are ignored. Blank lines are skipped.
 */
export function parseEvaluationCsv(text: string): ParseResult {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { rows: [], error: "The file is empty." };
  }

  const header = splitLine(lines[0]).map((h) => h.toLowerCase());
  const predictedIdx = header.findIndex((h) => PREDICTED_ALIASES.includes(h));
  const actualIdx = header.findIndex((h) => ACTUAL_ALIASES.includes(h));
  const scoreIdx = header.findIndex((h) => SCORE_ALIASES.includes(h));

  if (predictedIdx === -1 || actualIdx === -1) {
    return {
      rows: [],
      error:
        'Couldn\'t find "predicted" and "actual" columns in the header row (e.g. "predicted,actual" or "y_pred,y_true").',
    };
  }

  const dataLines = lines.slice(1, 1 + MAX_ROWS);
  const rows: ParsedRow[] = [];
  for (const line of dataLines) {
    const cells = splitLine(line);
    const predicted = cells[predictedIdx];
    const actual = cells[actualIdx];
    if (predicted === undefined || actual === undefined || predicted === "" || actual === "") continue;
    const scoreRaw = scoreIdx === -1 ? undefined : cells[scoreIdx];
    const score = scoreRaw === undefined || scoreRaw === "" ? undefined : Number(scoreRaw);
    rows.push({ predicted, actual, score: score !== undefined && Number.isFinite(score) ? score : undefined });
  }

  if (rows.length === 0) {
    return { rows: [], error: "No usable data rows — every row was missing a predicted or actual value." };
  }

  return { rows };
}

export interface ConfusionMatrix {
  labels: string[];
  /** matrix[actualIdx][predictedIdx] = count */
  matrix: number[][];
}

/** Sorts a label set with common binary pairs in their conventional order; everything else alphabetically. */
function sortLabels(labels: Set<string>): string[] {
  const lower = [...labels].map((l) => l.toLowerCase());
  if (labels.size === 2) {
    if (lower.includes("false") && lower.includes("true")) {
      return [...labels].sort((a, b) => Number(a.toLowerCase() === "true") - Number(b.toLowerCase() === "true"));
    }
    if (lower.includes("0") && lower.includes("1")) {
      return [...labels].sort((a, b) => Number(a) - Number(b));
    }
  }
  return [...labels].sort();
}

/** Builds the confusion matrix (rows = actual, columns = predicted) over every label seen in either column. */
export function buildConfusionMatrix(rows: ParsedRow[]): ConfusionMatrix {
  const labelSet = new Set<string>();
  for (const r of rows) {
    labelSet.add(r.actual);
    labelSet.add(r.predicted);
  }
  const labels = sortLabels(labelSet);
  const index = new Map(labels.map((l, i) => [l, i]));

  const matrix = labels.map(() => labels.map(() => 0));
  for (const r of rows) {
    matrix[index.get(r.actual)!][index.get(r.predicted)!] += 1;
  }
  return { labels, matrix };
}

export interface ClassMetrics {
  label: string;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  support: number;
  precision: number;
  recall: number;
  f1: number;
}

/** Safe division: 0 (not NaN/Infinity) when the denominator is 0, matching how these metrics are conventionally reported. */
function safeDiv(num: number, den: number): number {
  return den === 0 ? 0 : num / den;
}

/** Per-class TP/FP/FN/TN and the precision/recall/F1 derived from them, one-vs-rest against the full matrix. */
export function computeClassMetrics({ labels, matrix }: ConfusionMatrix): ClassMetrics[] {
  const total = matrix.flat().reduce((s, n) => s + n, 0);

  return labels.map((label, i) => {
    const tp = matrix[i][i];
    const support = matrix[i].reduce((s, n) => s + n, 0); // row sum: actual == label
    const predictedAsLabel = matrix.reduce((s, row) => s + row[i], 0); // column sum: predicted == label
    const fp = predictedAsLabel - tp;
    const fn = support - tp;
    const tn = total - tp - fp - fn;

    const precision = safeDiv(tp, tp + fp);
    const recall = safeDiv(tp, tp + fn);
    const f1 = safeDiv(2 * precision * recall, precision + recall);

    return { label, tp, fp, fn, tn, support, precision, recall, f1 };
  });
}

export interface BinarySummary {
  positiveLabel: string;
  negativeLabel: string;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

const POSITIVE_HINTS = /^(1|true|yes|positive|pos)$/i;

/** For a 2-class run, which label reads as "positive" for the classic TP/FP/TN/FN formulas. */
export function pickPositiveClass(perClass: ClassMetrics[]): BinarySummary | undefined {
  if (perClass.length !== 2) return undefined;
  const positive = perClass.find((c) => POSITIVE_HINTS.test(c.label)) ?? perClass[1];
  const negative = perClass.find((c) => c.label !== positive.label)!;
  return {
    positiveLabel: positive.label,
    negativeLabel: negative.label,
    tp: positive.tp,
    fp: positive.fp,
    fn: positive.fn,
    tn: positive.tn,
  };
}

export interface OverallMetrics {
  total: number;
  accuracy: number;
  macroPrecision: number;
  macroRecall: number;
  macroF1: number;
  weightedPrecision: number;
  weightedRecall: number;
  weightedF1: number;
}

/** Accuracy plus macro- and support-weighted averages across every class. */
export function computeOverallMetrics(cm: ConfusionMatrix, perClass: ClassMetrics[]): OverallMetrics {
  const total = cm.matrix.flat().reduce((s, n) => s + n, 0);
  const correct = cm.labels.reduce((s, _l, i) => s + cm.matrix[i][i], 0);
  const n = perClass.length || 1;

  const macroPrecision = perClass.reduce((s, c) => s + c.precision, 0) / n;
  const macroRecall = perClass.reduce((s, c) => s + c.recall, 0) / n;
  const macroF1 = perClass.reduce((s, c) => s + c.f1, 0) / n;

  const weightedPrecision = safeDiv(perClass.reduce((s, c) => s + c.precision * c.support, 0), total);
  const weightedRecall = safeDiv(perClass.reduce((s, c) => s + c.recall * c.support, 0), total);
  const weightedF1 = safeDiv(perClass.reduce((s, c) => s + c.f1 * c.support, 0), total);

  return {
    total,
    accuracy: safeDiv(correct, total),
    macroPrecision,
    macroRecall,
    macroF1,
    weightedPrecision,
    weightedRecall,
    weightedF1,
  };
}

export interface RocPoint {
  fpr: number;
  tpr: number;
  /**
   * Score threshold at which a row is predicted positive (score ≥ threshold).
   * Absent only on the origin point (fpr=0, tpr=0) — nothing has cleared the
   * bar yet, so there is no threshold to name.
   */
  threshold?: number;
}

export interface RocCurve {
  points: RocPoint[];
  auc: number;
}

/**
 * ROC curve + AUC (trapezoidal rule) for a binary run, built by sweeping the
 * decision threshold across every distinct score value — this is why it
 * needs a probability/confidence column, not just the hard predicted label
 * (a hard prediction only gives one point in ROC space, not a curve).
 * Rows with no score, or missing the positive/negative class entirely, are
 * excluded. Ties on score are grouped so they land on one point, not a
 * staircase of same-score steps.
 */
export function computeRocCurve(rows: ParsedRow[], positiveLabel: string): RocCurve | undefined {
  const scored = rows.filter((r): r is ParsedRow & { score: number } => r.score !== undefined);
  const totalPos = scored.filter((r) => r.actual === positiveLabel).length;
  const totalNeg = scored.length - totalPos;
  if (totalPos === 0 || totalNeg === 0) return undefined;

  const sorted = [...scored].sort((a, b) => b.score - a.score);

  const points: RocPoint[] = [{ fpr: 0, tpr: 0 }];
  let tp = 0;
  let fp = 0;
  let i = 0;
  while (i < sorted.length) {
    const threshold = sorted[i].score;
    while (i < sorted.length && sorted[i].score === threshold) {
      if (sorted[i].actual === positiveLabel) tp += 1;
      else fp += 1;
      i += 1;
    }
    points.push({ fpr: fp / totalNeg, tpr: tp / totalPos, threshold });
  }

  let auc = 0;
  for (let j = 1; j < points.length; j++) {
    const a = points[j - 1];
    const b = points[j];
    auc += ((b.fpr - a.fpr) * (a.tpr + b.tpr)) / 2;
  }

  return { points, auc };
}
