import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { IEEE_SPEC } from "@/lib/ieee-layout";
import { IeeePaperService } from "@/services/ieee-paper.service";
import { PaperClient } from "@/components/paper/PaperClient";

export default async function PaperPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.role !== "STUDENT") {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
        The IEEE Conference Paper Transpiler is available to student accounts.
      </div>
    );
  }

  const status = await IeeePaperService.status(session.sub);

  return (
    <PaperClient
      userName={session.name}
      initialStatus={{
        ready: status.ready,
        blockers: status.blockers,
        proposalStatus: status.proposalStatus,
        outline: status.outline,
        candidates: status.candidates,
        sectionFields: status.sectionFields,
      }}
      spec={{ ...IEEE_SPEC }}
    />
  );
}
