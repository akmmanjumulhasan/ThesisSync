import { EVENT_META, type AuditView } from "@/lib/chapters";

/**
 * The audit trail: who moved this chapter, where to, and when.
 *
 * Rendered newest first, and never summarised — a record whose middle entries
 * are collapsed away is not the accountability the feature promises. Every
 * entry names a person, because the actor is denormalised onto the row and so
 * survives the account being deleted.
 */
export function ChapterAuditTrail({ audit, emptyNote }: { audit: AuditView[]; emptyNote?: string }) {
  if (audit.length === 0) {
    return <p className="text-sm text-muted">{emptyNote ?? "Nothing has happened to this chapter yet."}</p>;
  }

  return (
    <ol className="divide-y divide-border">
      {audit.map((entry) => {
        const meta = EVENT_META[entry.event];
        return (
          <li key={entry.id} className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm text-foreground">
                <span className="font-medium">{entry.actorName}</span>{" "}
                <span className="text-muted">{meta.verb}</span>
                {entry.actorRole === "SUPERVISOR" && (
                  <span className="ml-1.5 text-[11px] uppercase tracking-wide text-muted">· supervisor</span>
                )}
              </p>
              {entry.comment && (
                <p className="mt-1 border-l-2 border-border pl-2.5 text-xs italic text-muted">
                  &ldquo;{entry.comment}&rdquo;
                </p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs text-muted">
                {new Date(entry.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
              <p className="text-[11px] text-muted/80">
                {new Date(entry.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · v
                {entry.version}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
