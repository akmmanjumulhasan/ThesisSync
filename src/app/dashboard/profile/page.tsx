import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { GithubVerifyForm } from "@/components/matchmaking/GithubVerifyForm";
import { ChangePasswordForm } from "@/components/profile/ChangePasswordForm";
import {
  UserIcon,
  MailIcon,
  IdIcon,
  BuildingIcon,
  GraduationCapIcon,
  BriefcaseIcon,
  SlidersIcon,
  CalendarIcon,
} from "@/components/ui/icons";
import type { ComponentType } from "react";

const ROLE_ICON: Record<string, ComponentType<{ className?: string }>> = {
  STUDENT: GraduationCapIcon,
  SUPERVISOR: BriefcaseIcon,
  ADMIN: SlidersIcon,
};

const ROLE_LABEL: Record<string, string> = {
  STUDENT: "Student",
  SUPERVISOR: "Supervisor",
  ADMIN: "Admin",
};

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { name: true, email: true, role: true, department: true, studentId: true, createdAt: true },
  });
  if (!user) redirect("/login");

  const developerProfile =
    session.role === "STUDENT"
      ? await prisma.developerProfile.findUnique({ where: { userId: session.sub } })
      : null;

  const infoRows = [
    { icon: UserIcon, label: "Full name", value: user.name },
    { icon: MailIcon, label: "University email", value: user.email },
    { icon: ROLE_ICON[user.role], label: "Role", value: ROLE_LABEL[user.role] },
    { icon: BuildingIcon, label: "Department", value: user.department ?? "Not set" },
    {
      icon: IdIcon,
      label: user.role === "SUPERVISOR" ? "Faculty ID" : "Student ID",
      value: user.studentId ?? "Not set",
    },
    {
      icon: CalendarIcon,
      label: "Member since",
      value: user.createdAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    },
  ];

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-foreground">Profile</h1>
      <p className="mt-1 text-sm text-muted">
        {user.name} · {user.email}
      </p>

      {/* Personal information */}
      <div className="mt-6 rounded-lg border border-border bg-surface p-6">
        <h2 className="font-semibold text-foreground">Personal information</h2>
        <dl className="mt-3 divide-y divide-border">
          {infoRows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 py-3">
              <dt className="flex items-center gap-2.5 text-sm text-muted">
                <row.icon className="h-4 w-4 shrink-0" />
                {row.label}
              </dt>
              <dd className="truncate text-sm font-medium text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* GitHub verification: students only */}
      {session.role === "STUDENT" && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-6">
          <h2 className="font-semibold text-foreground">GitHub Verification</h2>
          <p className="mt-1 text-sm text-muted">
            Verify your GitHub account to unlock your skill badge and appear in the Teammate-mode match
            pool.
          </p>
          <GithubVerifyForm
            initialUsername={developerProfile?.githubUsername ?? ""}
            isVerified={developerProfile?.isVerified ?? false}
            topLanguages={developerProfile?.topLanguages ?? []}
            totalCommits={developerProfile?.totalCommits ?? 0}
          />
        </div>
      )}

      {/* Change password */}
      <div className="mt-6 rounded-lg border border-border bg-surface p-6">
        <h2 className="font-semibold text-foreground">Change password</h2>
        <p className="mt-1 text-sm text-muted">Update the password you use to sign in.</p>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
