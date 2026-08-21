import { PIPELINE, STATUS_META, type ChapterStatus } from "@/lib/chapters";

/**
 * The five stages, drawn from PIPELINE rather than a local list so the picture
 * a student sees is the pipeline the server actually enforces.
 */
export function ChapterPipeline({ status }: { status: ChapterStatus }) {
  const currentIndex = PIPELINE.indexOf(status);

  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
      {PIPELINE.map((stage, i) => {
        const done = i < currentIndex;
        const current = i === currentIndex;
        return (
          <li key={stage} className="flex items-center gap-1.5">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                current
                  ? "bg-accent text-accent-foreground"
                  : done
                    ? "bg-success-bg text-success-foreground"
                    : "border border-border bg-surface text-muted"
              }`}
            >
              {STATUS_META[stage].label}
            </span>
            {i < PIPELINE.length - 1 && (
              <span aria-hidden className={`h-px w-3 ${done ? "bg-accent" : "bg-border"}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
