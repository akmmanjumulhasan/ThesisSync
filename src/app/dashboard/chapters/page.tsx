import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { chapterGate, listChapters } from "@/services/chapter.service";
import { ChaptersClient } from "@/components/chapters/ChaptersClient";
import type { AuditView, ChapterStatus, ChapterView } from "@/lib/chapters";

/**
 * Module 3 (Member 3): Chapter Approval Workflow, student side.
 *
 * Chapters and their audit trail are read on the server and handed down already
 * serialised, matching how the proposal builder loads — the client component
 * only re-fetches after it has changed something.
 */
export default async function ChaptersPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.role !== "STUDENT") {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
        The Chapter Approval Workflow is where students write. To review the chapters your students have
        submitted, go to <span className="font-medium text-foreground">Chapters to review</span>.
      </div>
    );
  }

  const [chapters, gate] = await Promise.all([listChapters(session.sub), chapterGate(session.sub)]);

  const initialChapters: ChapterView[] = chapters.map((c) => ({
    id: c.id,
    number: c.number,
    title: c.title,
    content: c.content,
    status: c.status as ChapterStatus,
    version: c.version,
    submittedAt: c.submittedAt?.toISOString() ?? null,
    updatedAt: c.updatedAt.toISOString(),
    audit: c.audit.map(
      (a): AuditView => ({
        id: a.id,
        event: a.event,
        fromStatus: a.fromStatus,
        toStatus: a.toStatus,
        version: a.version,
        comment: a.comment,
        actorName: a.actorName,
        actorRole: a.actorRole,
        createdAt: a.createdAt.toISOString(),
      })
    ),
  }));

  return (
    <ChaptersClient
      userName={session.name}
      gate={{
        open: gate.open,
        hasSupervisor: gate.hasSupervisor,
        supervisorName: gate.supervisorName,
        reason: gate.reason,
      }}
      initialChapters={initialChapters}
    />
  );
}
