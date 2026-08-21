import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { NotificationService } from "@/services/notification.service";

/**
 * Module 3 (Member 3): PUT /api/markAsRead/[id]
 *
 * `params` is a Promise in this version of Next.js and must be awaited — the
 * synchronous form from older releases silently breaks here.
 *
 * Typed inline rather than with Next's `RouteContext` helper: that helper is a
 * global emitted into .next/types, so a clean checkout fails `tsc --noEmit`
 * until someone has run the dev server or a build at least once. The explicit
 * shape is equally correct and survives a fresh clone.
 *
 * Scoped to the caller: the id in the path is not authority on its own, and
 * marking someone else's notification read is not possible.
 */
export async function PUT(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "An id is required." }, { status: 400 });
  }

  const marked = await NotificationService.markRead(session.sub, id);

  // Already read, or not this user's. Both mean "nothing to do", and telling
  // the two apart would let a caller probe for ids that exist.
  return NextResponse.json({
    message: "Notification Marked As Read Successfully",
    marked: marked ? 1 : 0,
  });
}
