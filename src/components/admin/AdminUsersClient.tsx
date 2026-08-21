"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type RoleValue = "STUDENT" | "SUPERVISOR" | "ADMIN";
const ROLES: RoleValue[] = ["STUDENT", "SUPERVISOR", "ADMIN"];

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: RoleValue;
  department: string | null;
  studentId: string | null;
  isActive: boolean;
  createdAt: string;
}

const ALL = "All";

export function AdminUsersClient({
  initialUsers,
  currentUserId,
}: {
  initialUsers: AdminUserRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return initialUsers.filter((u) => {
      if (needle && !`${u.name} ${u.email} ${u.studentId ?? ""}`.toLowerCase().includes(needle)) return false;
      if (roleFilter !== ALL && u.role !== roleFilter) return false;
      if (statusFilter !== ALL && (statusFilter === "Active" ? !u.isActive : u.isActive)) return false;
      return true;
    });
  }, [initialUsers, q, roleFilter, statusFilter]);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="space-y-3 border-b border-border bg-background p-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, email, or student/faculty ID…"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
        />
        <div className="flex flex-wrap gap-3">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
          >
            {[ALL, ...ROLES].map((r) => (
              <option key={r} value={r}>
                {r === ALL ? "All roles" : r}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
          >
            {[ALL, "Active", "Deactivated"].map((s) => (
              <option key={s} value={s}>
                {s === ALL ? "Any status" : s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-content-bg text-xs uppercase tracking-wider text-muted">
              <th className="px-4 py-2.5 font-semibold">User</th>
              <th className="px-4 py-2.5 font-semibold">Role</th>
              <th className="px-4 py-2.5 font-semibold">Department</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {results.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  No accounts match these filters.
                </td>
              </tr>
            ) : (
              results.map((u) => (
                <UserRow key={u.id} user={u} isSelf={u.id === currentUserId} onChanged={() => router.refresh()} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserRow({
  user,
  isSelf,
  onChanged,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<RoleValue>(user.role);

  async function patch(body: { role?: RoleValue; isActive?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "That change couldn't be applied.");
        return;
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!confirm(`Issue a new temporary password for ${user.name}? Their current password stops working immediately.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/reset-password`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't reset this password.");
        return;
      }
      setTempPassword(data.temporaryPassword);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td className="px-4 py-3 align-top">
        <p className="font-medium text-foreground">
          {user.name}
          {isSelf && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}
        </p>
        <p className="text-xs text-muted">{user.email}</p>
        {user.studentId && <p className="text-xs text-muted">ID: {user.studentId}</p>}
      </td>
      <td className="px-4 py-3 align-top">
        <div className="flex items-center gap-2">
          <select
            value={pendingRole}
            disabled={busy || isSelf}
            onChange={(e) => setPendingRole(e.target.value as RoleValue)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {pendingRole !== user.role && (
            <Button variant="outline" className="px-2 py-1 text-xs" disabled={busy} onClick={() => patch({ role: pendingRole })}>
              Apply
            </Button>
          )}
        </div>
      </td>
      <td className="px-4 py-3 align-top text-muted">{user.department ?? "—"}</td>
      <td className="px-4 py-3 align-top">
        <Badge tone={user.isActive ? "success" : "danger"}>{user.isActive ? "Active" : "Deactivated"}</Badge>
      </td>
      <td className="px-4 py-3 align-top">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="px-2.5 py-1 text-xs"
            disabled={busy || isSelf}
            onClick={() => patch({ isActive: !user.isActive })}
          >
            {user.isActive ? "Deactivate" : "Activate"}
          </Button>
          <Button variant="outline" className="px-2.5 py-1 text-xs" disabled={busy} onClick={resetPassword}>
            Reset password
          </Button>
        </div>
        {error && <p className="mt-1.5 text-xs text-danger-foreground">{error}</p>}
        {tempPassword && (
          <div className="mt-1.5 rounded-md border border-border bg-background p-2 text-xs">
            <p className="text-muted">
              Temporary password (shown once — copy it now, then hand it to {user.name.split(" ")[0]} directly):
            </p>
            <p className="mt-1 select-all font-mono font-semibold text-foreground">{tempPassword}</p>
          </div>
        )}
      </td>
    </tr>
  );
}
