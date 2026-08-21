import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { NotificationService } from "@/services/notification.service";

/**
 * Module 3 (Member 3): PUT /api/markAllAsRead
 *
 * Its own route rather than a magic "all" value on /api/markAsRead/[id], so a
 * notification that happened to be called "all" could never clear the inbox.
 */
export async function PUT() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const marked = await NotificationService.markAllRead(session.sub);
  return NextResponse.json({ message: "All Notifications Marked As Read Successfully", marked });
}
