import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { NotificationService } from "@/services/notification.service";
import { catalogueFor } from "@/lib/notifications";
import { NotificationSettingsClient } from "@/components/notifications/NotificationSettingsClient";

/**
 * Module 3 (Member 3): Smart Notification System — settings.
 *
 * The catalogue is filtered by role on the server, so a student is never sent
 * the supervisor-only events at all rather than being shown them disabled.
 */
export default async function NotificationSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const catalogue = catalogueFor(session.role);
  if (catalogue.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
        There are no notification settings for this account type yet.
      </div>
    );
  }

  const preferences = await NotificationService.preferences(session.sub, session.role);

  return (
    <NotificationSettingsClient
      userName={session.name}
      catalogue={catalogue}
      initialPreferences={preferences}
      providers={NotificationService.providerStatus()}
    />
  );
}
