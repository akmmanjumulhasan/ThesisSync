import Link from "next/link";
import prisma from "@/lib/prisma";
import { Avatar } from "@/components/ui/Avatar";
import { firstName as getFirstName } from "@/lib/format";
import type { SessionPayload } from "@/lib/auth";

export async function AdminHome({ session }: { session: SessionPayload }) {
  const firstName = getFirstName(session.name);

  const [total, students, supervisors, inactive, recentActions] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: "STUDENT" } }),
    prisma.user.count({ where: { role: "SUPERVISOR" } }),
    prisma.user.count({ where: { isActive: false } }),
    prisma.adminAuditLog.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }),
  ]);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Welcome back, {firstName}</h1>
          <p className="mt-1 text-sm text-muted">Admin</p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-foreground">{session.name}</span>
          <Avatar name={session.name} size={36} />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard value={total} label="Total accounts" />
        <StatCard value={`${students}/${supervisors}`} label="Students / supervisors" />
        <StatCard value={inactive} label="Deactivated accounts" />
        <StatCard value={recentActions} label="Access changes, last 7 days" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-6">
          <h3 className="font-serif text-lg font-semibold text-foreground">Users &amp; access</h3>
          <p className="mt-2 text-sm text-muted">
            Search every account, change a role, or activate/deactivate one.
          </p>
          <Link href="/dashboard/admin" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
            Manage users →
          </Link>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6">
          <h3 className="font-serif text-lg font-semibold text-foreground">Activity log</h3>
          <p className="mt-2 text-sm text-muted">
            Every role change, activation, deactivation, and password reset, with who did it and when.
          </p>
          <Link href="/dashboard/admin/activity" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
            View activity →
          </Link>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-dashed border-border bg-surface p-6 text-center">
        <p className="text-sm text-muted">
          The institutional thesis repository and platform-wide notification rules live in their own
          modules — see the roadmap for status.
        </p>
      </div>
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
