import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { supervisorQueue } from "@/services/chapter.service";
import { Badge } from "@/components/ui/Badge";
import { ChapterPipeline } from "@/components/chapters/ChapterPipeline";
import { ChapterAuditTrail } from "@/components/chapters/ChapterAuditTrail";
import { ChapterReviewActions } from "@/components/chapters/ChapterReviewActions";
import { STATUS_META, type AuditView, type ChapterStatus } from "@/lib/chapters";
import { timeAgo } from "@/lib/time";

/**
 * Module 3 (Member 3): Chapter Approval Workflow, supervisor side.
 *
 * Every chapter waiting on this supervisor, longest wait first. Approved
 * chapters stay listed because locking one is still an explicit action only
 * they can take — dropping them here would strand the final stage.
 */
export default async function ChapterReviewsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.role !== "SUPERVISOR") {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
        Only supervisor accounts can review thesis chapters.
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

  const queue = await supervisorQueue(session.sub);

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground">Chapters to review</h1>
      <p className="mt-1 text-sm text-muted">
        Every stage past a student&apos;s draft is yours to move. Nothing here advances on its own.
      </p>

      <div className="mt-6 space-y-4">
        {queue.length === 0 && (
          <p className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
            Nothing awaiting your decision right now.
          </p>
        )}

        {queue.map((chapter) => {
          const meta = STATUS_META[chapter.status as ChapterStatus];
          const audit: AuditView[] = chapter.audit.map((a) => ({
            id: a.id,
            event: a.event,
            fromStatus: a.fromStatus,
            toStatus: a.toStatus,
            version: a.version,
            comment: a.comment,
            actorName: a.actorName,
            actorRole: a.actorRole,
            createdAt: a.createdAt.toISOString(),
          }));
          const words = chapter.content.trim() ? chapter.content.trim().split(/\s+/).length : 0;

          return (
            <div key={chapter.id} className="rounded-lg border border-border bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    Chapter {chapter.number}: {chapter.title}
                    {chapter.version > 1 && (
                      <span className="ml-1.5 text-xs font-normal text-muted">· revision {chapter.version}</span>
                    )}
                  </p>
                  <p className="text-sm text-muted">
                    {chapter.student.name} · {chapter.student.email}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  {chapter.submittedAt && (
                    <span className="text-xs text-muted">Submitted {timeAgo(chapter.submittedAt)}</span>
                  )}
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>
              </div>

              <div className="mt-3">
                <ChapterPipeline status={chapter.status as ChapterStatus} />
              </div>

              <details className="mt-4 rounded-md border border-border bg-content-bg">
                <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-foreground">
                  Read the chapter{" "}
                  <span className="font-normal text-muted">({words.toLocaleString()} words)</span>
                </summary>
                <div className="max-h-96 overflow-y-auto border-t border-border px-4 py-3">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {chapter.content || <span className="text-muted">This chapter is empty.</span>}
                  </p>
                </div>
              </details>

              <div className="mt-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Audit trail</h4>
                <div className="mt-2">
                  <ChapterAuditTrail audit={audit} />
                </div>
              </div>

              <ChapterReviewActions chapterId={chapter.id} status={chapter.status as ChapterStatus} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
