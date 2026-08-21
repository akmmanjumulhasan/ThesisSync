import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { Badge } from "@/components/ui/Badge";

const ACTION_LABEL: Record<string, string> = {
  ROLE_CHANGED: "Role changed",
  ACTIVATED: "Activated",
  DEACTIVATED: "Deactivated",
  PASSWORD_RESET: "Password reset",
};

const ACTION_TONE: Record<string, "success" | "danger" | "neutral" | "brand" | "warning"> = {
  ROLE_CHANGED: "brand",
  ACTIVATED: "success",
  DEACTIVATED: "danger",
  PASSWORD_RESET: "warning",
};

/**
 * Common workflow: Admin role & access management.
 * Read-only trail of every role change, activation/deactivation, and
 * password reset any admin has issued — who did it, to whom, and when.
 */
export default async function AdminActivityPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
        Only admin accounts can view the activity log.
      </div>
    );
  }

  const entries = await prisma.adminAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      actor: { select: { name: true } },
      target: { select: { name: true, email: true } },
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground">Activity log</h1>
      <p className="mt-1 text-sm text-muted">The last {entries.length} access-management actions, most recent first.</p>

      <div className="mt-6 overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-content-bg text-xs uppercase tracking-wider text-muted">
                <th className="px-4 py-2.5 font-semibold">When</th>
                <th className="px-4 py-2.5 font-semibold">Admin</th>
                <th className="px-4 py-2.5 font-semibold">Action</th>
                <th className="px-4 py-2.5 font-semibold">On</th>
                <th className="px-4 py-2.5 font-semibold">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    No access-management actions yet.
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                      {e.createdAt.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-foreground">{e.actor.name}</td>
                    <td className="px-4 py-3">
                      <Badge tone={ACTION_TONE[e.action] ?? "neutral"}>{ACTION_LABEL[e.action] ?? e.action}</Badge>
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {e.target.name}
                      <span className="ml-1 text-xs text-muted">{e.target.email}</span>
                    </td>
                    <td className="px-4 py-3 text-muted">{e.detail}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
