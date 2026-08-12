"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

interface ClassMetric {
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

interface BinarySummary {
  positiveLabel: string;
  negativeLabel: string;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

interface RocPoint {
  fpr: number;
  tpr: number;
  threshold?: number;
}

interface RocCurveData {
  points: RocPoint[];
  auc: number;
}

interface Metrics {
  total: number;
  accuracy: number;
  macroPrecision: number;
  macroRecall: number;
  macroF1: number;
  weightedPrecision: number;
  weightedRecall: number;
  weightedF1: number;
  perClass: ClassMetric[];
  binary?: BinarySummary;
  roc?: RocCurveData;
}

interface ConfusionMatrix {
  labels: string[];
  matrix: number[][];
}

interface EvaluationResult {
  runId: string;
  datasetName: string;
  rowCount: number;
  kind: "BINARY" | "MULTICLASS";
  confusionMatrix: ConfusionMatrix;
  metrics: Metrics;
}

export interface HistoryEntry {
  id: string;
  datasetName: string;
  rowCount: number;
  accuracy: number;
  createdAt: string;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function accuracyTone(a: number): "success" | "warning" | "danger" {
  if (a >= 0.85) return "success";
  if (a >= 0.6) return "warning";
  return "danger";
}

export function EvaluationClient({ userName, initialHistory }: { userName: string; initialHistory: HistoryEntry[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(initialHistory);

  async function upload(file: File) {
    setLoading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/evaluation", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to process that file.");
        return;
      }
      setResult(data);
      setHistory((prev) =>
        [
          {
            id: data.runId,
            datasetName: data.datasetName,
            rowCount: data.rowCount,
            accuracy: data.metrics.accuracy,
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 10)
      );
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) upload(file);
  }

  function onBrowse(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) upload(file);
    e.target.value = "";
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-bold text-foreground">Automated Evaluation & LaTeX Charts</h1>
          <p className="text-xs text-muted">Module 2 · Member 1</p>
        </div>
        <Link href="/dashboard" className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-background">
          <span className="text-sm text-foreground">{userName}</span>
          <Avatar name={userName} size={32} />
        </Link>
      </div>

      <div className="space-y-5 bg-background p-6">
        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
            dragging ? "border-accent bg-success-bg" : "border-border bg-surface hover:bg-background"
          }`}
        >
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onBrowse} />
          <p className="text-sm font-medium text-foreground">
            {loading ? "Crunching the numbers…" : "Drag & drop a results CSV here, or click to browse"}
          </p>
          <p className="mt-1.5 text-xs text-muted">
            Needs a header row with a <code className="rounded bg-background px-1">predicted</code> and{" "}
            <code className="rounded bg-background px-1">actual</code> column (aliases like{" "}
            <code className="rounded bg-background px-1">y_pred</code> / <code className="rounded bg-background px-1">y_true</code>{" "}
            work too). Add an optional <code className="rounded bg-background px-1">score</code> column (a 0–1 confidence for
            binary data) to also get an ROC curve.
          </p>
        </div>

        {error && <p className="text-sm text-danger-foreground">{error}</p>}

        {result && (
          <>
            {/* Overview */}
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label="Dataset" value={result.datasetName} sub={`${result.rowCount} rows`} />
              <StatCard
                label="Accuracy"
                value={pct(result.metrics.accuracy)}
                badge={<Badge tone={accuracyTone(result.metrics.accuracy)}>{result.kind === "BINARY" ? "Binary" : "Multiclass"}</Badge>}
              />
              <StatCard label="Classes" value={String(result.confusionMatrix.labels.length)} sub={result.confusionMatrix.labels.join(", ")} />
            </div>

            {/* Confusion matrix heatmap */}
            <div className="rounded-lg border border-border bg-surface p-5">
              <h3 className="font-semibold text-foreground">Confusion matrix</h3>
              <p className="mt-1 text-xs text-muted">Rows are the actual class, columns are the predicted class.</p>
              <div className="mt-4 overflow-x-auto">
                <ConfusionMatrixGrid cm={result.confusionMatrix} />
              </div>
            </div>

            {/* Per-class metrics + bar chart */}
            <div className="rounded-lg border border-border bg-surface p-5">
              <h3 className="font-semibold text-foreground">Per-class metrics</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wider text-muted">
                      <th className="py-2 pr-3 font-semibold">Class</th>
                      <th className="py-2 pr-3 font-semibold">Support</th>
                      <th className="py-2 pr-3 font-semibold">Precision</th>
                      <th className="py-2 pr-3 font-semibold">Recall</th>
                      <th className="py-2 font-semibold">F1</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.metrics.perClass.map((c) => (
                      <tr key={c.label}>
                        <td className="py-2.5 pr-3 font-medium text-foreground">{c.label}</td>
                        <td className="py-2.5 pr-3 text-muted">{c.support}</td>
                        <td className="py-2.5 pr-3 text-muted">{pct(c.precision)}</td>
                        <td className="py-2.5 pr-3 text-muted">{pct(c.recall)}</td>
                        <td className="py-2.5 text-muted">{pct(c.f1)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-border font-medium text-foreground">
                      <td className="py-2.5 pr-3">Macro avg</td>
                      <td className="py-2.5 pr-3 text-muted">{result.metrics.total}</td>
                      <td className="py-2.5 pr-3">{pct(result.metrics.macroPrecision)}</td>
                      <td className="py-2.5 pr-3">{pct(result.metrics.macroRecall)}</td>
                      <td className="py-2.5">{pct(result.metrics.macroF1)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-5 flex h-32 items-end gap-4">
                {result.metrics.perClass.map((c) => (
                  <div key={c.label} className="flex h-full flex-1 flex-col justify-end">
                    <div className="flex h-full items-end gap-1">
                      <MetricBar value={c.precision} title={`${c.label} precision`} />
                      <MetricBar value={c.recall} title={`${c.label} recall`} muted />
                      <MetricBar value={c.f1} title={`${c.label} F1`} outline />
                    </div>
                    <span className="mt-1.5 truncate text-center text-[10px] text-muted">{c.label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-4 text-[11px] text-muted">
                <LegendDot className="bg-accent" label="Precision" />
                <LegendDot className="bg-accent/50" label="Recall" />
                <LegendDot className="border border-accent bg-transparent" label="F1" />
              </div>
            </div>

            {/* LaTeX-style formula panel */}
            <div className="rounded-lg border border-border bg-surface p-5">
              <h3 className="font-semibold text-foreground">Formal notation</h3>
              <p className="mt-1 text-xs text-muted">
                {result.kind === "BINARY"
                  ? `Positive class: "${result.metrics.binary?.positiveLabel}".`
                  : "Multiclass run — precision/recall/F1 shown as macro averages across all classes."}
              </p>
              <div className="mt-4 space-y-4">
                <FormulaRow
                  label="Accuracy"
                  num="TP + TN"
                  den="Total"
                  numVal={
                    result.kind === "BINARY"
                      ? (result.metrics.binary!.tp + result.metrics.binary!.tn).toString()
                      : `${Math.round(result.metrics.accuracy * result.metrics.total)}`
                  }
                  denVal={String(result.metrics.total)}
                  value={pct(result.metrics.accuracy)}
                />
                {result.kind === "BINARY" && result.metrics.binary ? (
                  <>
                    <FormulaRow
                      label="Precision"
                      num="TP"
                      den="TP + FP"
                      numVal={String(result.metrics.binary.tp)}
                      denVal={String(result.metrics.binary.tp + result.metrics.binary.fp)}
                      value={pct(result.metrics.macroPrecision)}
                    />
                    <FormulaRow
                      label="Recall"
                      num="TP"
                      den="TP + FN"
                      numVal={String(result.metrics.binary.tp)}
                      denVal={String(result.metrics.binary.tp + result.metrics.binary.fn)}
                      value={pct(result.metrics.macroRecall)}
                    />
                    <FormulaRow
                      label="F1 score"
                      num="2 · Precision · Recall"
                      den="Precision + Recall"
                      value={pct(result.metrics.macroF1)}
                    />
                  </>
                ) : (
                  <>
                    <FormulaRow label="Macro precision" num="Σ Precisionᵢ" den="n classes" value={pct(result.metrics.macroPrecision)} />
                    <FormulaRow label="Macro recall" num="Σ Recallᵢ" den="n classes" value={pct(result.metrics.macroRecall)} />
                    <FormulaRow label="Macro F1" num="Σ F1ᵢ" den="n classes" value={pct(result.metrics.macroF1)} />
                  </>
                )}
              </div>
            </div>

            {/* ROC curve — only meaningful for binary data with a score/probability column */}
            {result.kind === "BINARY" &&
              (result.metrics.roc ? (
                <RocCurveCard roc={result.metrics.roc} positiveLabel={result.metrics.binary!.positiveLabel} />
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-surface p-5 text-sm text-muted">
                  Add a <code className="rounded bg-background px-1">score</code> column (a 0–1 confidence for &quot;
                  {result.metrics.binary?.positiveLabel}&quot;) to also get an ROC curve here.
                </div>
              ))}
          </>
        )}

        {/* History */}
        {history.length > 0 && (
          <div className="rounded-lg border border-border bg-surface p-5">
            <h3 className="font-semibold text-foreground">Recent runs</h3>
            <ul className="mt-3 divide-y divide-border">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate text-foreground">
                    {h.datasetName} <span className="text-muted">· {h.rowCount} rows</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone={accuracyTone(h.accuracy)}>{pct(h.accuracy)}</Badge>
                    <span className="text-xs text-muted">{new Date(h.createdAt).toLocaleDateString()}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, badge }: { label: string; value: string; sub?: string; badge?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
        {badge}
      </div>
      <p className="mt-2 truncate text-xl font-bold text-foreground">{value}</p>
      {sub && <p className="mt-1 truncate text-xs text-muted">{sub}</p>}
    </div>
  );
}

function MetricBar({ value, title, muted, outline }: { value: number; title: string; muted?: boolean; outline?: boolean }) {
  return (
    <div
      title={`${title}: ${pct(value)}`}
      className={`w-2.5 rounded-t-sm transition-all ${outline ? "border border-accent bg-transparent" : muted ? "bg-accent/50" : "bg-accent"}`}
      style={{ height: `${Math.max(3, value * 100)}%` }}
    />
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-sm ${className}`} />
      {label}
    </span>
  );
}

/** A LaTeX \frac{}{}-style fraction: numerator over a rule over the denominator. No math-rendering library involved. */
function Frac({ num, den }: { num: ReactNode; den: ReactNode }) {
  return (
    <span className="mx-1.5 inline-flex flex-col items-center align-middle leading-tight">
      <span className="border-b border-current px-1.5 pb-0.5 text-center">{num}</span>
      <span className="px-1.5 pt-0.5 text-center">{den}</span>
    </span>
  );
}

/** One line of formal notation: Label = Frac(symbolic) [= Frac(actual numbers)] = computed value. */
function FormulaRow({
  label,
  num,
  den,
  numVal,
  denVal,
  value,
}: {
  label: string;
  num: string;
  den: string;
  numVal?: string;
  denVal?: string;
  value: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 font-serif text-[15px] italic text-foreground">
      <span className="not-italic font-semibold">{label}</span>
      <span>=</span>
      <Frac num={num} den={den} />
      {numVal !== undefined && denVal !== undefined && (
        <>
          <span>=</span>
          <Frac num={numVal} den={denVal} />
        </>
      )}
      <span>=</span>
      <span className="rounded bg-success-bg px-2 py-0.5 font-sans not-italic font-semibold text-success-foreground">{value}</span>
    </div>
  );
}

const ROC_PAD_LEFT = 34;
const ROC_PAD_TOP = 10;
const ROC_PAD_BOTTOM = 18;
const ROC_PAD_RIGHT = 10;
const ROC_CHART_W = 336;
const ROC_CHART_H = 200;
const ROC_VIEW_W = ROC_PAD_LEFT + ROC_CHART_W + ROC_PAD_RIGHT;
const ROC_VIEW_H = ROC_PAD_TOP + ROC_CHART_H + ROC_PAD_BOTTOM;
const ROC_TICKS = [0, 0.25, 0.5, 0.75, 1];

/** Maps a (fpr, tpr) point in [0,1]×[0,1] onto the chart's SVG coordinates (y is flipped: tpr=1 is at the top). */
function rocXY({ fpr, tpr }: RocPoint): [number, number] {
  return [ROC_PAD_LEFT + fpr * ROC_CHART_W, ROC_PAD_TOP + (1 - tpr) * ROC_CHART_H];
}

function rocPath(points: RocPoint[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${rocXY(p).map((n) => n.toFixed(1)).join(",")}`).join(" ");
}

/** "0", ".25", ".5", ".75", "1" — compact tick labels for a 0–1 axis. */
function formatTick(t: number): string {
  if (t === 0) return "0";
  if (t === 1) return "1";
  return t.toString().replace(/^0/, "");
}

function RocCurveCard({ roc, positiveLabel }: { roc: RocCurveData; positiveLabel: string }) {
  const [hover, setHover] = useState<{ point: RocPoint; x: number; y: number } | null>(null);

  const [x0] = rocXY({ fpr: 0, tpr: 0 });
  const [x1, y1] = rocXY({ fpr: 1, tpr: 1 });
  const baseline = rocXY({ fpr: 0, tpr: 0 })[1]; // y of the x-axis
  const areaPath = `${rocPath(roc.points)} L${x1.toFixed(1)},${baseline.toFixed(1)} L${x0.toFixed(1)},${baseline.toFixed(1)} Z`;

  function handleMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const fpr = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    let nearest = roc.points[0];
    let bestDist = Infinity;
    for (const p of roc.points) {
      const d = Math.abs(p.fpr - fpr);
      if (d < bestDist) {
        bestDist = d;
        nearest = p;
      }
    }
    const [px, py] = rocXY(nearest);
    setHover({ point: nearest, x: px, y: py });
  }

  const leftPct = hover ? Math.min(92, Math.max(8, (hover.x / ROC_VIEW_W) * 100)) : 0;
  const topPct = hover ? (hover.y / ROC_VIEW_H) * 100 : 0;

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground">ROC curve</h3>
        <Badge tone={accuracyTone(roc.auc)}>AUC {roc.auc.toFixed(3)}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted">
        Positive class &quot;{positiveLabel}&quot;, threshold swept across every distinct score.
      </p>
      <div className="mt-4 flex gap-1">
        <span className="flex shrink-0 rotate-180 items-center justify-center text-[10px] font-semibold uppercase tracking-wider text-muted [writing-mode:vertical-rl]">
          True positive rate
        </span>
        <div className="min-w-0 flex-1">
          <div className="relative">
            <svg
              viewBox={`0 0 ${ROC_VIEW_W} ${ROC_VIEW_H}`}
              className="block w-full"
              role="img"
              aria-label={`ROC curve for positive class ${positiveLabel}, AUC ${roc.auc.toFixed(3)}`}
            >
              {/* gridlines + tick labels (0 / .25 / .5 / .75 / 1 on both axes) */}
              {ROC_TICKS.map((t) => {
                const [gx] = rocXY({ fpr: t, tpr: 0 });
                const [, gy] = rocXY({ fpr: 0, tpr: t });
                return (
                  <g key={t} stroke="var(--border-color)" strokeWidth={1}>
                    <line x1={gx} y1={ROC_PAD_TOP} x2={gx} y2={baseline} />
                    <line x1={x0} y1={gy} x2={x1} y2={gy} />
                    <text x={gx} y={baseline + 13} textAnchor="middle" fontSize={9} fill="var(--muted)" stroke="none">
                      {formatTick(t)}
                    </text>
                    <text x={x0 - 6} y={gy + 3} textAnchor="end" fontSize={9} fill="var(--muted)" stroke="none">
                      {formatTick(t)}
                    </text>
                  </g>
                );
              })}
              {/* random-guess reference */}
              <line x1={x0} y1={baseline} x2={x1} y2={y1} stroke="var(--muted)" strokeWidth={1.25} strokeDasharray="4 4" />
              {/* area under curve */}
              <path d={areaPath} fill="var(--accent)" fillOpacity={0.1} stroke="none" />
              {/* ROC curve */}
              <path d={rocPath(roc.points)} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {/* hover crosshair + marker (purely visual — the capture rect below owns pointer events) */}
              {hover && (
                <g pointerEvents="none">
                  <line x1={hover.x} y1={ROC_PAD_TOP} x2={hover.x} y2={baseline} stroke="var(--muted)" strokeWidth={1} strokeDasharray="2 2" />
                  <circle cx={hover.x} cy={hover.y} r={5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
                </g>
              )}
              {/* transparent hit layer — last child so it's always topmost for hover, covers the full plot box */}
              <rect
                x={x0}
                y={ROC_PAD_TOP}
                width={ROC_CHART_W}
                height={ROC_CHART_H}
                fill="transparent"
                className="cursor-crosshair"
                onPointerMove={handleMove}
                onPointerLeave={() => setHover(null)}
              />
            </svg>
            {hover && (
              <div
                className="pointer-events-none absolute z-10 rounded-md border border-border bg-surface px-2 py-1.5 text-xs whitespace-nowrap shadow-md"
                style={{ left: `${leftPct}%`, top: `${topPct}%`, transform: "translate(-50%, calc(-100% - 10px))" }}
              >
                <p className="font-semibold text-foreground tabular-nums">
                  FPR {hover.point.fpr.toFixed(2)} · TPR {hover.point.tpr.toFixed(2)}
                </p>
                <p className="text-muted tabular-nums">
                  {hover.point.threshold !== undefined ? `Score ≥ ${hover.point.threshold.toFixed(2)}` : "Nothing clears the bar yet"}
                </p>
              </div>
            )}
          </div>
          <p className="mt-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted">False positive rate</p>
        </div>
      </div>
      <div className="mt-2 flex gap-4 text-[11px] text-muted">
        <LegendLine label="Model" />
        <LegendLine dashed label="Random guess" />
      </div>
    </div>
  );
}

function LegendLine({ dashed, label }: { dashed?: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="16" height="8" className="shrink-0">
        <line
          x1="1"
          y1="4"
          x2="15"
          y2="4"
          stroke={dashed ? "var(--muted)" : "var(--accent)"}
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={dashed ? "3 2" : undefined}
        />
      </svg>
      {label}
    </span>
  );
}

function ConfusionMatrixGrid({ cm }: { cm: ConfusionMatrix }) {
  const max = Math.max(1, ...cm.matrix.flat());
  return (
    <table className="border-collapse text-center text-sm">
      <thead>
        <tr>
          <th className="p-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted">
            Actual ↓ / Predicted →
          </th>
          {cm.labels.map((l) => (
            <th key={l} className="min-w-[64px] p-2 text-xs font-semibold text-foreground">
              {l}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {cm.labels.map((rowLabel, i) => (
          <tr key={rowLabel}>
            <th className="p-2 text-right text-xs font-semibold text-foreground">{rowLabel}</th>
            {cm.matrix[i].map((count, j) => (
              <td
                key={j}
                className={`min-w-[64px] rounded-md p-3 font-semibold ${i === j ? "text-accent-foreground" : "text-foreground"}`}
                style={{ backgroundColor: `rgba(5, 150, 105, ${count === 0 ? 0.04 : 0.15 + (count / max) * 0.7})` }}
              >
                {count}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
