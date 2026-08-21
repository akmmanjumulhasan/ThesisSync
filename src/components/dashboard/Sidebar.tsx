"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { LogoutButton } from "@/components/LogoutButton";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { stageGroups } from "@/lib/roadmap";
import type { SessionPayload } from "@/lib/auth";

interface NavItem {
  number: number;
  title: string;
  href: string;
}

interface NavGroup {
  stage: string;
  items: NavItem[];
}

const SUPERVISOR_NAV: NavGroup[] = [
  {
    stage: "Workspace",
    items: [
      { number: 1, title: "Supervision requests", href: "/dashboard/requests" },
      { number: 2, title: "Proposals to review", href: "/dashboard/proposal-reviews" },
      { number: 3, title: "Chapters to review", href: "/dashboard/chapter-reviews" },
      { number: 4, title: "Drafts to review", href: "/dashboard/draft-reviews" },
      { number: 5, title: "Contribution analytics", href: "/dashboard/contribution" },
      { number: 6, title: "Thesis repository", href: "/dashboard/repository" },
      { number: 7, title: "Profile", href: "/dashboard/profile" },
    ],
  },
];

const ADMIN_NAV: NavGroup[] = [];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * The persistent app shell nav. Every logged-in user gets exactly one dashboard,
 * their own, by role, so there's no "switch dashboard" control here, just that
 * role's own tools, grouped by workflow stage.
 */
export function Sidebar({ session }: { session: SessionPayload }) {
  const pathname = usePathname();

  const studentGroups = stageGroups();
  const studentItemCount = studentGroups.reduce((sum, g) => sum + g.items.length, 0);

  const groups: NavGroup[] =
    session.role === "STUDENT"
      ? [
          ...studentGroups,
          {
            stage: "Account",
            items: [{ number: studentItemCount + 1, title: "Profile", href: "/dashboard/profile" }],
          },
        ]
      : session.role === "SUPERVISOR"
        ? SUPERVISOR_NAV
        : ADMIN_NAV;

  const workspaceLabel =
    session.role === "STUDENT"
      ? "Student Workspace"
      : session.role === "SUPERVISOR"
        ? "Supervisor Workspace"
        : "Admin Workspace";

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col bg-sidebar-bg text-sidebar-fg">
      <div className="px-5 pb-4 pt-6">
        <Link href="/dashboard" className="flex items-center gap-2 font-serif text-lg font-semibold text-white">
          <span className="h-2 w-2 rounded-full bg-accent" />
          ThesisSync
        </Link>
        <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
          {workspaceLabel}
        </p>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group.stage}>
            <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted/80">
              {group.stage}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                        active ? "bg-accent font-medium text-white" : "text-sidebar-fg/85 hover:bg-sidebar-hover"
                      }`}
                    >
                      <span className="text-[10px] tabular-nums opacity-60">{pad(item.number)}</span>
                      {item.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {groups.length === 0 && <p className="px-2.5 text-sm text-sidebar-muted">No tools here yet.</p>}
      </nav>

      <div className="border-t border-sidebar-border px-4 py-4">
        <div className="flex items-center gap-2.5">
          <Avatar name={session.name} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-sidebar-fg">{session.name}</p>
            <LogoutButton className="text-xs text-sidebar-muted hover:text-sidebar-fg" />
          </div>
          {/* Module 3 (Member 3): sits with the account, not in the nav list —
              it is a state indicator, not a destination. */}
          <NotificationBell />
        </div>
      </div>
    </aside>
  );
}
