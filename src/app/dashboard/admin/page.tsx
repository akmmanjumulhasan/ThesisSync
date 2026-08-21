import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { AdminUsersClient, type AdminUserRow } from "@/components/admin/AdminUsersClient";

/**
 * Common workflow: Admin role & access management.
 * Every account on the platform, searchable, with the two actions "access
 * management" actually requires: change a role, and activate/deactivate.
 */
export default async function AdminUsersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
        Only admin accounts can manage users.
      </div>
    );
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      department: true,
      studentId: true,
      isActive: true,
      createdAt: true,
    },
  });

  const rows: AdminUserRow[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    department: u.department,
    studentId: u.studentId,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
  }));

  const stats = {
    total: rows.length,
    students: rows.filter((r) => r.role === "STUDENT").length,
    supervisors: rows.filter((r) => r.role === "SUPERVISOR").length,
    admins: rows.filter((r) => r.role === "ADMIN").length,
    inactive: rows.filter((r) => !r.isActive).length,
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground">Users &amp; access</h1>
      <p className="mt-1 text-sm text-muted">Every account on the platform. Change a role, or activate/deactivate one.</p>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard value={stats.total} label="Total accounts" />
        <StatCard value={stats.students} label="Students" />
        <StatCard value={stats.supervisors} label="Supervisors" />
        <StatCard value={stats.admins} label="Admins" />
        <StatCard value={stats.inactive} label="Deactivated" />
      </div>

      <div className="mt-6">
        <AdminUsersClient initialUsers={rows} currentUserId={session.sub} />
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
