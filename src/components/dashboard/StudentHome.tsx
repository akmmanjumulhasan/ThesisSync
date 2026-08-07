import Link from "next/link";
import prisma from "@/lib/prisma";
import { timeAgo } from "@/lib/time";
import { allRoadmapItems, roadmapHref } from "@/lib/roadmap";
import { firstName as getFirstName } from "@/lib/format";
import { JOURNEY_STEPS } from "@/lib/journey";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { CheckIcon, ArrowRightIcon } from "@/components/ui/icons";
import type { SessionPayload } from "@/lib/auth";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export async function StudentHome({ session }: { session: SessionPayload }) {
  const [user, studentProfile, developerProfile, matchRequests, sentInvites, receivedInvites] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.sub }, select: { department: true, studentId: true } }),
    prisma.studentProfile.findUnique({ where: { userId: session.sub } }),
    prisma.developerProfile.findUnique({ where: { userId: session.sub } }),
    prisma.matchRequest.findMany({
      where: { studentId: session.sub },
      include: { supervisor: { include: { user: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.teamInvite.findMany({
      where: { fromUserId: session.sub },
      include: { to: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.teamInvite.findMany({
      where: { toUserId: session.sub },
      include: { from: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // --- Derive everything from real records. Nothing here is fabricated. ---
  const acceptedSupervisors = matchRequests.filter((r) => r.status === "ACCEPTED");
  const pendingRequests = matchRequests.filter((r) => r.status === "PENDING");
  const latestRequest = matchRequests[0];

  const acceptedTeammateCount =
    sentInvites.filter((i) => i.status === "ACCEPTED").length +
    receivedInvites.filter((i) => i.status === "ACCEPTED").length;

  const keywordCount = (studentProfile?.researchKeywords.length ?? 0) + (studentProfile?.declaredSkills.length ?? 0);

  const hasKeywordsOrSkills = keywordCount > 0;
  const hasAcceptedSupervisor = acceptedSupervisors.length > 0;

  let currentStepIndex = 0; // Discover
  if (hasKeywordsOrSkills) currentStepIndex = 1; // Match
  if (hasAcceptedSupervisor) currentStepIndex = 2; // Propose (not built yet, but the honest next stage)

  const waypointLabel = JOURNEY_STEPS[currentStepIndex];
  const proposalBuilder = allRoadmapItems().find((i) => i.title === "Structured Thesis Proposal Builder");
  const cta =
    currentStepIndex === 0
      ? { label: "Set your research keywords", href: "/dashboard/matchmaking" }
      : currentStepIndex === 1
        ? { label: "Find a supervisor", href: "/dashboard/matchmaking" }
        : { label: "Go to proposal builder", href: proposalBuilder ? roadmapHref(proposalBuilder) : "/dashboard" };

  // Recent activity: merged from every real event we actually have.
  const events: { text: string; date: Date }[] = [];
  for (const r of matchRequests) {
    events.push({ text: `Sent a supervision request to ${r.supervisor.user.name}`, date: r.createdAt });
  }
  for (const i of sentInvites) {
    events.push({ text: `Invited ${i.to.name} to team up`, date: i.createdAt });
  }
  for (const i of receivedInvites) {
    events.push({ text: `${i.from.name} invited you to team up`, date: i.createdAt });
  }
  if (developerProfile?.isVerified) {
    events.push({ text: "GitHub account verified", date: developerProfile.updatedAt });
  }
  events.sort((a, b) => b.date.getTime() - a.date.getTime());
  const recentEvents = events.slice(0, 5);

  // Next best steps: contextual, only ever pointing at something real to do.
  const nextSteps: { label: string; title: string; desc: string; href: string }[] = [];
  if (!hasKeywordsOrSkills) {
    nextSteps.push({
      label: "Discover",
      title: "Set your research keywords",
      desc: "Tell the matching engine what you're interested in.",
      href: "/dashboard/matchmaking",
    });
  }
  if (matchRequests.length === 0) {
    nextSteps.push({
      label: "Match",
      title: "Find a supervisor",
      desc: "Browse a ranked list based on your research keywords.",
      href: "/dashboard/matchmaking",
    });
  }
  if (pendingRequests.length > 0) {
    nextSteps.push({
      label: "Waiting",
      title: "Check your request status",
      desc: `${pendingRequests.length} request${pendingRequests.length === 1 ? "" : "s"} awaiting a response.`,
      href: "/dashboard/matchmaking",
    });
  }
  if (nextSteps.length < 3 && proposalBuilder) {
    nextSteps.push({
      label: "Coming up",
      title: proposalBuilder.title,
      desc: proposalBuilder.description,
      href: roadmapHref(proposalBuilder),
    });
  }

  const firstName = getFirstName(session.name);
  const headerParts = [user?.department, user?.studentId ? `Student ID ${user.studentId}` : null].filter(Boolean);
  if (studentProfile?.researchKeywords.length) {
    headerParts.push(`Focus: "${studentProfile.researchKeywords.slice(0, 3).join(", ")}"`);
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Welcome back, {firstName}</h1>
          <p className="mt-1 text-sm text-muted">{headerParts.join(" · ")}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-foreground">{session.name}</span>
          <Avatar name={session.name} size={36} />
        </div>
      </div>

      {/* Journey */}
      <div className="mt-6 rounded-lg border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">Your journey</p>
            <h2 className="mt-1 font-serif text-2xl font-semibold text-foreground">Waypoint: {waypointLabel}</h2>
          </div>
          <Link
            href={cta.href}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-content-bg"
          >
            {cta.label}
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-8 grid grid-cols-7 gap-1">
          {JOURNEY_STEPS.map((step, i) => {
            const state = i < currentStepIndex ? "done" : i === currentStepIndex ? "current" : "upcoming";
            return (
              <div key={step} className="relative text-center">
                {i < JOURNEY_STEPS.length - 1 && (
                  <div
                    aria-hidden
                    className={`absolute top-4 hidden h-px sm:block ${i < currentStepIndex ? "bg-accent" : "bg-border"}`}
                    style={{ left: "calc(50% + 16px)", width: "calc(100% - 32px)" }}
                  />
                )}
                <div
                  className={`relative z-10 mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                    state === "done"
                      ? "bg-accent text-white"
                      : state === "current"
                        ? "bg-amber-500 text-white"
                        : "bg-surface text-muted ring-1 ring-border"
                  }`}
                >
                  {state === "done" ? <CheckIcon className="h-3.5 w-3.5" /> : pad(i + 1)}
                </div>
                <p
                  className={`mt-2 text-xs font-medium ${state === "upcoming" ? "text-muted" : "text-foreground"}`}
                >
                  {step}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard value={acceptedSupervisors.length} label="Supervisor matched" />
        <StatCard value={acceptedTeammateCount} label="Teammates on team" />
        <StatCard value={keywordCount} label="Research keywords set" />
        <StatCard value={pendingRequests.length} label="Pending requests" />
      </div>

      {/* Supervision request + Recent activity */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-6">
          <div className="flex items-center justify-between">
            <h3 className="font-serif text-lg font-semibold text-foreground">Supervision request</h3>
            {latestRequest && (
              <Badge
                tone={
                  latestRequest.status === "ACCEPTED"
                    ? "success"
                    : latestRequest.status === "DECLINED"
                      ? "danger"
                      : "warning"
                }
              >
                {latestRequest.status === "ACCEPTED"
                  ? "Accepted"
                  : latestRequest.status === "DECLINED"
                    ? "Declined"
                    : "Pending review"}
              </Badge>
            )}
          </div>

          {latestRequest ? (
            <>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Sent to <strong className="font-semibold text-foreground">{latestRequest.supervisor.user.name}</strong>{" "}
                on{" "}
                {latestRequest.createdAt.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                .
                {latestRequest.status === "PENDING" &&
                  ` They typically respond in ~${latestRequest.supervisor.avgResponseDays}d.`}
              </p>
              {matchRequests.length > 1 && (
                <p className="mt-2 text-xs text-muted">
                  + {matchRequests.length - 1} more request{matchRequests.length - 1 === 1 ? "" : "s"} sent
                </p>
              )}
            </>
          ) : (
            <>
              <p className="mt-3 text-sm text-muted">You haven&apos;t sent a supervision request yet.</p>
              <Link
                href="/dashboard/matchmaking"
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover"
              >
                Find a supervisor
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </>
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface p-6">
          <h3 className="font-serif text-lg font-semibold text-foreground">Recent activity</h3>
          {recentEvents.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Nothing yet. Activity shows up here as you use the platform.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {recentEvents.map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="text-foreground">{e.text}</span>
                  <span className="shrink-0 text-xs text-muted">{timeAgo(e.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Next best steps */}
      {nextSteps.length > 0 && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-6">
          <h3 className="font-serif text-lg font-semibold text-foreground">Next best steps</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {nextSteps.slice(0, 3).map((s) => (
              <Link
                key={s.title}
                href={s.href}
                className="block rounded-md border border-border bg-content-bg p-4 transition-colors hover:border-accent"
              >
                <Badge tone="neutral">{s.label}</Badge>
                <p className="mt-2.5 text-sm font-semibold text-foreground">{s.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{s.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      )}
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
