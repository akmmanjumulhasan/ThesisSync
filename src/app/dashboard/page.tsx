import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { StudentHome } from "@/components/dashboard/StudentHome";
import { SupervisorHome } from "@/components/dashboard/SupervisorHome";
import { AdminHome } from "@/components/dashboard/AdminHome";

/**
 * There are three separate dashboards, one per role, not one page with a switcher.
 * Which one renders is decided by the signed-in user's own role, never chosen manually.
 */
export default async function DashboardHome() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.role === "STUDENT") return <StudentHome session={session} />;
  if (session.role === "SUPERVISOR") return <SupervisorHome session={session} />;
  return <AdminHome session={session} />;
}
