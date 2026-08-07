import Link from "next/link";
import prisma from "@/lib/prisma";
import { scoreSupervisor } from "@/lib/matching";
import { formalGreetingName, timeOfDayGreeting } from "@/lib/format";
import { JOURNEY_STEPS } from "@/lib/journey";
import { Avatar } from "@/components/ui/Avatar";
import { HistoryIcon } from "@/components/ui/icons";
import { PendingRequestsTable, type PendingRequestRow } from "@/components/dashboard/PendingRequestsTable";
import { SupervisorProfileForm } from "@/components/dashboard/SupervisorProfileForm";
import type { SessionPayload } from "@/lib/auth";

// Accepting a request is as far as the real system goes today. Propose onward isn't built yet.
const ACCEPTED_STEP_INDEX = 2;

export async function SupervisorHome({ session }: { session: SessionPayload }) {
  const profile = await prisma.supervisorProfile.findUnique({ where: { userId: session.sub } });

  if (!profile) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
        Your supervisor profile couldn&apos;t be found. Contact an admin to have it set up.
      </div>
    );
  }

  const [user, pendingRequests, acceptedRequests, totalRequestCount] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.sub }, select: { department: true } }),
    prisma.matchRequest.findMany({
      where: { supervisorId: profile.id, status: "PENDING" },
      include: { student: { include: { studentProfile: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.matchRequest.findMany({
      where: { supervisorId: profile.id, status: "ACCEPTED" },
      include: { student: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.matchRequest.count({ where: { supervisorId: profile.id } }),
  ]);

  const pendingRows: PendingRequestRow[] = pendingRequests.map((r) => {
    const keywords = r.student.studentProfile?.researchKeywords ?? [];
    const { relevance } = scoreSupervisor(keywords, {
      researchInterests: profile.researchInterests,
      maxLoad: profile.maxLoad,
      activeLoad: profile.activeLoad,
      avgResponseDays: profile.avgResponseDays,
    });
    return {
      id: r.id,
      studentName: r.student.name,
      researchKeywords: keywords.join(", "),
      matchPercent: Math.round(relevance * 100),
    };
  });

  const progressRows = acceptedRequests.map((r) => ({
    id: r.id,
    studentName: r.student.name,
    stepLabel: JOURNEY_STEPS[ACCEPTED_STEP_INDEX],
    percent: Math.round((ACCEPTED_STEP_INDEX / (JOURNEY_STEPS.length - 1)) * 100),
  }));

  const greetingName = formalGreetingName(session.name);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">
            {timeOfDayGreeting()}, {greetingName}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {user?.department ? `Department of ${user.department}` : "Supervisor"}
            {profile.researchInterests.length > 0 && ` · Expertise: ${profile.researchInterests.join(", ")}`}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-foreground">{session.name}</span>
          <Avatar name={session.name} size={36} />
        </div>
      </div>

      {/* Stats: all real, nothing here stands in for an unbuilt feature */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard value={`${profile.activeLoad}/${profile.maxLoad}`} label="Supervision capacity used" />
        <StatCard value={pendingRows.length} label="Pending requests" />
        <StatCard value={totalRequestCount} label="Total requests received" />
        <StatCard value={`${profile.avgResponseDays}d`} label="Avg. response time" />
      </div>

      {/* Pending supervision requests */}
      <div className="mt-6 overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-serif text-lg font-semibold text-foreground">Pending supervision requests</h2>
          {pendingRows.length > 0 && (
            <span className="rounded-full bg-warning-bg px-2.5 py-0.5 text-xs font-semibold text-warning-foreground">
              {pendingRows.length} new
            </span>
          )}
        </div>
        <PendingRequestsTable requests={pendingRows} />
      </div>

      {/* Drafts placeholder + students' progress */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-6">
          <h3 className="font-serif text-lg font-semibold text-foreground">Drafts to annotate</h3>
          <div className="mt-6 flex flex-col items-center justify-center py-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-content-bg text-muted">
              <HistoryIcon className="h-5 w-5" />
            </span>
            <p className="mt-3 text-sm font-medium text-foreground">Not built yet</p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted">
              Version control &amp; inline annotation will let you review chapter drafts here once it
              ships.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6">
          <h3 className="font-serif text-lg font-semibold text-foreground">My students&apos; progress</h3>
          {progressRows.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Accept a request to start tracking a student here.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {progressRows.map((p) => (
                <li key={p.id} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-sm font-medium text-foreground">
                    {p.studentName}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-content-bg">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${p.percent}%` }} />
                  </div>
                  <span className="w-14 shrink-0 text-right text-xs text-muted">{p.stepLabel}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Profile & availability */}
      <div className="mt-6 rounded-lg border border-border bg-surface p-6">
        <h3 className="font-serif text-lg font-semibold text-foreground">Profile &amp; availability</h3>
        <SupervisorProfileForm
          initialInterests={profile.researchInterests.join(", ")}
          initialCapacity={profile.maxLoad}
          initialAvailable={profile.isAvailable}
        />
      </div>

      <p className="mt-6 text-center text-xs text-muted">
        Looking for the full history?{" "}
        <Link href="/dashboard/requests" className="font-medium text-accent hover:underline">
          See every request
        </Link>
      </p>
    </div>
  );
}

function StatCard({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <p className="font-serif text-3xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}
