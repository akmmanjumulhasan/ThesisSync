import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { RequestActions } from "@/components/matchmaking/RequestActions";

export default async function RequestsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.role !== "SUPERVISOR") {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
        Only supervisor accounts can view supervision requests.
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

  const requests = await prisma.matchRequest.findMany({
    where: { supervisorId: supervisorProfile.id },
    include: { student: { select: { name: true, email: true, department: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground">Supervision Requests</h1>
      <p className="mt-1 text-sm text-muted">
        {supervisorProfile.activeLoad}/{supervisorProfile.maxLoad} active students
      </p>

      <div className="mt-6 space-y-3">
        {requests.length === 0 && <p className="text-sm text-muted">No requests yet.</p>}
        {requests.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between rounded-lg border border-border bg-surface p-4"
          >
            <div>
              <p className="font-medium text-foreground">{r.student.name}</p>
              <p className="text-sm text-muted">
                {r.student.email}
                {r.student.department ? ` · ${r.student.department}` : ""}
              </p>
            </div>
            <RequestActions requestId={r.id} status={r.status} />
          </div>
        ))}
      </div>
    </div>
  );
}
