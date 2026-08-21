import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { NotificationService } from "@/services/notification.service";

/**
 * Module 3 (Member 3): Smart Notification System — GET /api/getNotifications
 *
 * Named as the project's API design documents it, rather than as a REST noun,
 * so the Postman collection maps onto the running application one-for-one.
 *
 * Always scoped to the session's own user id. A notification is addressed to a
 * person, and there is no view of anyone else's.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const [notifications, unread] = await Promise.all([
    NotificationService.list(session.sub),
    NotificationService.unreadCount(session.sub),
  ]);

  return NextResponse.json(
    {
      unread,
      notifications: notifications.map((n) => ({
        id: n.id,
        event: n.event,
        title: n.title,
        body: n.body,
        link: n.link,
        // "Unread"/"Read" mirrors the status vocabulary in the API design.
        status: n.readAt ? "Read" : "Unread",
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
        deliveries: n.deliveries.map((d) => ({
          channel: d.channel,
          status: d.status,
          detail: d.detail,
        })),
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
