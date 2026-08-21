import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { NotificationService } from "@/services/notification.service";

/**
 * Module 3 (Member 3): DELETE /api/deleteNotification/[id]
 *
 * Removes one notification from the caller's own feed. The delivery rows go
 * with it by cascade — once the user has dismissed the alert, the record of
 * which channels carried it has nothing left to explain.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "An id is required." }, { status: 400 });
  }

  const removed = await NotificationService.remove(session.sub, id);
  if (!removed) {
    return NextResponse.json({ error: "Notification not found." }, { status: 404 });
  }

  return NextResponse.json({ message: "Notification Deleted Successfully" });
}
